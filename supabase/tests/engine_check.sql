-- Engine verification against the edge-case fixture. Runs inside one DO block that ends with
-- RAISE EXCEPTION, so every change (temporary user, batches, visits) is rolled back.
do $chk$
declare
  uid uuid := gen_random_uuid();
  a uuid; c uuid; d uuid;
  res jsonb := '[]'::jsonb;
  ok boolean := true;
  r jsonb;
  dup_blocked boolean := false;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'engine-check@invalid.local', '', now(), now(), now(), '{}', '{}');
  update public.app_config set owner_user_id = uid where id = 1;
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);

  insert into public.import_batches (file_name, file_sha256, coverage_start, coverage_end_exclusive) values ('A.xlsx', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-07-01', '2026-08-01') returning id into a;
  perform public.stage_rows(a, '[{"visit_id":"A1","patient_key":"P1","encounter_type":"Emergency","department":"Emergency Medicine","clinic":null,"gender":"M","age_years":30,"nationality":"SAUDI ARABIA","is_saudi":true,"payor":"Saudi Government","patient_type":null,"visit_at":"2026-07-01T00:00:00+03:00","discharge_type":null,"los":null,"row_no":2,"mrn":"P1"},{"visit_id":"A2","patient_key":"P1","encounter_type":"Emergency","department":"Emergency Medicine","clinic":null,"gender":"M","age_years":30,"nationality":"SAUDI ARABIA","is_saudi":true,"payor":"Saudi Government","patient_type":null,"visit_at":"2026-07-05T10:00:00+03:00","discharge_type":null,"los":null,"row_no":3,"mrn":"P1"},{"visit_id":"A3","patient_key":"P1","encounter_type":"Emergency","department":"Emergency Medicine","clinic":null,"gender":"M","age_years":30,"nationality":"SAUDI ARABIA","is_saudi":true,"payor":"Saudi Government","patient_type":null,"visit_at":"2026-07-20T22:00:00+03:00","discharge_type":null,"los":null,"row_no":4,"mrn":"P1"},{"visit_id":"A4","patient_key":"P2","encounter_type":"Emergency","department":"Emergency Medicine","clinic":null,"gender":"F","age_years":18,"nationality":"SAUDI ARABIA","is_saudi":true,"payor":"Saudi Government","patient_type":null,"visit_at":"2026-07-10T09:00:00+03:00","discharge_type":null,"los":null,"row_no":5,"mrn":"P2"},{"visit_id":"A5","patient_key":"P3","encounter_type":"Emergency","department":"Emergency Medicine","clinic":null,"gender":"M","age_years":17,"nationality":"SAUDI ARABIA","is_saudi":true,"payor":"Saudi Government","patient_type":null,"visit_at":"2026-07-11T09:00:00+03:00","discharge_type":null,"los":null,"row_no":6,"mrn":"P3"},{"visit_id":"A6","patient_key":"P4","encounter_type":"Emergency","department":"Emergency Medicine","clinic":null,"gender":null,"age_years":null,"nationality":"SAUDI ARABIA","is_saudi":true,"payor":"Saudi Government","patient_type":null,"visit_at":"2026-07-12T09:00:00+03:00","discharge_type":null,"los":null,"row_no":7,"mrn":"P4"},{"visit_id":"A7","patient_key":"P5","encounter_type":"Outpatient","department":"Pediatrics Clinic","clinic":null,"gender":"F","age_years":40,"nationality":"EGYPT","is_saudi":false,"payor":"Saudi Government","patient_type":null,"visit_at":"2026-07-15T09:00:00+03:00","discharge_type":null,"los":null,"row_no":8,"mrn":"P5"},{"visit_id":"A8","patient_key":"P6","encounter_type":"Outpatient","department":"Pediatrics Clinic","clinic":null,"gender":"F","age_years":8,"nationality":"SAUDI ARABIA","is_saudi":true,"payor":"Saudi Government","patient_type":null,"visit_at":"2026-07-31T23:59:00+03:00","discharge_type":null,"los":null,"row_no":9,"mrn":"P6"},{"visit_id":"A9","patient_key":null,"encounter_type":"Emergency","department":"Emergency Medicine","clinic":null,"gender":"M","age_years":50,"nationality":"SAUDI ARABIA","is_saudi":true,"payor":"Saudi Government","patient_type":null,"visit_at":"2026-07-16T09:00:00+03:00","discharge_type":null,"los":null,"row_no":10,"mrn":null}]'::jsonb);
  perform public.approve_batch(a);
  insert into public.import_batches (file_name, file_sha256, coverage_start, coverage_end_exclusive) values ('D.xlsx', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', '2026-08-01', '2026-08-16') returning id into d;
  perform public.stage_rows(d, '[{"visit_id":"D1","patient_key":"P1","encounter_type":"Emergency","department":"Emergency Medicine","clinic":null,"gender":"M","age_years":30,"nationality":"SAUDI ARABIA","is_saudi":true,"payor":"Saudi Government","patient_type":null,"visit_at":"2026-08-01T00:00:00+03:00","discharge_type":null,"los":null,"row_no":2,"mrn":"P1"},{"visit_id":"D2","patient_key":"P8","encounter_type":"Emergency","department":"Emergency Medicine","clinic":null,"gender":"F","age_years":22,"nationality":"SAUDI ARABIA","is_saudi":true,"payor":"Saudi Government","patient_type":null,"visit_at":"2026-08-10T12:00:00+03:00","discharge_type":null,"los":null,"row_no":3,"mrn":"P8"}]'::jsonb);
  perform public.approve_batch(d);

  begin
    insert into public.import_batches (file_name, file_sha256, coverage_start, coverage_end_exclusive) values ('A-again.xlsx', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-07-01', '2026-08-01');
  exception when unique_violation then dup_blocked := true;
  end;
  res := res || jsonb_build_object('t', 'duplicate file blocked', 'got', dup_blocked, 'want', true);

  -- name, request, expected value
  for r in select * from jsonb_array_elements('[
    {"t":"visits July","q":{"metric":"visits","start":"2026-07-01","end_exclusive":"2026-08-01"},"want":9},
    {"t":"distinct patients July","q":{"metric":"distinct_patients","start":"2026-07-01","end_exclusive":"2026-08-01"},"want":6},
    {"t":"ER 18+ includes 18","q":{"metric":"visits","start":"2026-07-01","end_exclusive":"2026-08-01","filters":{"encounter_type":["Emergency"],"age_min":18}},"want":5},
    {"t":"under 18","q":{"metric":"visits","start":"2026-07-01","end_exclusive":"2026-08-01","filters":{"age_max_exclusive":18}},"want":2},
    {"t":"OP July incl 23:59 Jul 31","q":{"metric":"visits","start":"2026-07-01","end_exclusive":"2026-08-01","filters":{"encounter_type":["Outpatient"]}},"want":2},
    {"t":"August incl 00:00 Aug 1","q":{"metric":"visits","start":"2026-08-01","end_exclusive":"2026-09-01"},"want":2},
    {"t":"June uncovered = null","q":{"metric":"visits","start":"2026-06-01","end_exclusive":"2026-07-01"},"want":null},
    {"t":"covered zero = 0","q":{"metric":"visits","start":"2026-07-01","end_exclusive":"2026-08-01","filters":{"gender":"F","is_saudi":false,"encounter_type":["Emergency"]}},"want":0},
    {"t":"distinct across months","q":{"metric":"distinct_patients","start":"2026-07-01","end_exclusive":"2026-09-01","group_by":["month"]},"want":7}
  ]'::jsonb) loop
    declare out jsonb := public.metric_query(r->'q'); begin
      res := res || jsonb_build_object('t', r->>'t', 'got', out->'value', 'want', r->'want', 'coverage', out->'coverage'->>'status', 'excluded', out->'excluded', 'rows', out->'rows');
      if (out->'value') is distinct from (r->'want') then ok := false; end if;
    end;
  end loop;

  insert into public.import_batches (file_name, file_sha256, coverage_start, coverage_end_exclusive) values ('C.xlsx', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', '2026-07-01', '2026-08-01') returning id into c;
  perform public.stage_rows(c, '[{"visit_id":"A1","patient_key":"P1","encounter_type":"Emergency","department":"Emergency Medicine","clinic":null,"gender":"M","age_years":30,"nationality":"SAUDI ARABIA","is_saudi":true,"payor":"Saudi Government","patient_type":null,"visit_at":"2026-07-01T00:00:00+03:00","discharge_type":null,"los":null,"row_no":2,"mrn":"P1"},{"visit_id":"A2","patient_key":"P1","encounter_type":"Emergency","department":"Emergency Medicine","clinic":null,"gender":"M","age_years":30,"nationality":"SAUDI ARABIA","is_saudi":true,"payor":"Saudi Government","patient_type":null,"visit_at":"2026-07-05T10:00:00+03:00","discharge_type":null,"los":null,"row_no":3,"mrn":"P1"},{"visit_id":"A3","patient_key":"P1","encounter_type":"Emergency","department":"Emergency Medicine","clinic":null,"gender":"M","age_years":30,"nationality":"SAUDI ARABIA","is_saudi":true,"payor":"Saudi Government","patient_type":null,"visit_at":"2026-07-20T22:00:00+03:00","discharge_type":null,"los":null,"row_no":4,"mrn":"P1"},{"visit_id":"A4","patient_key":"P2","encounter_type":"Emergency","department":"Emergency Medicine","clinic":null,"gender":"F","age_years":18,"nationality":"SAUDI ARABIA","is_saudi":true,"payor":"Saudi Government","patient_type":null,"visit_at":"2026-07-10T09:00:00+03:00","discharge_type":null,"los":null,"row_no":5,"mrn":"P2"},{"visit_id":"A6","patient_key":"P4","encounter_type":"Emergency","department":"Emergency Medicine","clinic":null,"gender":null,"age_years":null,"nationality":"SAUDI ARABIA","is_saudi":true,"payor":"Saudi Government","patient_type":null,"visit_at":"2026-07-12T09:00:00+03:00","discharge_type":null,"los":null,"row_no":6,"mrn":"P4"},{"visit_id":"A8","patient_key":"P6","encounter_type":"Outpatient","department":"Pediatrics Clinic","clinic":null,"gender":"F","age_years":8,"nationality":"SAUDI ARABIA","is_saudi":true,"payor":"Saudi Government","patient_type":null,"visit_at":"2026-07-31T23:59:00+03:00","discharge_type":null,"los":null,"row_no":7,"mrn":"P6"},{"visit_id":"A9","patient_key":null,"encounter_type":"Emergency","department":"Emergency Medicine","clinic":null,"gender":"M","age_years":50,"nationality":"SAUDI ARABIA","is_saudi":true,"payor":"Saudi Government","patient_type":null,"visit_at":"2026-07-16T09:00:00+03:00","discharge_type":null,"los":null,"row_no":8,"mrn":null},{"visit_id":"A7","patient_key":"P5","encounter_type":"Outpatient","department":"Pediatrics Clinic","clinic":null,"gender":"M","age_years":40,"nationality":"EGYPT","is_saudi":false,"payor":"Saudi Government","patient_type":null,"visit_at":"2026-07-15T09:00:00+03:00","discharge_type":null,"los":null,"row_no":9,"mrn":"P5"},{"visit_id":"C1","patient_key":"P7","encounter_type":"Emergency","department":"Emergency Medicine","clinic":null,"gender":"F","age_years":65,"nationality":"SAUDI ARABIA","is_saudi":true,"payor":"Saudi Government","patient_type":null,"visit_at":"2026-07-25T09:00:00+03:00","discharge_type":null,"los":null,"row_no":10,"mrn":"P7"}]'::jsonb);
  perform public.approve_batch(c);
  r := public.metric_query('{"metric":"visits","start":"2026-07-01","end_exclusive":"2026-08-01"}');
  res := res || jsonb_build_object('t', 'corrected July replaces (not adds)', 'got', r->'value', 'want', 9);
  if (r->'value')::int <> 9 then ok := false; end if;
  r := public.metric_query('{"metric":"visits","start":"2026-07-01","end_exclusive":"2026-08-01","filters":{"encounter_type":["Outpatient"],"gender":"M"}}');
  res := res || jsonb_build_object('t', 'corrected gender applied', 'got', r->'value', 'want', 1);
  if (r->'value')::int <> 1 then ok := false; end if;

  perform public.close_batch(c, 'rolled_back');
  r := public.metric_query('{"metric":"visits","start":"2026-07-01","end_exclusive":"2026-08-01","filters":{"encounter_type":["Outpatient"],"gender":"M"}}');
  res := res || jsonb_build_object('t', 'rollback restores A', 'got', r->'value', 'want', 0);
  if (r->'value')::int <> 0 then ok := false; end if;
  r := public.metric_query('{"metric":"visits","start":"2026-07-01","end_exclusive":"2026-08-01","filters":{"age_max_exclusive":18}}');
  res := res || jsonb_build_object('t', 'rollback restores A (A5 back)', 'got', r->'value', 'want', 2);
  if (r->'value')::int <> 2 then ok := false; end if;

  if not dup_blocked then ok := false; end if;
  raise exception 'ENGINE_CHECK %', jsonb_build_object('all_ok', ok, 'results', res)::text;
end
$chk$;
