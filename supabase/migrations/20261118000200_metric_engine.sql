-- Unified metric engine. Chat, indicators, template filling and report export all call metric_query().
-- Only catalogued metrics, filters and dimensions are accepted. All values are parameters, never SQL text.
-- Time boundaries are local Asia/Riyadh days: [start 00:00, end_exclusive 00:00).

create or replace function public.coverage_for(p_start date, p_end date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with days as (
    select d::date as d from generate_series(p_start, p_end - 1, interval '1 day') d
  ), cov as (
    select d, exists (
      select 1 from public.import_batches b
      where b.status = 'approved' and b.coverage_start <= d and d < b.coverage_end_exclusive
    ) as covered from days
  ), months as (
    select to_char(d, 'YYYY-MM') as period, count(*) as total, count(*) filter (where covered) as covered
    from cov group by 1
  ), gaps as (
    select min(d) as gap_start, max(d) + 1 as gap_end
    from (select d, covered, d - (row_number() over (order by d))::int as grp from cov where not covered) x
    group by grp
  )
  select jsonb_build_object(
    'status', case when (select count(*) filter (where covered) from cov) = 0 then 'none'
                   when (select bool_and(covered) from cov) then 'complete' else 'partial' end,
    'covered_days', (select count(*) filter (where covered) from cov),
    'total_days', (select count(*) from cov),
    'gaps', coalesce((select jsonb_agg(jsonb_build_object('start', gap_start, 'end_exclusive', gap_end) order by gap_start) from gaps), '[]'::jsonb),
    'months', coalesce((select jsonb_agg(jsonb_build_object('period', period,
                 'status', case when covered = 0 then 'none' when covered = total then 'complete' else 'partial' end) order by period) from months), '[]'::jsonb)
  );
$$;
revoke all on function public.coverage_for(date, date) from public, anon, authenticated;

create or replace function public.metric_dim_expr(p_dim text)
returns text language sql immutable set search_path = '' as $$
  select case p_dim
    when 'month' then $e$to_char(v.visit_at at time zone 'Asia/Riyadh', 'YYYY-MM')$e$
    when 'day' then $e$to_char(v.visit_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD')$e$
    when 'encounter_type' then $e$coalesce(v.encounter_type, '__unknown')$e$
    when 'department' then $e$coalesce(v.department, '__unknown')$e$
    when 'payor' then $e$coalesce(v.payor, '__unknown')$e$
    when 'discharge_type' then $e$coalesce(v.discharge_type, '__none')$e$
    when 'gender' then $e$coalesce(v.gender, '__unknown')$e$
    when 'nationality_group' then $e$case v.is_saudi when true then 'saudi' when false then 'non_saudi' else '__unknown' end$e$
    when 'age_band' then $e$case when v.age_years is null then '__unknown' when v.age_years < 14 then 'lt14'
       when v.age_years < 18 then '14to17' when v.age_years < 45 then '18to44'
       when v.age_years < 65 then '45to64' else '65plus' end$e$
    else null end;
$$;

create or replace function public.metric_where_except(f jsonb, p_skip text[])
returns text language plpgsql immutable set search_path = '' as $$
declare k text; w text := 'v.visit_at >= $1 and v.visit_at < $2';
begin
  for k in select jsonb_object_keys(f) loop
    if k = any (p_skip) then continue; end if;
    case k
      when 'encounter_type', 'department', 'payor', 'discharge_type' then
        if jsonb_typeof(f->k) <> 'array' or jsonb_array_length(f->k) = 0 then raise exception 'bad_filter:%', k; end if;
        w := w || format(' and v.%I = any (array(select jsonb_array_elements_text($3->%L)))', k, k);
      when 'gender' then
        if coalesce(f->>'gender', '') not in ('M', 'F') then raise exception 'bad_filter:gender'; end if;
        w := w || ' and v.gender = ($3->>''gender'')';
      when 'is_saudi' then
        if jsonb_typeof(f->'is_saudi') <> 'boolean' then raise exception 'bad_filter:is_saudi'; end if;
        w := w || ' and v.is_saudi = ($3->>''is_saudi'')::boolean';
      when 'age_min' then
        if jsonb_typeof(f->'age_min') <> 'number' then raise exception 'bad_filter:age_min'; end if;
        w := w || ' and v.age_years >= ($3->>''age_min'')::int';
      when 'age_max_exclusive' then
        if jsonb_typeof(f->'age_max_exclusive') <> 'number' then raise exception 'bad_filter:age_max_exclusive'; end if;
        w := w || ' and v.age_years < ($3->>''age_max_exclusive'')::int';
      else raise exception 'unsupported_filter:%', k;
    end case;
  end loop;
  return w;
end $$;

create or replace function public.metric_query(p_req jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_metric text := p_req->>'metric';
  v_start date;
  v_end date;
  f jsonb := coalesce(p_req->'filters', '{}'::jsonb);
  g text[] := '{}';
  k text;
  v_where text := 'v.visit_at >= $1 and v.visit_at < $2';
  v_agg text;
  v_dims text := '';
  v_sel text := '';
  v_i int := 0;
  v_ts_start timestamptz;
  v_ts_end timestamptz;
  v_value bigint;
  v_rows jsonb := '[]'::jsonb;
  v_cov jsonb;
  v_excl jsonb := '{}'::jsonb;
  v_n bigint;
  v_sources jsonb;
  v_cfg record;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  if v_metric not in ('visits', 'distinct_patients') then raise exception 'unsupported_metric:%', coalesce(v_metric, 'null'); end if;
  begin
    v_start := (p_req->>'start')::date;
    v_end := (p_req->>'end_exclusive')::date;
  exception when others then raise exception 'bad_dates'; end;
  if v_start is null or v_end is null or v_end <= v_start or v_end - v_start > 3700 then raise exception 'bad_dates'; end if;
  if jsonb_typeof(f) <> 'object' then raise exception 'bad_filters'; end if;
  if p_req ? 'group_by' then
    if jsonb_typeof(p_req->'group_by') <> 'array' then raise exception 'bad_group_by'; end if;
    g := array(select jsonb_array_elements_text(p_req->'group_by'));
  end if;
  if cardinality(g) > 2 then raise exception 'too_many_dimensions'; end if;

  v_ts_start := v_start::timestamp at time zone 'Asia/Riyadh';
  v_ts_end := v_end::timestamp at time zone 'Asia/Riyadh';

  v_where := public.metric_where_except(f, array[]::text[]);

  foreach k in array g loop
    if public.metric_dim_expr(k) is null then raise exception 'unsupported_dimension:%', k; end if;
    v_i := v_i + 1;
    v_sel := v_sel || format('%s as d%s, ', public.metric_dim_expr(k), v_i);
    v_dims := v_dims || case when v_i > 1 then ', ' else '' end || format('d%s', v_i);
  end loop;

  v_agg := case v_metric when 'visits' then 'count(*)' else 'count(distinct v.patient_key)' end;
  if v_metric = 'distinct_patients' then v_where := v_where || ' and v.patient_key is not null'; end if;

  v_cov := public.coverage_for(v_start, v_end);
  select * into v_cfg from public.app_config where id = 1;

  if v_cov->>'status' <> 'none' then
    execute format('select %s from public.visits v where %s', v_agg, v_where) into v_value using v_ts_start, v_ts_end, f;
    if cardinality(g) > 0 then
      execute format(
        'select coalesce(jsonb_agg(to_jsonb(x) order by %s), ''[]''::jsonb) from (select %s %s as value from public.visits v where %s group by %s) x',
        v_dims, v_sel, v_agg, v_where, v_dims) into v_rows using v_ts_start, v_ts_end, f;
    end if;

    -- Rows excluded because the attribute a filter needs is missing (other filters still applied).
    if f ? 'age_min' or f ? 'age_max_exclusive' then
      execute format('select count(*) from public.visits v where %s and v.age_years is null', public.metric_where_except(f, array['age_min','age_max_exclusive'])) into v_n using v_ts_start, v_ts_end, f;
      v_excl := v_excl || jsonb_build_object('unknown_age', v_n);
    end if;
    if f ? 'gender' then
      execute format('select count(*) from public.visits v where %s and v.gender is null', public.metric_where_except(f, array['gender'])) into v_n using v_ts_start, v_ts_end, f;
      v_excl := v_excl || jsonb_build_object('unknown_gender', v_n);
    end if;
    if f ? 'is_saudi' then
      execute format('select count(*) from public.visits v where %s and v.is_saudi is null', public.metric_where_except(f, array['is_saudi'])) into v_n using v_ts_start, v_ts_end, f;
      v_excl := v_excl || jsonb_build_object('unknown_nationality', v_n);
    end if;
    if v_metric = 'distinct_patients' then
      execute format('select count(*) from public.visits v where %s and v.patient_key is null', public.metric_where_except(f, array[]::text[])) into v_n using v_ts_start, v_ts_end, f;
      v_excl := v_excl || jsonb_build_object('unknown_patient', v_n);
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'file_name', b.file_name,
           'coverage_start', b.coverage_start, 'coverage_end_exclusive', b.coverage_end_exclusive) order by b.coverage_start), '[]'::jsonb)
    into v_sources
    from public.import_batches b
   where b.status = 'approved' and b.coverage_start < v_end and b.coverage_end_exclusive > v_start;

  return jsonb_build_object(
    'request', jsonb_build_object('metric', v_metric, 'start', v_start, 'end_exclusive', v_end, 'filters', f, 'group_by', to_jsonb(g)),
    'value', v_value,
    'rows', v_rows,
    'coverage', v_cov,
    'excluded', v_excl,
    'sources', v_sources,
    'dataset_version', v_cfg.dataset_version,
    'definition_version', v_cfg.definition_version,
    'extracted_at', now()
  );
end $$;
revoke all on function public.metric_query(jsonb) from public, anon;
grant execute on function public.metric_query(jsonb) to authenticated;

create or replace function public.data_catalog()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'hospital_name', c.hospital_name,
    'dataset_version', c.dataset_version,
    'definition_version', c.definition_version,
    'first_visit', (select min(visit_at) from public.visits),
    'last_visit', (select max(visit_at) from public.visits),
    'total_visits', (select count(*) from public.visits),
    'coverage', coalesce((select jsonb_agg(jsonb_build_object('start', coverage_start, 'end_exclusive', coverage_end_exclusive, 'file_name', file_name) order by coverage_start)
                  from public.import_batches where status = 'approved'), '[]'::jsonb),
    'values', jsonb_build_object(
      'encounter_type', coalesce((select jsonb_agg(jsonb_build_object('value', x, 'n', n) order by n desc) from (select encounter_type x, count(*) n from public.visits where encounter_type is not null group by 1) t), '[]'::jsonb),
      'department', coalesce((select jsonb_agg(jsonb_build_object('value', x, 'n', n) order by n desc) from (select department x, count(*) n from public.visits where department is not null group by 1) t), '[]'::jsonb),
      'payor', coalesce((select jsonb_agg(jsonb_build_object('value', x, 'n', n) order by n desc) from (select payor x, count(*) n from public.visits where payor is not null group by 1) t), '[]'::jsonb),
      'discharge_type', coalesce((select jsonb_agg(jsonb_build_object('value', x, 'n', n) order by n desc) from (select discharge_type x, count(*) n from public.visits where discharge_type is not null group by 1) t), '[]'::jsonb)
    ),
    'storage_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = 'private-files'),
    'database_bytes', pg_database_size(current_database())
  ) into v
  from public.app_config c where c.id = 1;
  return v;
end $$;
revoke all on function public.data_catalog() from public, anon;
grant execute on function public.data_catalog() to authenticated;
