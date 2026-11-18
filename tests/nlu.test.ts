import { describe, expect, test } from 'vitest';
import { parseQuestion } from '../src/lib/nlu/ruleParser';

const T = '2026-11-18';
const req = (q: string, prev?: Parameters<typeof parseQuestion>[1]) => {
  const r = parseQuestion(q, prev, T);
  if (r.kind !== 'requests') throw new Error(`expected requests, got ${r.kind}`);
  return r;
};

describe('Arabic rule parser (fallback)', () => {
  test('emergency, month+year, 18 and over', () => {
    const r = req('كم عدد زيارات الطوارئ في أكتوبر 2026 لمن أعمارهم 18 سنة فأكثر؟').requests[0];
    expect(r).toMatchObject({ metric: 'visits', start: '2026-10-01', end_exclusive: '2026-11-01', filters: { encounter_type: ['Emergency'], age_min: 18 } });
  });
  test('"older than 18" excludes 18', () => {
    expect(req('زيارات يوليو 2026 لمن أكبر من 18').requests[0].filters.age_min).toBe(19);
  });
  test('distinct patients + first quarter', () => {
    const r = req('كم عدد المرضى المختلفين الذين راجعوا الطوارئ خلال الربع الأول 2026؟').requests[0];
    expect(r).toMatchObject({ metric: 'distinct_patients', start: '2026-01-01', end_exclusive: '2026-04-01' });
  });
  test('comparison between two months', () => {
    const r = req('قارني زيارات العيادات بين سبتمبر وأكتوبر 2026');
    expect(r.requests.map((x) => x.start)).toEqual(['2026-09-01', '2026-10-01']);
    expect(r.requests[0].filters.encounter_type).toEqual(['Outpatient']);
  });
  test('month without year assumes the latest past one and says so', () => {
    const r = req('زيارات ديسمبر');
    expect(r.requests[0].start).toBe('2025-12-01');
    expect(r.assumptions[0]).toMatch(/2025/);
  });
  test('last month', () => {
    expect(req('زيارات الطوارئ في الشهر الماضي').requests[0]).toMatchObject({ start: '2026-10-01', end_exclusive: '2026-11-01' });
  });
  test('grouping', () => {
    expect(req('وزعي زيارات الطوارئ حسب الجنس والفئة العمرية في يوليو 2026').requests[0].group_by).toEqual(['gender', 'age_band']);
  });
  test('follow-up keeps previous filters', () => {
    const prev = req('زيارات الطوارئ في يوليو 2026').requests[0];
    const r = req('والنساء فقط؟', prev).requests[0];
    expect(r).toMatchObject({ start: '2026-07-01', filters: { encounter_type: ['Emergency'], gender: 'F' } });
  });
  test('CTAS is unsupported by the source', () => {
    expect(parseQuestion('وزعي زيارات الطوارئ حسب CTAS', null, T).kind).toBe('unsupported');
  });
  test('missing period asks', () => {
    expect(parseQuestion('كم عدد الزيارات؟', null, T).kind).toBe('clarify');
  });
  test('Arabic-Indic digits', () => {
    expect(req('زيارات يوليو ٢٠٢٦ لمن ١٨ فأكثر').requests[0]).toMatchObject({ start: '2026-07-01', filters: { age_min: 18 } });
  });
});
