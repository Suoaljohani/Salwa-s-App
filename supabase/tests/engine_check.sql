-- Generic engine verification. Everything is rolled back by the final RAISE EXCEPTION.
-- Expected: the error text starts with ENGINE_CHECK {"all_ok": true, ...}
do $chk$
declare
  uid uuid := gen_random_uuid();
  vds uuid; sds uuid; a uuid; d uuid; c uuid; s1 uuid; s2 uuid;
  res jsonb := '[]'::jsonb; ok boolean := true; r jsonb; t jsonb; dup boolean := false;
  vcols jsonb := '[{"key":"vid","label":"رقم الزيارة","type":"text","role":"identifier"},{"key":"mrn","label":"رقم الملف","type":"text","role":"identifier"},{"key":"enc","label":"نوع الزيارة","type":"text","role":"dimension"},{"key":"gender","label":"الجنس","type":"text","role":"dimension"},{"key":"nat","label":"الجنسية","type":"text","role":"dimension"},{"key":"age","label":"العمر","type":"number","role":"measure"},{"key":"at","label":"تاريخ الزيارة","type":"datetime","role":"date"},{"key":"name","label":"الاسم","type":"text","role":"ignore"}]';
  scols jsonb := '[{"key":"emp","label":"الرقم الوظيفي","type":"text","role":"identifier"},{"key":"cat","label":"الفئة","type":"text","role":"dimension"},{"key":"gender","label":"الجنس","type":"text","role":"dimension"},{"key":"years","label":"سنوات الخدمة","type":"number","role":"measure"},{"key":"hired","label":"تاريخ التعيين","type":"date","role":"date"}]';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'engine-check@invalid.local', '', now(), now(), now(), '{}', '{}');
  update public.app_config set owner_user_id = uid where id = 1;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);

  insert into public.datasets (name, unit_label, mode, period_column, key_column, columns) values ('زيارات', 'زيارة', 'append', 'at', 'vid', vcols) returning id into vds;
  insert into public.dataset_batches (dataset_id, file_name, file_sha256, coverage_start, coverage_end_exclusive) values (vds, 'A.xlsx', repeat('a', 64), '2026-07-01', '2026-08-01') returning id into a;
  perform public.ds_stage_rows(a, '[
   {"row_no":2,"data":{"vid":"A1","mrn":"P1","enc":"Emergency","gender":"Male","age":30,"at":"2026-07-01T00:00:00+03:00","nat":"SAUDI ARABIA","name":"X"}},
   {"row_no":3,"data":{"vid":"A2","mrn":"P1","enc":"Emergency","gender":"Male","age":30,"at":"2026-07-05T10:00:00+03:00","nat":"SAUDI ARABIA"}},
   {"row_no":4,"data":{"vid":"A3","mrn":"P1","enc":"Emergency","gender":"Male","age":30,"at":"2026-07-20T22:00:00+03:00","nat":"SAUDI ARABIA"}},
   {"row_no":5,"data":{"vid":"A4","mrn":"P2","enc":"Emergency","gender":"Female","age":18,"at":"2026-07-10T09:00:00+03:00","nat":"SAUDI ARABIA"}},
   {"row_no":6,"data":{"vid":"A5","mrn":"P3","enc":"Emergency","gender":"Male","age":17,"at":"2026-07-11T09:00:00+03:00","nat":"SAUDI ARABIA"}},
   {"row_no":7,"data":{"vid":"A6","mrn":"P4","enc":"Emergency","at":"2026-07-12T09:00:00+03:00","nat":"SAUDI ARABIA"}},
   {"row_no":8,"data":{"vid":"A7","mrn":"P5","enc":"Outpatient","gender":"Female","age":40,"at":"2026-07-15T09:00:00+03:00","nat":"EGYPT"}},
   {"row_no":9,"data":{"vid":"A8","mrn":"P6","enc":"Outpatient","gender":"Female","age":8,"at":"2026-07-31T23:59:00+03:00","nat":"SAUDI ARABIA"}},
   {"row_no":10,"data":{"vid":"A9","enc":"Emergency","gender":"Male","age":50,"at":"2026-07-16T09:00:00+03:00","nat":"SAUDI ARABIA"}},
   {"row_no":11,"data":{"vid":"A9","enc":"Emergency","gender":"Male","age":50,"at":"2026-07-16T09:00:00+03:00","nat":"SAUDI ARABIA"}}]'::jsonb);
  perform public.ds_approve(a);
  insert into public.dataset_batches (dataset_id, file_name, file_sha256, coverage_start, coverage_end_exclusive) values (vds, 'D.xlsx', repeat('d', 64), '2026-08-01', '2026-08-16') returning id into d;
  perform public.ds_stage_rows(d, '[{"row_no":2,"data":{"vid":"D1","mrn":"P1","enc":"Emergency","gender":"Male","age":30,"at":"2026-08-01T00:00:00+03:00","nat":"SAUDI ARABIA"}},{"row_no":3,"data":{"vid":"D2","mrn":"P8","enc":"Emergency","gender":"Female","age":22,"at":"2026-08-10T12:00:00+03:00","nat":"SAUDI ARABIA"}}]'::jsonb);
  perform public.ds_approve(d);
  begin
    insert into public.dataset_batches (dataset_id, file_name, file_sha256, coverage_start, coverage_end_exclusive) values (vds, 'A2.xlsx', repeat('a', 64), '2026-07-01', '2026-08-01');
  exception when unique_violation then dup := true; end;
  res := res || jsonb_build_object('t', 'duplicate file blocked', 'got', dup);
  res := res || jsonb_build_object('t', 'personal column dropped, ids hashed, duplicate key in file', 'got',
    (select jsonb_build_object('has_name', bool_or(data ? 'name'), 'mrn_hashed', bool_and(length(data->>'mrn') = 64 or data->>'mrn' is null), 'rows', count(*)) from public.dataset_rows where batch_id = a));

  for t in select * from jsonb_array_elements('[
    {"t":"visits July","want":9,"q":{"measure":{"op":"count"}}},
    {"t":"distinct patients July","want":6,"q":{"measure":{"op":"count_distinct","column":"mrn"}}},
    {"t":"ER 18+ includes 18","want":5,"q":{"filters":[{"column":"enc","op":"eq","value":"Emergency"},{"column":"age","op":"gte","value":18}]}},
    {"t":"under 18","want":2,"q":{"filters":[{"column":"age","op":"lt","value":18}]}},
    {"t":"OP incl 23:59 Jul 31","want":2,"q":{"filters":[{"column":"enc","op":"eq","value":"Outpatient"}]}},
    {"t":"Aug incl 00:00 Aug 1 (partial)","want":2,"q":{"period":{"start":"2026-08-01","end_exclusive":"2026-09-01"}}},
    {"t":"June uncovered = null","want":null,"q":{"period":{"start":"2026-06-01","end_exclusive":"2026-07-01"}}},
    {"t":"covered zero = 0","want":0,"q":{"filters":[{"column":"nat","op":"neq","value":"SAUDI ARABIA"},{"column":"enc","op":"eq","value":"Emergency"}]}},
    {"t":"distinct across months","want":7,"q":{"measure":{"op":"count_distinct","column":"mrn"},"group_by":[{"column":"at","grain":"month"}],"period":{"start":"2026-07-01","end_exclusive":"2026-09-01"}}},
    {"t":"age bins","want":9,"q":{"group_by":[{"column":"age","bins":[14,18,45,65]}]}},
    {"t":"max age","want":50,"q":{"measure":{"op":"max","column":"age"}}}
  ]'::jsonb) loop
    r := public.dataset_query(jsonb_build_object('dataset_id', vds, 'measure', '{"op":"count"}'::jsonb, 'filters', '[]'::jsonb, 'group_by', '[]'::jsonb,
           'period', '{"start":"2026-07-01","end_exclusive":"2026-08-01"}'::jsonb) || (t->'q'));
    res := res || jsonb_build_object('t', t->>'t', 'got', r->'value', 'want', t->'want', 'cov', r->'coverage'->>'status', 'excl', r->'excluded', 'rows', r->'rows');
    if (r->>'value')::numeric is distinct from (t->>'want')::numeric then ok := false; end if;
  end loop;

  insert into public.dataset_batches (dataset_id, file_name, file_sha256, coverage_start, coverage_end_exclusive) values (vds, 'C.xlsx', repeat('c', 64), '2026-07-01', '2026-08-01') returning id into c;
  perform public.ds_stage_rows(c, '[{"row_no":2,"data":{"vid":"A1","mrn":"P1","enc":"Emergency","gender":"Male","age":30,"at":"2026-07-01T00:00:00+03:00"}},{"row_no":3,"data":{"vid":"A7","mrn":"P5","enc":"Outpatient","gender":"Male","age":40,"at":"2026-07-15T09:00:00+03:00"}},{"row_no":4,"data":{"vid":"C1","mrn":"P7","enc":"Emergency","gender":"Female","age":65,"at":"2026-07-25T09:00:00+03:00"}}]'::jsonb);
  perform public.ds_approve(c);
  r := public.dataset_query(jsonb_build_object('dataset_id', vds, 'measure', '{"op":"count"}'::jsonb, 'filters', '[]'::jsonb, 'group_by', '[]'::jsonb, 'period', '{"start":"2026-07-01","end_exclusive":"2026-09-01"}'::jsonb));
  res := res || jsonb_build_object('t', 'corrected July replaces July only', 'got', r->'value', 'want', 5);
  if (r->>'value')::int <> 5 then ok := false; end if;
  perform public.ds_close(c, 'rolled_back');
  r := public.dataset_query(jsonb_build_object('dataset_id', vds, 'measure', '{"op":"count"}'::jsonb, 'filters', '[]'::jsonb, 'group_by', '[]'::jsonb, 'period', '{"start":"2026-07-01","end_exclusive":"2026-09-01"}'::jsonb));
  res := res || jsonb_build_object('t', 'rollback restores', 'got', r->'value', 'want', 11);
  if (r->>'value')::int <> 11 then ok := false; end if;

  insert into public.datasets (name, unit_label, mode, key_column, columns) values ('الموظفون', 'موظف', 'snapshot', 'emp', scols) returning id into sds;
  insert into public.dataset_batches (dataset_id, file_name, file_sha256, as_of) values (sds, 's1.xlsx', repeat('1', 64), '2026-10-01') returning id into s1;
  perform public.ds_stage_rows(s1, '[{"row_no":2,"data":{"emp":"E1","cat":"تمريض","gender":"Female","years":5,"hired":"2021-03-01"}},{"row_no":3,"data":{"emp":"E2","cat":"تمريض","gender":"Female","years":12,"hired":"2014-09-15"}},{"row_no":4,"data":{"emp":"E3","cat":"أطباء","gender":"Male","years":"abc","hired":"bad"}}]'::jsonb);
  perform public.ds_approve(s1);
  insert into public.dataset_batches (dataset_id, file_name, file_sha256, as_of) values (sds, 's2.xlsx', repeat('2', 64), '2026-11-01') returning id into s2;
  perform public.ds_stage_rows(s2, '[{"row_no":2,"data":{"emp":"E1","cat":"تمريض","gender":"Female","years":6}},{"row_no":3,"data":{"emp":"E4","cat":"إداريون","gender":"Male","years":2}}]'::jsonb);
  perform public.ds_approve(s2);
  r := public.dataset_query(jsonb_build_object('dataset_id', sds, 'measure', '{"op":"count"}'::jsonb, 'filters', '[]'::jsonb, 'group_by', '[{"column":"cat"}]'::jsonb));
  res := res || jsonb_build_object('t', 'snapshot replaced (2 staff now)', 'got', r->'value', 'want', 2, 'rows', r->'rows');
  if (r->>'value')::int <> 2 then ok := false; end if;
  r := public.dataset_query(jsonb_build_object('dataset_id', sds, 'measure', '{"op":"avg","column":"years"}'::jsonb, 'filters', '[]'::jsonb, 'group_by', '[]'::jsonb));
  res := res || jsonb_build_object('t', 'avg years', 'got', r->'value', 'want', 4);
  if (r->>'value')::numeric <> 4 then ok := false; end if;
  perform public.ds_close(s2, 'rolled_back');
  r := public.dataset_query(jsonb_build_object('dataset_id', sds, 'measure', '{"op":"avg","column":"years"}'::jsonb, 'filters', '[]'::jsonb, 'group_by', '[]'::jsonb));
  res := res || jsonb_build_object('t', 'roster rollback; unreadable number dropped and reported', 'got', r->'value', 'want', 8.5, 'excl', r->'excluded');
  if (r->>'value')::numeric <> 8.5 then ok := false; end if;
  begin
    perform public.dataset_query(jsonb_build_object('dataset_id', sds, 'measure', '{"op":"count"}'::jsonb, 'filters', '[{"column":"not_a_column","op":"eq","value":1}]'::jsonb, 'group_by', '[]'::jsonb));
    ok := false;
  exception when others then res := res || jsonb_build_object('t', 'unknown column rejected', 'got', sqlerrm); end;
  begin
    perform public.dataset_query(jsonb_build_object('dataset_id', sds, 'measure', '{"op":"count"}'::jsonb, 'filters', '[]'::jsonb, 'group_by', '[]'::jsonb, 'period', '{"start":"2026-07-01","end_exclusive":"2026-08-01"}'::jsonb));
    ok := false;
  exception when others then res := res || jsonb_build_object('t', 'period on snapshot rejected', 'got', sqlerrm); end;
  if not dup then ok := false; end if;
  raise exception 'ENGINE_CHECK %', jsonb_build_object('all_ok', ok, 'results', res)::text;
end
$chk$;
