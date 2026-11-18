// Generates supabase/tests/engine_check.sql from the shared edge-case fixture.
// Run: npx vitest run scripts/gen-engine-check.test.ts
import { writeFileSync } from 'node:fs';
import { test } from 'vitest';
import { batchA, batchC, batchD, windows } from '../tests/fixtures/edgeCases';
import type { VisitRow } from '../src/lib/metrics/types';

const rows = (b: VisitRow[]) => JSON.stringify(b.map((r, i) => ({ ...r, row_no: i + 2, mrn: r.patient_key }))).replace(/'/g, "''");
const hash = (c: string) => c.repeat(64);

test('generate', () => {
  const sql = `-- Engine verification against the edge-case fixture. Runs inside one DO block that ends with
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

  insert into public.import_batches (file_name, file_sha256, coverage_start, coverage_end_exclusive) values ('A.xlsx', '${hash('a')}', '${windows.A.start}', '${windows.A.end_exclusive}') returning id into a;
  perform public.stage_rows(a, '${rows(batchA)}'::jsonb);
  perform public.approve_batch(a);
  insert into public.import_batches (file_name, file_sha256, coverage_start, coverage_end_exclusive) values ('D.xlsx', '${hash('d')}', '${windows.D.start}', '${windows.D.end_exclusive}') returning id into d;
  perform public.stage_rows(d, '${rows(batchD)}'::jsonb);
  perform public.approve_batch(d);

  begin
    insert into public.import_batches (file_name, file_sha256, coverage_start, coverage_end_exclusive) values ('A-again.xlsx', '${hash('a')}', '2026-07-01', '2026-08-01');
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

  insert into public.import_batches (file_name, file_sha256, coverage_start, coverage_end_exclusive) values ('C.xlsx', '${hash('c')}', '${windows.C.start}', '${windows.C.end_exclusive}') returning id into c;
  perform public.stage_rows(c, '${rows(batchC)}'::jsonb);
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
`;
  writeFileSync('supabase/tests/engine_check.sql', sql);
});
