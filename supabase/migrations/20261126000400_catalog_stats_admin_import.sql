-- 1) Server-side bulk import (edge function admin_import, service role) can use the same RPCs.
--    The service-role key exists only inside Supabase; browsers never hold it.
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'role'), '') = 'service_role'
      or exists (
        select 1 from public.app_config c
        where c.id = 1 and c.owner_user_id is not null and c.owner_user_id = auth.uid()
      );
$$;

-- One-time tokens for the bulk import function (only a SHA-256 hash is stored; no policies = no client access).
create table if not exists public.admin_import_tokens (
  token_sha256 text primary key check (token_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  note text
);
alter table public.admin_import_tokens enable row level security;

-- 2) Column statistics are computed once per data change (not on every question).
alter table public.datasets add column if not exists stats jsonb not null default '{}'::jsonb;

create or replace function public.ds_compute_stats(p_ds uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare ds public.datasets; c jsonb; e text; s jsonb; out jsonb := '{}'::jsonb;
begin
  select * into ds from public.datasets where id = p_ds;
  for c in select * from jsonb_array_elements(ds.columns) loop
    if c->>'role' in ('ignore', 'identifier') then continue; end if;
    e := public.ds_expr(c);
    if c->>'type' in ('number', 'date', 'datetime') then
      execute format('select jsonb_build_object(''min'', min(%s), ''max'', max(%s), ''nulls'', count(*) filter (where %s is null)) from public.dataset_active r where r.dataset_id = $1', e, e, e)
        into s using p_ds;
    else
      execute format('select jsonb_build_object(''values'', coalesce(jsonb_agg(jsonb_build_object(''value'', v, ''n'', n) order by n desc), ''[]''::jsonb), ''distinct'', max(t)) from (select %s::text v, count(*) n, count(*) over () t from public.dataset_active r where r.dataset_id = $1 and %s is not null group by 1 order by 2 desc limit 60) x', e, e)
        into s using p_ds;
    end if;
    out := out || jsonb_build_object(c->>'key', s);
  end loop;
  update public.datasets set stats = out where id = p_ds;
  return out;
end $$;
revoke all on function public.ds_compute_stats(uuid) from public, anon, authenticated;

-- Rebuild now also refreshes statistics.
create or replace function public.ds_rebuild(p_ds uuid)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare ds public.datasets; v bigint; pc jsonb; pe text;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  select * into ds from public.datasets where id = p_ds for update;
  delete from public.dataset_active where dataset_id = p_ds;
  if ds.mode = 'snapshot' then
    insert into public.dataset_active (dataset_id, batch_id, row_no, data)
    select p_ds, r.batch_id, r.row_no, r.data from public.dataset_rows r
    where r.batch_id = (select id from public.dataset_batches where dataset_id = p_ds and status = 'approved' order by approved_at desc limit 1);
  else
    pc := public.ds_col(ds.columns, ds.period_column);
    pe := case when pc is null then 'null' when pc->>'type' = 'datetime'
               then '((r.data->>' || quote_literal(pc->>'key') || ')::timestamptz at time zone ''Asia/Riyadh'')::date'
               else '(r.data->>' || quote_literal(pc->>'key') || ')::date' end;
    execute format($q$
      insert into public.dataset_active (dataset_id, batch_id, row_no, data)
      select distinct on (coalesce(r.row_key, r.batch_id::text || ':' || r.row_no)) $1, r.batch_id, r.row_no, r.data
      from public.dataset_rows r join public.dataset_batches b on b.id = r.batch_id and b.status = 'approved' and b.dataset_id = $1
      where not exists (
        select 1 from public.dataset_batches b2 where b2.dataset_id = $1 and b2.status = 'approved' and b2.id <> b.id
          and b2.approved_at > b.approved_at and b2.coverage_start is not null
          and %s >= b2.coverage_start and %s < b2.coverage_end_exclusive)
      order by coalesce(r.row_key, r.batch_id::text || ':' || r.row_no), b.approved_at desc
    $q$, pe, pe) using p_ds;
  end if;
  perform public.ds_compute_stats(p_ds);
  update public.datasets set version = version + 1, updated_at = now() where id = p_ds returning version into v;
  return v;
end $$;
revoke all on function public.ds_rebuild(uuid) from public, anon, authenticated;

-- Catalog reads the stored statistics: fast even with many large datasets.
create or replace function public.ds_catalog()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare out jsonb := '[]'::jsonb; ds public.datasets; c jsonb; cols jsonb;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  for ds in select * from public.datasets order by name loop
    cols := '[]'::jsonb;
    for c in select * from jsonb_array_elements(ds.columns) loop
      if c->>'role' = 'ignore' then continue; end if;
      cols := cols || (c || coalesce(ds.stats -> (c->>'key'), '{}'::jsonb));
    end loop;
    out := out || jsonb_build_object(
      'id', ds.id, 'name', ds.name, 'unit_label', ds.unit_label, 'description', ds.description, 'mode', ds.mode,
      'period_column', ds.period_column, 'key_column', ds.key_column, 'header_signature', ds.header_signature,
      'version', ds.version, 'columns', cols,
      'row_count', (select count(*) from public.dataset_active where dataset_id = ds.id),
      'coverage', coalesce((select jsonb_agg(jsonb_build_object('start', coverage_start, 'end_exclusive', coverage_end_exclusive, 'file_name', file_name, 'as_of', as_of) order by coalesce(coverage_start, as_of))
                     from public.dataset_batches where dataset_id = ds.id and status = 'approved'), '[]'::jsonb));
  end loop;
  return jsonb_build_object(
    'datasets', out,
    'version', (select coalesce(sum(version), 0) from public.datasets),
    'hospital_name', (select hospital_name from public.app_config where id = 1),
    'storage_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = 'private-files'),
    'database_bytes', pg_database_size(current_database()));
end $$;
revoke all on function public.ds_catalog() from public, anon;
grant execute on function public.ds_catalog() to authenticated;
