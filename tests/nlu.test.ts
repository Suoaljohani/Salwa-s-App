import { describe, expect, test } from 'vitest';
import { parseQuestion } from '../src/lib/nlu/ruleParser';
import { localCatalogInfo } from '../src/lib/metrics/localEngine';
import type { Catalog } from '../src/lib/metrics/types';
import { batchA, staffDs, visitsDs } from './fixtures/datasets';

const cat: Catalog = { version: 1, datasets: [localCatalogInfo(visitsDs(batchA, [{ start: '2026-07-01', end_exclusive: '2026-08-01' }])), localCatalogInfo(staffDs)] };
const T = '2026-11-18';
const one = (qs: string) => {
  const r = parseQuestion(qs, cat, null, T);
  if (r.kind !== 'requests') throw new Error(`expected requests, got ${r.kind}: ${JSON.stringify(r)}`);
  return r;
};

describe('generic Arabic rule parser', () => {
  test('visits: emergency, month, 18 and over', () => {
    const r = one('كم عدد زيارات الطوارئ في يوليو 2026 لمن أعمارهم 18 سنة فأكثر؟').requests[0];
    expect(r.dataset_id).toBe('v');
    expect(r.period).toEqual({ start: '2026-07-01', end_exclusive: '2026-08-01' });
    expect(r.filters).toEqual(expect.arrayContaining([{ column: 'enc', op: 'eq', value: 'Emergency' }, { column: 'age', op: 'gte', value: 18 }]));
  });
  test('distinct patients uses the file-number identifier', () => {
    expect(one('كم عدد المرضى المختلفين في يوليو 2026؟').requests[0].measure).toEqual({ op: 'count_distinct', column: 'mrn' });
  });
  test('employees: picks the staff dataset, filter by category and gender', () => {
    const r = one('كم عدد الموظفات في التمريض؟').requests[0];
    expect(r.dataset_id).toBe('s');
    expect(r.filters).toEqual(expect.arrayContaining([{ column: 'cat', op: 'eq', value: 'تمريض' }, { column: 'gender', op: 'eq', value: 'Female' }]));
    expect(r.period).toBeNull();
  });
  test('employees: grouping and average', () => {
    expect(one('وزعي الموظفين حسب الفئة الوظيفية').requests[0].group_by).toEqual([{ column: 'cat' }]);
    expect(one('متوسط سنوات الخدمة للموظفين').requests[0].measure).toEqual({ op: 'avg', column: 'years' });
  });
  test('comparison of two months', () => {
    expect(one('قارني زيارات الطوارئ بين يونيو ويوليو 2026').requests.map((r) => r.period!.start)).toEqual(['2026-06-01', '2026-07-01']);
  });
  test('follow-up keeps dataset and filters', () => {
    const prev = one('زيارات الطوارئ في يوليو 2026').requests[0];
    const r = parseQuestion('والنساء فقط؟', cat, prev, T);
    expect(r.kind === 'requests' && r.requests[0].filters).toEqual(expect.arrayContaining([{ column: 'enc', op: 'eq', value: 'Emergency' }, { column: 'gender', op: 'eq', value: 'Female' }]));
  });
  test('CTAS is unavailable in these sources', () => {
    expect(parseQuestion('وزعي زيارات الطوارئ حسب CTAS', cat, null, T).kind).toBe('unsupported');
  });
});
