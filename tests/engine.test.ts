import { describe, expect, test } from 'vitest';
import { runLocalQuery, validateRequest } from '../src/lib/metrics/localEngine';
import type { StatRequest } from '../src/lib/metrics/types';
import { batchA, batchD, staffDs, visitsDs, visitsInfo } from './fixtures/datasets';

const JULY = { start: '2026-07-01', end_exclusive: '2026-08-01' };
const V = visitsDs([...batchA, ...batchD], [JULY, { start: '2026-08-01', end_exclusive: '2026-08-16' }]);
const q = (r: Partial<StatRequest>) => runLocalQuery(V, { dataset_id: 'v', measure: { op: 'count' }, filters: [], group_by: [], period: JULY, ...r });

describe('generic engine — visits (append dataset)', () => {
  test('rows vs distinct identifiers', () => {
    expect(q({}).value).toBe(9);
    const d = q({ measure: { op: 'count_distinct', column: 'mrn' } });
    expect(d.value).toBe(6);
    expect(d.excluded).toEqual([{ column: 'mrn', label: 'رقم الملف الطبي', n: 1, measure: true }]);
  });
  test('18 and over includes exactly 18; missing age excluded and reported, never zero', () => {
    const r = q({ filters: [{ column: 'enc', op: 'eq', value: 'Emergency' }, { column: 'age', op: 'gte', value: 18 }] });
    expect(r.value).toBe(5);
    expect(r.excluded).toEqual([{ column: 'age', label: 'العمر', n: 1 }]);
    expect(q({ filters: [{ column: 'age', op: 'lt', value: 18 }] }).value).toBe(2);
  });
  test('Riyadh day boundaries on datetime columns', () => {
    expect(q({ filters: [{ column: 'enc', op: 'eq', value: 'Outpatient' }] }).value).toBe(2);
    const aug = q({ period: { start: '2026-08-01', end_exclusive: '2026-09-01' } });
    expect(aug.value).toBe(2);
    expect(aug.coverage?.status).toBe('partial');
    expect(aug.coverage?.covered_days).toBe(15);
  });
  test('uncovered = null, covered empty = 0', () => {
    const june = q({ period: { start: '2026-06-01', end_exclusive: '2026-07-01' } });
    expect(june.value).toBeNull();
    expect(june.coverage?.status).toBe('none');
    expect(q({ filters: [{ column: 'nat', op: 'neq', value: 'SAUDI ARABIA' }, { column: 'enc', op: 'eq', value: 'Emergency' }] }).value).toBe(0);
  });
  test('numeric bins and month grain', () => {
    const r = q({ group_by: [{ column: 'age', bins: [14, 18, 45, 65] }] });
    expect(Object.fromEntries(r.rows.map((x) => [x.d1, x.value]))).toEqual({ 'lt:14': 1, '14:18': 1, '18:45': 5, '45:65': 1, __unknown: 1 });
    const m = q({ measure: { op: 'count_distinct', column: 'mrn' }, group_by: [{ column: 'at', grain: 'month' }], period: { start: '2026-07-01', end_exclusive: '2026-09-01' } });
    expect(m.rows).toEqual([{ d1: '2026-07', value: 6 }, { d1: '2026-08', value: 2 }]);
    expect(m.value).toBe(7);
  });
  test('avg / min / max on numbers, ignoring missing values', () => {
    expect(q({ measure: { op: 'max', column: 'age' } }).value).toBe(50);
    expect(q({ measure: { op: 'avg', column: 'age', }, filters: [{ column: 'mrn', op: 'eq', value: 'P1' }] }).value).toBe(30);
  });
  test('validation', () => {
    expect(() => validateRequest(visitsInfo, { dataset_id: 'v', measure: { op: 'avg', column: 'enc' }, filters: [], group_by: [] })).toThrow(/measure_needs_number/);
    expect(() => validateRequest(visitsInfo, { dataset_id: 'v', measure: { op: 'count' }, filters: [{ column: 'ctas', op: 'eq', value: 1 }], group_by: [] })).toThrow(/unknown_column/);
    expect(() => validateRequest(visitsInfo, { dataset_id: 'v', measure: { op: 'count' }, filters: [], group_by: [], period: { start: '2026-08-01', end_exclusive: '2026-07-01' } })).toThrow(/bad_dates/);
  });
});

describe('generic engine — employees (snapshot dataset)', () => {
  const s = (r: Partial<StatRequest>) => runLocalQuery(staffDs, { dataset_id: 's', measure: { op: 'count' }, filters: [], group_by: [], ...r });
  test('count, group, filters', () => {
    expect(s({}).value).toBe(5);
    expect(s({ filters: [{ column: 'cat', op: 'eq', value: 'تمريض' }] }).value).toBe(3);
    expect(s({ group_by: [{ column: 'cat' }, { column: 'gender' }] }).rows).toContainEqual({ d1: 'تمريض', d2: 'Female', value: 2 });
    expect(s({}).coverage).toBeNull();
  });
  test('average years of service skips the missing value and says so', () => {
    const r = s({ measure: { op: 'avg', column: 'years' } });
    expect(r.value).toBe(5);
    expect(r.excluded[0]).toMatchObject({ column: 'years', n: 1, measure: true });
  });
  test('date filters and year grain on date columns', () => {
    expect(s({ filters: [{ column: 'hired', op: 'gte', value: '2021-01-01' }] }).value).toBe(3);
    expect(s({ group_by: [{ column: 'hired', grain: 'year' }] }).rows.map((r) => r.d1)).toEqual(['2014', '2021', '2023', '2026', '__unknown']);
  });
  test('period on a snapshot dataset is rejected', () => {
    expect(() => s({ period: JULY })).toThrow(/dataset_has_no_period/);
  });
});
