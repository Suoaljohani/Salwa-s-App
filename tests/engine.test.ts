import { describe, expect, test } from 'vitest';
import { runLocalQuery, validateRequest, type LocalDataset } from '../src/lib/metrics/localEngine';
import type { MetricRequest, VisitRow } from '../src/lib/metrics/types';
import { batchA, batchC, batchD, windows } from './fixtures/edgeCases';

const JULY = { start: '2026-07-01', end_exclusive: '2026-08-01' };
const ds = (rows: VisitRow[], w: { start: string; end_exclusive: string }[]): LocalDataset => ({
  rows, windows: w.map((x, i) => ({ ...x, id: String(i), file_name: `f${i}` })), datasetVersion: 1, demo: false,
});
const q = (d: LocalDataset, r: Partial<MetricRequest>) =>
  runLocalQuery(d, { metric: 'visits', ...JULY, filters: {}, group_by: [], ...r } as MetricRequest);

describe('metric definitions (local engine)', () => {
  const A = ds([...batchA, ...batchD], [windows.A, windows.D]);

  test('visits vs distinct patients', () => {
    expect(q(A, {}).value).toBe(9);
    const p = q(A, { metric: 'distinct_patients' });
    expect(p.value).toBe(6); // P1 counted once; A9 has no MRN
    expect(p.excluded.unknown_patient).toBe(1);
  });

  test('18 and over includes exactly 18; unknown age is excluded and reported', () => {
    const r = q(A, { filters: { encounter_type: ['Emergency'], age_min: 18 } });
    expect(r.value).toBe(5); // A1 A2 A3 A4(18) A9
    expect(r.excluded.unknown_age).toBe(1);
    expect(q(A, { filters: { age_max_exclusive: 18 } }).value).toBe(2); // A5(17), A8(8)
  });

  test('Riyadh month boundaries', () => {
    expect(q(A, { filters: { encounter_type: ['Outpatient'] } }).value).toBe(2); // includes 23:59 on Jul 31
    const aug = q(A, { start: '2026-08-01', end_exclusive: '2026-09-01' });
    expect(aug.value).toBe(2); // includes 00:00 on Aug 1
    expect(aug.coverage.status).toBe('partial');
    expect(aug.coverage.covered_days).toBe(15);
  });

  test('uncovered period is null, not zero; covered empty period is zero', () => {
    const june = q(A, { start: '2026-06-01', end_exclusive: '2026-07-01' });
    expect(june.value).toBeNull();
    expect(june.coverage.status).toBe('none');
    expect(q(A, { filters: { gender: 'F', is_saudi: false, encounter_type: ['Emergency'] } }).value).toBe(0);
  });

  test('grouping and age bands', () => {
    const r = q(A, { group_by: ['age_band'] });
    const m = Object.fromEntries(r.rows.map((x) => [x.d1, x.value]));
    expect(m).toEqual({ '14to17': 1, '18to44': 5, '45to64': 1, lt14: 1, __unknown: 1 });
    const g = q(A, { metric: 'distinct_patients', group_by: ['month'], start: '2026-07-01', end_exclusive: '2026-09-01' });
    expect(g.rows).toEqual([{ d1: '2026-07', value: 6 }, { d1: '2026-08', value: 2 }]);
    expect(g.value).toBe(7); // P1 appears in both months but once overall
  });

  test('corrected version replaces, never adds (simulated rebuild)', () => {
    // After approving C, the active July set is C only.
    const C = ds([...batchC, ...batchD], [windows.C, windows.D]);
    expect(q(C, {}).value).toBe(9); // 9 - A5 + C1
    expect(q(C, { filters: { gender: 'F' } }).value).toBe(3); // A4, A8, C1 (A7 corrected to M)
  });

  test('request validation rejects unknown fields', () => {
    expect(() => validateRequest({ metric: 'visits', ...JULY, filters: { ctas: [1] } as never, group_by: [] })).toThrow(/unsupported_filter/);
    expect(() => validateRequest({ metric: 'visits', start: '2026-08-01', end_exclusive: '2026-07-01', filters: {}, group_by: [] })).toThrow(/bad_dates/);
    expect(() => validateRequest({ metric: 'visits', ...JULY, filters: {}, group_by: ['month', 'gender', 'age_band'] })).toThrow(/too_many/);
  });
});
