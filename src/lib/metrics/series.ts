// Turn grouped results into chart-ready series without inventing values:
// uncovered periods are null (a visible gap), covered periods with no rows are a measured 0.
import type { Coverage, MetricResult } from './types';
import { daysInRange, monthsInRange } from '../dates';

export function periodsFor(res: MetricResult, grain: 'day' | 'month'): string[] {
  const r = res.request;
  return grain === 'month' ? monthsInRange(r.start, r.end_exclusive) : daysInRange(r.start, r.end_exclusive);
}

export function periodCovered(cov: Coverage, grain: 'day' | 'month', period: string): boolean {
  if (grain === 'month') return cov.months.find((m) => m.period === period)?.status !== 'none';
  return !cov.gaps.some((g) => g.start <= period && period < g.end_exclusive) && cov.status !== 'none';
}

/** Time series; when d2 is present each category becomes its own series. */
export function timeSeries(res: MetricResult, grain: 'day' | 'month', categories?: string[]) {
  const periods = periodsFor(res, grain);
  const timeIsD1 = res.request.group_by[0] === grain;
  const cats = categories ?? (res.request.group_by.length > 1
    ? [...new Set(res.rows.map((x) => (timeIsD1 ? x.d2 : x.d1)!))]
    : ['__all']);
  const map = new Map<string, number>();
  for (const row of res.rows) {
    const t = timeIsD1 ? row.d1! : row.d2!;
    const c = res.request.group_by.length > 1 ? (timeIsD1 ? row.d2! : row.d1!) : '__all';
    map.set(`${c}|${t}`, row.value);
  }
  return {
    periods,
    series: cats.map((c) => ({
      id: c,
      data: periods.map((p) => (periodCovered(res.coverage, grain, p) ? map.get(`${c}|${p}`) ?? 0 : null)),
    })),
    partialMonths: res.coverage.months.filter((m) => m.status === 'partial').map((m) => m.period),
  };
}
