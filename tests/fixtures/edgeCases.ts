// Edge-case fixture shared by the TypeScript engine tests and supabase/tests/engine_check.sql.
// Synthetic; no real patients.
import type { VisitRow } from '../../src/lib/metrics/types';

const v = (visit_id: string, patient: string | null, enc: string, gender: 'M' | 'F' | null, age: number | null, at: string, saudi: boolean | null = true): VisitRow => ({
  visit_id, patient_key: patient, encounter_type: enc, department: enc === 'Emergency' ? 'Emergency Medicine' : 'Pediatrics Clinic', clinic: null,
  gender, age_years: age, nationality: saudi == null ? null : saudi ? 'SAUDI ARABIA' : 'EGYPT', is_saudi: saudi, payor: 'Saudi Government',
  patient_type: null, visit_at: at, discharge_type: null, los: null,
});

/** Batch A: July 2026 original. */
export const batchA: VisitRow[] = [
  v('A1', 'P1', 'Emergency', 'M', 30, '2026-07-01T00:00:00+03:00'), // first second of July (local)
  v('A2', 'P1', 'Emergency', 'M', 30, '2026-07-05T10:00:00+03:00'), // same patient again
  v('A3', 'P1', 'Emergency', 'M', 30, '2026-07-20T22:00:00+03:00'), // and again
  v('A4', 'P2', 'Emergency', 'F', 18, '2026-07-10T09:00:00+03:00'), // exactly 18 → in "18 and over"
  v('A5', 'P3', 'Emergency', 'M', 17, '2026-07-11T09:00:00+03:00'), // 17 → not
  v('A6', 'P4', 'Emergency', null, null, '2026-07-12T09:00:00+03:00'), // unknown age and gender
  v('A7', 'P5', 'Outpatient', 'F', 40, '2026-07-15T09:00:00+03:00', false),
  v('A8', 'P6', 'Outpatient', 'F', 8, '2026-07-31T23:59:00+03:00'), // last minute of July (UTC 20:59 on 31st)
  v('A9', null, 'Emergency', 'M', 50, '2026-07-16T09:00:00+03:00'), // no MRN → not in distinct patients
];

/** Batch C: corrected July. A5 removed, A7 gender corrected, one new visit. Replaces A inside July. */
export const batchC: VisitRow[] = [
  ...batchA.filter((r) => r.visit_id !== 'A5' && r.visit_id !== 'A7'),
  { ...batchA.find((r) => r.visit_id === 'A7')!, gender: 'M' },
  v('C1', 'P7', 'Emergency', 'F', 65, '2026-07-25T09:00:00+03:00'),
];

/** Batch D: 1–15 August only (August is partially covered). */
export const batchD: VisitRow[] = [
  v('D1', 'P1', 'Emergency', 'M', 30, '2026-08-01T00:00:00+03:00'), // first minute of August (UTC 21:00 on Jul 31)
  v('D2', 'P8', 'Emergency', 'F', 22, '2026-08-10T12:00:00+03:00'),
];

export const windows = {
  A: { start: '2026-07-01', end_exclusive: '2026-08-01' },
  C: { start: '2026-07-01', end_exclusive: '2026-08-01' },
  D: { start: '2026-08-01', end_exclusive: '2026-08-16' },
};
