-- Salwa statistics: core schema, single-owner access, versioned imports.
-- Patient-identifying fields (names, national IDs, phone numbers, raw MRN) are never stored in tables.
-- A keyed HMAC of the MRN is stored as patient_key for distinct-patient counts.

create extension if not exists pgcrypto with schema extensions;

-- ───────────────────────── Owner / config ─────────────────────────
create table if not exists public.app_config (
  id smallint primary key default 1 check (id = 1),
  owner_user_id uuid references auth.users(id) on delete set null,
  hospital_name text not null default 'مستشفى الحديثة العام',
  definition_version int not null default 1,
  dataset_version bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.app_config (id) values (1) on conflict do nothing;
alter table public.app_config enable row level security;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.app_config c
    where c.id = 1 and c.owner_user_id is not null and c.owner_user_id = auth.uid()
  );
$$;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

create policy app_config_owner_read on public.app_config
  for select to authenticated using ((select public.is_owner()));

-- The first and only account created in the dashboard claims ownership once.
-- Refused if more than one auth user exists, so a stray sign-up can never take over.
create or replace function public.claim_owner()
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_owner uuid; v_users int;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select owner_user_id into v_owner from public.app_config where id = 1 for update;
  if v_owner is not null then return v_owner = auth.uid(); end if;
  select count(*) into v_users from auth.users;
  if v_users <> 1 then raise exception 'owner_claim_refused'; end if;
  update public.app_config set owner_user_id = auth.uid(), updated_at = now() where id = 1;
  return true;
end $$;
revoke all on function public.claim_owner() from public, anon;
grant execute on function public.claim_owner() to authenticated;

-- Secret for patient_key HMAC, generated inside the database and kept in Vault.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'patient_key_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'patient_key_secret', 'HMAC key for pseudonymous patient_key');
  end if;
end $$;

-- ───────────────────────── Import batches ─────────────────────────
create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null default 'visit_report',
  file_name text not null,
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text,
  grain text not null default 'encounter' check (grain in ('encounter')),
  declared_start date,
  declared_end_inclusive date,
  coverage_start date not null,
  coverage_end_exclusive date not null,
  mapping jsonb not null default '{}'::jsonb,
  quality jsonb not null default '{}'::jsonb,
  status text not null default 'staged' check (status in ('staged','approved','rolled_back','rejected')),
  row_count int not null default 0,
  rejected_count int not null default 0,
  duplicate_in_file int not null default 0,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  closed_at timestamptz,
  check (coverage_end_exclusive > coverage_start)
);
create unique index if not exists import_batches_live_hash
  on public.import_batches (file_sha256) where status in ('staged','approved');
alter table public.import_batches enable row level security;
create policy import_batches_owner on public.import_batches
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

create table if not exists public.staged_visits (
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  row_no int not null,
  visit_id text not null,
  patient_key text,
  encounter_type text,
  department text,
  clinic text,
  gender text check (gender in ('M','F')),
  age_years int check (age_years between 0 and 130),
  nationality text,
  is_saudi boolean,
  payor text,
  patient_type text,
  visit_at timestamptz not null,
  discharge_type text,
  los int,
  primary key (batch_id, visit_id)
);
alter table public.staged_visits enable row level security;
create policy staged_visits_owner on public.staged_visits
  for select to authenticated using ((select public.is_owner()));

-- Active, de-duplicated set. Rebuilt from approved batches only.
create table if not exists public.visits (
  visit_id text primary key,
  batch_id uuid not null references public.import_batches(id),
  patient_key text,
  encounter_type text,
  department text,
  clinic text,
  gender text,
  age_years int,
  nationality text,
  is_saudi boolean,
  payor text,
  patient_type text,
  visit_at timestamptz not null,
  discharge_type text,
  los int
);
create index if not exists visits_visit_at on public.visits (visit_at);
create index if not exists visits_enc_at on public.visits (encounter_type, visit_at);
alter table public.visits enable row level security;
create policy visits_owner on public.visits
  for select to authenticated using ((select public.is_owner()));

-- ───────────────────────── Supporting tables ─────────────────────────
create table if not exists public.ai_cache (
  cache_key text primary key,
  request jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.ai_cache enable row level security;
create policy ai_cache_owner on public.ai_cache
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

create table if not exists public.saved_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('indicator','report_spec','template_mapping','question')),
  title text not null,
  payload jsonb not null,
  structure_hash text,
  created_at timestamptz not null default now()
);
alter table public.saved_items enable row level security;
create policy saved_items_owner on public.saved_items
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  action text not null,
  detail jsonb not null default '{}'::jsonb
);
alter table public.audit_log enable row level security;
create policy audit_log_owner_read on public.audit_log
  for select to authenticated using ((select public.is_owner()));
create policy audit_log_owner_insert on public.audit_log
  for insert to authenticated with check ((select public.is_owner()));

-- ───────────────────────── Import functions ─────────────────────────
create or replace function public.stage_rows(p_batch uuid, p_rows jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_secret text; v_status text; v_inserted int; v_total int;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  select status into v_status from public.import_batches where id = p_batch;
  if v_status is distinct from 'staged' then raise exception 'batch_not_staged'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then raise exception 'bad_rows'; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'patient_key_secret';
  v_total := jsonb_array_length(p_rows);

  insert into public.staged_visits as s (batch_id,row_no,visit_id,patient_key,encounter_type,department,clinic,gender,
     age_years,nationality,is_saudi,payor,patient_type,visit_at,discharge_type,los)
  select p_batch, (r->>'row_no')::int, r->>'visit_id',
         case when nullif(r->>'mrn','') is null then null
              else encode(extensions.hmac(r->>'mrn', v_secret, 'sha256'), 'hex') end,
         nullif(r->>'encounter_type',''), nullif(r->>'department',''), nullif(r->>'clinic',''),
         nullif(r->>'gender',''), (r->>'age_years')::int, nullif(r->>'nationality',''),
         (r->>'is_saudi')::boolean, nullif(r->>'payor',''), nullif(r->>'patient_type',''),
         (r->>'visit_at')::timestamptz, nullif(r->>'discharge_type',''), (r->>'los')::int
  from jsonb_array_elements(p_rows) r
  on conflict (batch_id, visit_id) do nothing;
  get diagnostics v_inserted = row_count;

  update public.import_batches
     set row_count = row_count + v_inserted,
         duplicate_in_file = duplicate_in_file + (v_total - v_inserted)
   where id = p_batch;
  return jsonb_build_object('inserted', v_inserted, 'duplicates', v_total - v_inserted);
end $$;
revoke all on function public.stage_rows(uuid, jsonb) from public, anon;
grant execute on function public.stage_rows(uuid, jsonb) to authenticated;

-- Later approved batches supersede earlier ones inside their coverage window;
-- the same visit_id is never counted twice.
create or replace function public.rebuild_visits()
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare v_version bigint;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  delete from public.visits where true;
  insert into public.visits (visit_id,batch_id,patient_key,encounter_type,department,clinic,gender,age_years,
                             nationality,is_saudi,payor,patient_type,visit_at,discharge_type,los)
  select distinct on (s.visit_id)
         s.visit_id, s.batch_id, s.patient_key, s.encounter_type, s.department, s.clinic, s.gender, s.age_years,
         s.nationality, s.is_saudi, s.payor, s.patient_type, s.visit_at, s.discharge_type, s.los
  from public.staged_visits s
  join public.import_batches b on b.id = s.batch_id and b.status = 'approved'
  where not exists (
    select 1 from public.import_batches b2
    where b2.status = 'approved' and b2.source_kind = b.source_kind and b2.id <> b.id
      and b2.approved_at > b.approved_at
      and s.visit_at >= (b2.coverage_start::timestamp at time zone 'Asia/Riyadh')
      and s.visit_at <  (b2.coverage_end_exclusive::timestamp at time zone 'Asia/Riyadh')
  )
  order by s.visit_id, b.approved_at desc;
  update public.app_config set dataset_version = dataset_version + 1, updated_at = now()
   where id = 1 returning dataset_version into v_version;
  return v_version;
end $$;
revoke all on function public.rebuild_visits() from public, anon, authenticated;

create or replace function public.approve_batch(p_batch uuid)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare v bigint;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  update public.import_batches set status = 'approved', approved_at = clock_timestamp()
   where id = p_batch and status = 'staged';
  if not found then raise exception 'batch_not_staged'; end if;
  v := public.rebuild_visits();
  insert into public.audit_log(action, detail) values ('approve_batch', jsonb_build_object('batch', p_batch, 'dataset_version', v));
  return v;
end $$;

create or replace function public.close_batch(p_batch uuid, p_status text)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare v bigint; v_prev text;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  if p_status not in ('rolled_back','rejected') then raise exception 'bad_status'; end if;
  select status into v_prev from public.import_batches where id = p_batch for update;
  if (p_status = 'rolled_back' and v_prev <> 'approved') or (p_status = 'rejected' and v_prev <> 'staged') then
    raise exception 'bad_transition';
  end if;
  update public.import_batches set status = p_status, closed_at = now() where id = p_batch;
  if p_status = 'rejected' then delete from public.staged_visits where batch_id = p_batch; end if;
  v := case when v_prev = 'approved' then public.rebuild_visits()
            else (select dataset_version from public.app_config where id = 1) end;
  insert into public.audit_log(action, detail) values (p_status, jsonb_build_object('batch', p_batch, 'dataset_version', v));
  return v;
end $$;
revoke all on function public.approve_batch(uuid) from public, anon;
revoke all on function public.close_batch(uuid, text) from public, anon;
grant execute on function public.approve_batch(uuid) to authenticated;
grant execute on function public.close_batch(uuid, text) to authenticated;

-- ───────────────────────── Storage ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('private-files', 'private-files', false, 52428800)
on conflict (id) do nothing;

create policy private_files_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'private-files' and (select public.is_owner()));
create policy private_files_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'private-files' and (select public.is_owner()));
create policy private_files_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'private-files' and (select public.is_owner()));
