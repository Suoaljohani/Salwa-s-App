-- General-purpose statistics: any uploaded table (employees, visits, beds, ...) becomes a dataset.
-- One engine (dataset_query) serves chat, indicators, template filling and export.
-- The earlier visit-only objects are removed (they never held data).

drop function if exists public.metric_query(jsonb);
drop function if exists public.metric_where_except(jsonb, text[]);
drop function if exists public.metric_dim_expr(text);
drop function if exists public.coverage_for(date, date);
drop function if exists public.data_catalog();
drop function if exists public.approve_batch(uuid);
drop function if exists public.close_batch(uuid, text);
drop function if exists public.rebuild_visits();
drop function if exists public.stage_rows(uuid, jsonb);
drop table if exists public.visits;
drop table if exists public.staged_visits;
drop table if exists public.import_batches;

-- ───────────────────────── Datasets ─────────────────────────
create table public.datasets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  unit_label text not null default 'سجل',          -- what one row is: زيارة، موظف، سرير...
  description text,
  mode text not null default 'snapshot' check (mode in ('snapshot', 'append')),
  period_column text,                                -- date/datetime column that defines the period (append datasets)
  key_column text,                                   -- unique row key; later batches win
  columns jsonb not null default '[]'::jsonb,        -- [{key,label,type,role,source_header}]
  header_signature text,                             -- to recognise the same file layout next time
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.datasets enable row level security;
create policy datasets_owner on public.datasets for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

create table public.dataset_batches (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  file_name text not null,
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text,
  status text not null default 'staged' check (status in ('staged','approved','rolled_back','rejected')),
  coverage_start date,
  coverage_end_exclusive date,
  as_of date,                                        -- snapshot date (e.g. roster date)
  quality jsonb not null default '{}'::jsonb,
  row_count int not null default 0,
  duplicate_in_file int not null default 0,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  closed_at timestamptz,
  check (coverage_end_exclusive is null or coverage_start is null or coverage_end_exclusive > coverage_start)
);
create unique index dataset_batches_live_hash on public.dataset_batches (dataset_id, file_sha256) where status in ('staged','approved');
create index dataset_batches_ds on public.dataset_batches (dataset_id, status);
alter table public.dataset_batches enable row level security;
create policy dataset_batches_owner on public.dataset_batches for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

create table public.dataset_rows (
  batch_id uuid not null references public.dataset_batches(id) on delete cascade,
  row_no int not null,
  row_key text,
  data jsonb not null,
  primary key (batch_id, row_no)
);
alter table public.dataset_rows enable row level security;
create policy dataset_rows_owner on public.dataset_rows for select to authenticated using ((select public.is_owner()));

-- Active rows per dataset, rebuilt on approve / rollback.
create table public.dataset_active (
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  batch_id uuid not null references public.dataset_batches(id) on delete cascade,
  row_no int not null,
  data jsonb not null
);
create index dataset_active_ds on public.dataset_active (dataset_id);
alter table public.dataset_active enable row level security;
create policy dataset_active_owner on public.dataset_active for select to authenticated using ((select public.is_owner()));

-- ───────────────────────── Helpers ─────────────────────────
create or replace function public.ds_col(p_cols jsonb, p_key text)
returns jsonb language sql immutable set search_path = '' as $$
  select c from jsonb_array_elements(p_cols) c where c->>'key' = p_key and c->>'role' <> 'ignore' limit 1;
$$;

/** Typed SQL expression for a column of row alias r. Keys are validated against the dataset definition. */
create or replace function public.ds_expr(p_col jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare k text := p_col->>'key';
begin
  if k !~ '^[a-z][a-z0-9_]{0,39}$' then raise exception 'bad_column_key'; end if;
  return case p_col->>'type'
    when 'number' then format('(r.data->>%L)::numeric', k)
    when 'date' then format('(r.data->>%L)::date', k)
    when 'datetime' then format('(r.data->>%L)::timestamptz', k)
    when 'boolean' then format('(r.data->>%L)::boolean', k)
    else format('(r.data->>%L)', k) end;
end $$;

/** Literal cast for a filter value at position i of the parameter array $1. */
create or replace function public.ds_val(p_col jsonb, p_path text)
returns text language sql immutable set search_path = '' as $$
  select case p_col->>'type'
    when 'number' then format('(%s)::numeric', p_path)
    when 'date' then format('(%s)::date', p_path)
    when 'datetime' then format('((%s)::date::timestamp at time zone ''Asia/Riyadh'')', p_path)
    when 'boolean' then format('(%s)::boolean', p_path)
    else p_path end;
$$;

-- WHERE clause for filters (skipping index p_skip, -1 = none). $1 = filters array, $2/$3 = period bounds.
create or replace function public.ds_where(p_ds public.datasets, f jsonb, p_skip int, p_has_period boolean)
returns text language plpgsql immutable set search_path = '' as $$
declare
  w text := 'r.dataset_id = $4';
  i int;
  c jsonb;
  e text;
  op text;
  v text;
begin
  if p_has_period then
    c := public.ds_col(p_ds.columns, p_ds.period_column);
    e := public.ds_expr(c);
    if c->>'type' = 'datetime' then
      w := w || format(' and %s >= ($2::timestamp at time zone ''Asia/Riyadh'') and %s < ($3::timestamp at time zone ''Asia/Riyadh'')', e, e);
    else
      w := w || format(' and %s >= $2 and %s < $3', e, e);
    end if;
  end if;
  for i in 0 .. coalesce(jsonb_array_length(f), 0) - 1 loop
    if i = p_skip then continue; end if;
    c := public.ds_col(p_ds.columns, f->i->>'column');
    if c is null then raise exception 'unknown_column:%', f->i->>'column'; end if;
    e := public.ds_expr(c);
    op := f->i->>'op';
    v := public.ds_val(c, format('$1->%s->>''value''', i));
    w := w || ' and ' || case op
      when 'eq' then format('%s = %s', e, v)
      when 'neq' then format('%s <> %s', e, v)
      when 'gt' then format('%s > %s', e, v)
      when 'gte' then format('%s >= %s', e, v)
      when 'lt' then format('%s < %s', e, v)
      when 'lte' then format('%s <= %s', e, v)
      when 'contains' then format('%s ilike (''%%'' || ($1->%s->>''value'') || ''%%'')', e, i)
      when 'in' then format('%s::text = any (array(select jsonb_array_elements_text($1->%s->''value'')))', e, i)
      when 'not_in' then format('not (%s::text = any (array(select jsonb_array_elements_text($1->%s->''value''))))', e, i)
      when 'is_null' then format('%s is null', e)
      when 'not_null' then format('%s is not null', e)
      else null end;
    if w is null then raise exception 'bad_filter_op:%', op; end if;
  end loop;
  return w;
end $$;

-- Group expression: categories as text; dates by grain (Riyadh); numbers by optional bins.
create or replace function public.ds_group_expr(p_ds public.datasets, g jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare c jsonb := public.ds_col(p_ds.columns, g->>'column'); e text; grain text := coalesce(g->>'grain', 'month');
  b jsonb := g->'bins'; s text; i int;
begin
  if c is null then raise exception 'unknown_column:%', g->>'column'; end if;
  e := public.ds_expr(c);
  if c->>'type' in ('date', 'datetime') then
    if grain not in ('day', 'month', 'year') then raise exception 'bad_grain'; end if;
    return format('coalesce(to_char(%s, %L), ''__unknown'')',
      case when c->>'type' = 'datetime' then format('(%s at time zone ''Asia/Riyadh'')', e) else e end,
      case grain when 'day' then 'YYYY-MM-DD' when 'month' then 'YYYY-MM' else 'YYYY' end);
  end if;
  if c->>'type' = 'number' and jsonb_typeof(b) = 'array' and jsonb_array_length(b) between 1 and 20 then
    -- bins [14,18,45,65] → keys "<14", "14-18", ..., "65+" (lower bound inclusive)
    s := format('case when %s is null then ''__unknown''', e);
    s := s || format(' when %s < %s then %L', e, (b->>0)::numeric, 'lt:' || (b->>0));
    for i in 1 .. jsonb_array_length(b) - 1 loop
      s := s || format(' when %s < %s then %L', e, (b->>i)::numeric, (b->>(i - 1)) || ':' || (b->>i));
    end loop;
    return s || format(' else %L end', 'ge:' || (b->>(jsonb_array_length(b) - 1)));
  end if;
  return format('coalesce(%s::text, ''__unknown'')', e);
end $$;

create or replace function public.ds_coverage(p_ds uuid, p_start date, p_end date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with days as (select d::date d from generate_series(p_start, p_end - 1, interval '1 day') d),
  cov as (select d, exists (select 1 from public.dataset_batches b where b.dataset_id = p_ds and b.status = 'approved'
            and b.coverage_start <= d and d < b.coverage_end_exclusive) covered from days),
  months as (select to_char(d, 'YYYY-MM') period, count(*) total, count(*) filter (where covered) covered from cov group by 1),
  gaps as (select min(d) gs, max(d) + 1 ge from (select d, d - (row_number() over (order by d))::int grp from cov where not covered) x group by grp)
  select jsonb_build_object(
    'status', case when (select count(*) filter (where covered) from cov) = 0 then 'none'
                   when (select bool_and(covered) from cov) then 'complete' else 'partial' end,
    'covered_days', (select count(*) filter (where covered) from cov),
    'total_days', (select count(*) from cov),
    'gaps', coalesce((select jsonb_agg(jsonb_build_object('start', gs, 'end_exclusive', ge) order by gs) from gaps), '[]'::jsonb),
    'months', coalesce((select jsonb_agg(jsonb_build_object('period', period, 'status',
        case when covered = 0 then 'none' when covered = total then 'complete' else 'partial' end) order by period) from months), '[]'::jsonb));
$$;
revoke all on function public.ds_coverage(uuid, date, date) from public, anon, authenticated;

-- ───────────────────────── The engine ─────────────────────────
create or replace function public.dataset_query(p_req jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  ds public.datasets;
  f jsonb := coalesce(p_req->'filters', '[]'::jsonb);
  g jsonb := coalesce(p_req->'group_by', '[]'::jsonb);
  m jsonb := coalesce(p_req->'measure', '{"op":"count"}'::jsonb);
  op text := m->>'op';
  mc jsonb;
  agg text;
  has_period boolean := false;
  v_start date; v_end date;
  w text; sel text := ''; dims text := '';
  i int;
  v_value numeric;
  v_rows jsonb := '[]'::jsonb;
  v_cov jsonb := null;
  v_excl jsonb := '[]'::jsonb;
  v_n bigint;
  c jsonb;
  v_sources jsonb;
  v_total bigint;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  select * into ds from public.datasets where id = (p_req->>'dataset_id')::uuid;
  if ds.id is null then raise exception 'unknown_dataset'; end if;
  if jsonb_typeof(f) <> 'array' or jsonb_array_length(f) > 12 then raise exception 'bad_filters'; end if;
  if jsonb_typeof(g) <> 'array' or jsonb_array_length(g) > 2 then raise exception 'too_many_dimensions'; end if;

  if p_req ? 'period' and p_req->'period' is not null and jsonb_typeof(p_req->'period') = 'object' then
    if ds.period_column is null then raise exception 'dataset_has_no_period'; end if;
    begin
      v_start := (p_req->'period'->>'start')::date; v_end := (p_req->'period'->>'end_exclusive')::date;
    exception when others then raise exception 'bad_dates'; end;
    if v_start is null or v_end is null or v_end <= v_start or v_end - v_start > 3700 then raise exception 'bad_dates'; end if;
    has_period := true;
  end if;

  if op = 'count' then agg := 'count(*)';
  elsif op in ('count_distinct', 'sum', 'avg', 'min', 'max') then
    mc := public.ds_col(ds.columns, m->>'column');
    if mc is null then raise exception 'unknown_column:%', m->>'column'; end if;
    if op <> 'count_distinct' and mc->>'type' <> 'number' then raise exception 'measure_needs_number'; end if;
    agg := case op when 'count_distinct' then format('count(distinct %s)', public.ds_expr(mc))
                   else format('%s(%s)', op, public.ds_expr(mc)) end;
  else raise exception 'bad_measure'; end if;

  w := public.ds_where(ds, f, -1, has_period);
  if mc is not null then w := w || format(' and %s is not null', public.ds_expr(mc)); end if;

  for i in 0 .. jsonb_array_length(g) - 1 loop
    sel := sel || format('%s as d%s, ', public.ds_group_expr(ds, g->i), i + 1);
    dims := dims || case when i > 0 then ', ' else '' end || format('d%s', i + 1);
  end loop;

  if has_period and ds.mode = 'append' then v_cov := public.ds_coverage(ds.id, v_start, v_end); end if;

  if v_cov is null or v_cov->>'status' <> 'none' then
    execute format('select %s from public.dataset_active r where %s', agg, w) into v_value using f, v_start, v_end, ds.id;
    if op in ('count', 'count_distinct') and v_value is null then v_value := 0; end if;
    if jsonb_array_length(g) > 0 then
      execute format('select coalesce(jsonb_agg(to_jsonb(x) order by %s), ''[]''::jsonb) from (select %s %s as value from public.dataset_active r where %s group by %s limit 500) x',
        dims, sel, agg, w, dims) into v_rows using f, v_start, v_end, ds.id;
    end if;
    -- Rows excluded because a filtered or measured attribute is missing (never treated as zero).
    for i in 0 .. jsonb_array_length(f) - 1 loop
      if f->i->>'op' in ('is_null', 'not_null') then continue; end if;
      c := public.ds_col(ds.columns, f->i->>'column');
      execute format('select count(*) from public.dataset_active r where %s and %s is null', public.ds_where(ds, f, i, has_period), public.ds_expr(c))
        into v_n using f, v_start, v_end, ds.id;
      if v_n > 0 then v_excl := v_excl || jsonb_build_object('column', c->>'key', 'label', c->>'label', 'n', v_n); end if;
    end loop;
    if mc is not null then
      execute format('select count(*) from public.dataset_active r where %s and %s is null', public.ds_where(ds, f, -1, has_period), public.ds_expr(mc))
        into v_n using f, v_start, v_end, ds.id;
      if v_n > 0 then v_excl := v_excl || jsonb_build_object('column', mc->>'key', 'label', mc->>'label', 'n', v_n, 'measure', true); end if;
    end if;
  end if;

  select count(*) into v_total from public.dataset_active where dataset_id = ds.id;
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'file_name', b.file_name, 'coverage_start', b.coverage_start,
           'coverage_end_exclusive', b.coverage_end_exclusive, 'as_of', b.as_of) order by b.approved_at), '[]'::jsonb)
    into v_sources from public.dataset_batches b
   where b.dataset_id = ds.id and b.status = 'approved' and exists (select 1 from public.dataset_active a where a.batch_id = b.id);

  return jsonb_build_object(
    'request', p_req,
    'dataset', jsonb_build_object('id', ds.id, 'name', ds.name, 'unit_label', ds.unit_label, 'mode', ds.mode, 'period_column', ds.period_column),
    'value', v_value,
    'rows', v_rows,
    'coverage', v_cov,
    'excluded', v_excl,
    'total_rows', v_total,
    'sources', v_sources,
    'dataset_version', ds.version,
    'extracted_at', now());
end $$;
revoke all on function public.dataset_query(jsonb) from public, anon;
grant execute on function public.dataset_query(jsonb) to authenticated;

-- ───────────────────────── Import ─────────────────────────
-- Rows arrive typed from the client. Identifier columns are replaced by a keyed hash here;
-- ignored (personal) columns are never sent. Values that do not match the column type become null.
create or replace function public.ds_stage_rows(p_batch uuid, p_rows jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare b public.dataset_batches; ds public.datasets; v_secret text; v_ins int; v_total int; c jsonb; k text;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  select * into b from public.dataset_batches where id = p_batch;
  if b.status is distinct from 'staged' then raise exception 'batch_not_staged'; end if;
  select * into ds from public.datasets where id = b.dataset_id;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then raise exception 'bad_rows'; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'patient_key_secret';
  v_total := jsonb_array_length(p_rows);

  create temp table if not exists _rows (row_no int, row_key text, data jsonb) on commit drop;
  truncate pg_temp._rows;
  insert into pg_temp._rows select (x->>'row_no')::int, null, coalesce(x->'data', '{}'::jsonb) from jsonb_array_elements(p_rows) x;

  for c in select * from jsonb_array_elements(ds.columns) loop
    k := c->>'key';
    if c->>'role' = 'ignore' then
      update pg_temp._rows set data = data - k;
    elsif c->>'role' = 'identifier' then
      update pg_temp._rows set data = jsonb_set(data, array[k], to_jsonb(encode(extensions.hmac(data->>k, v_secret, 'sha256'), 'hex')))
       where nullif(data->>k, '') is not null;
    elsif c->>'type' = 'number' then
      update pg_temp._rows set data = data - k where data ? k and jsonb_typeof(data->k) <> 'number';
    elsif c->>'type' = 'date' then
      update pg_temp._rows set data = data - k where data ? k and (data->>k) !~ '^\d{4}-\d{2}-\d{2}$';
    elsif c->>'type' = 'datetime' then
      update pg_temp._rows set data = data - k where data ? k and (data->>k) !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$';
    elsif c->>'type' = 'boolean' then
      update pg_temp._rows set data = data - k where data ? k and jsonb_typeof(data->k) <> 'boolean';
    end if;
  end loop;
  -- Drop keys not defined on the dataset.
  update pg_temp._rows set data = (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(data) e
                           where exists (select 1 from jsonb_array_elements(ds.columns) cc where cc->>'key' = e.key and cc->>'role' <> 'ignore'));
  if ds.key_column is not null then update pg_temp._rows set row_key = data->>ds.key_column; end if;

  insert into public.dataset_rows (batch_id, row_no, row_key, data)
  select distinct on (coalesce(r.row_key, '#' || r.row_no)) p_batch, r.row_no, r.row_key, r.data from pg_temp._rows r
  where r.row_key is null or not exists (select 1 from public.dataset_rows x where x.batch_id = p_batch and x.row_key = r.row_key)
  order by coalesce(r.row_key, '#' || r.row_no), r.row_no
  on conflict do nothing;
  get diagnostics v_ins = row_count;
  update public.dataset_batches set row_count = row_count + v_ins, duplicate_in_file = duplicate_in_file + (v_total - v_ins) where id = p_batch;
  return jsonb_build_object('inserted', v_ins, 'duplicates', v_total - v_ins);
end $$;
revoke all on function public.ds_stage_rows(uuid, jsonb) from public, anon;
grant execute on function public.ds_stage_rows(uuid, jsonb) to authenticated;

-- snapshot: the latest approved batch is the whole dataset.
-- append: all approved batches; a later batch replaces earlier rows inside its coverage window
--         and rows with the same key. Same row key never counts twice.
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
  update public.datasets set version = version + 1, updated_at = now() where id = p_ds returning version into v;
  return v;
end $$;
revoke all on function public.ds_rebuild(uuid) from public, anon, authenticated;

create or replace function public.ds_approve(p_batch uuid)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare d uuid; v bigint;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  update public.dataset_batches set status = 'approved', approved_at = clock_timestamp()
   where id = p_batch and status = 'staged' returning dataset_id into d;
  if d is null then raise exception 'batch_not_staged'; end if;
  v := public.ds_rebuild(d);
  insert into public.audit_log(action, detail) values ('approve', jsonb_build_object('batch', p_batch, 'dataset', d, 'version', v));
  return v;
end $$;

create or replace function public.ds_close(p_batch uuid, p_status text)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare b public.dataset_batches; v bigint;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  if p_status not in ('rolled_back', 'rejected') then raise exception 'bad_status'; end if;
  select * into b from public.dataset_batches where id = p_batch for update;
  if (p_status = 'rolled_back' and b.status <> 'approved') or (p_status = 'rejected' and b.status <> 'staged') then raise exception 'bad_transition'; end if;
  update public.dataset_batches set status = p_status, closed_at = now() where id = p_batch;
  if p_status = 'rejected' then delete from public.dataset_rows where batch_id = p_batch; end if;
  v := case when b.status = 'approved' then public.ds_rebuild(b.dataset_id) else (select version from public.datasets where id = b.dataset_id) end;
  insert into public.audit_log(action, detail) values (p_status, jsonb_build_object('batch', p_batch, 'version', v));
  return v;
end $$;
revoke all on function public.ds_approve(uuid) from public, anon;
revoke all on function public.ds_close(uuid, text) from public, anon;
grant execute on function public.ds_approve(uuid) to authenticated;
grant execute on function public.ds_close(uuid, text) to authenticated;

-- Catalog for the assistant and the UI: datasets, columns, frequent values, ranges, coverage.
create or replace function public.ds_catalog()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare out jsonb := '[]'::jsonb; ds public.datasets; c jsonb; cols jsonb; stats jsonb; e text;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  for ds in select * from public.datasets order by name loop
    cols := '[]'::jsonb;
    for c in select * from jsonb_array_elements(ds.columns) loop
      if c->>'role' = 'ignore' then continue; end if;
      e := public.ds_expr(c);
      if c->>'role' = 'identifier' then
        stats := '{}'::jsonb;
      elsif c->>'type' in ('number', 'date', 'datetime') then
        execute format('select jsonb_build_object(''min'', min(%s), ''max'', max(%s), ''nulls'', count(*) filter (where %s is null)) from public.dataset_active r where r.dataset_id = $1', e, e, e)
          into stats using ds.id;
      else
        execute format('select jsonb_build_object(''values'', coalesce(jsonb_agg(jsonb_build_object(''value'', v, ''n'', n) order by n desc), ''[]''::jsonb), ''distinct'', max(t)) from (select %s::text v, count(*) n, count(*) over () t from public.dataset_active r where r.dataset_id = $1 and %s is not null group by 1 order by 2 desc limit 40) x', e, e)
          into stats using ds.id;
      end if;
      cols := cols || (c || stats);
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
