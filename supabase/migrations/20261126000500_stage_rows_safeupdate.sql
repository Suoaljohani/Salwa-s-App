-- Supabase API requests run with pg-safeupdate: every UPDATE/DELETE needs a WHERE clause.
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
  delete from pg_temp._rows where true;
  insert into pg_temp._rows select (x->>'row_no')::int, null, coalesce(x->'data', '{}'::jsonb) from jsonb_array_elements(p_rows) x;

  for c in select * from jsonb_array_elements(ds.columns) loop
    k := c->>'key';
    if c->>'role' = 'ignore' then
      update pg_temp._rows set data = data - k where true;
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
                           where exists (select 1 from jsonb_array_elements(ds.columns) cc where cc->>'key' = e.key and cc->>'role' <> 'ignore'))
   where true;
  if ds.key_column is not null then update pg_temp._rows set row_key = data->>ds.key_column where true; end if;

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
