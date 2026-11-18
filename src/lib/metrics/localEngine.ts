// In-browser implementation of the metric_query contract.
// Used for (a) the clearly-labelled demo mode and (b) import previews before approval.
// Semantics mirror supabase/migrations/*_metric_engine.sql; tests compare both against an independent reference.
import { ageBandOf, DEFINITION_VERSION } from './catalog';
import type { Coverage, CoverageStatus, CoverageWindow, Dimension, MetricFilters, MetricRequest, MetricResult, ResultRow, VisitRow } from './types';
import { MetricError } from './types';
import { daysBetween, daysInRange, riyadhDayOf, riyadhDayStartMs, riyadhMonthOf } from '../dates';

const LIST_FILTERS = ['encounter_type', 'department', 'payor', 'discharge_type'] as const;
const ALLOWED_FILTERS = new Set<string>([...LIST_FILTERS, 'gender', 'is_saudi', 'age_min', 'age_max_exclusive']);
const ALLOWED_DIMS = new Set<Dimension>(['month', 'day', 'encounter_type', 'department', 'payor', 'discharge_type', 'gender', 'nationality_group', 'age_band']);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateRequest(req: MetricRequest): void {
  if (req.metric !== 'visits' && req.metric !== 'distinct_patients') throw new MetricError('unsupported_metric');
  if (!DAY_RE.test(req.start) || !DAY_RE.test(req.end_exclusive)) throw new MetricError('bad_dates');
  const span = daysBetween(req.start, req.end_exclusive);
  if (!(span > 0) || span > 3700) throw new MetricError('bad_dates');
  for (const k of Object.keys(req.filters ?? {})) if (!ALLOWED_FILTERS.has(k)) throw new MetricError(`unsupported_filter:${k}`);
  for (const k of LIST_FILTERS) {
    const v = req.filters[k];
    if (v !== undefined && (!Array.isArray(v) || v.length === 0)) throw new MetricError(`bad_filter:${k}`);
  }
  if (req.filters.gender !== undefined && req.filters.gender !== 'M' && req.filters.gender !== 'F') throw new MetricError('bad_filter:gender');
  if ((req.group_by ?? []).length > 2) throw new MetricError('too_many_dimensions');
  for (const d of req.group_by ?? []) if (!ALLOWED_DIMS.has(d)) throw new MetricError(`unsupported_dimension:${d}`);
}

type Pred = (r: VisitRow) => boolean;

function predicates(f: MetricFilters, skip: string[] = []): Pred[] {
  const out: Pred[] = [];
  for (const k of LIST_FILTERS) {
    if (skip.includes(k) || !f[k]) continue;
    const set = new Set(f[k]);
    out.push((r) => r[k] != null && set.has(r[k] as string));
  }
  if (f.gender && !skip.includes('gender')) out.push((r) => r.gender === f.gender);
  if (f.is_saudi !== undefined && !skip.includes('is_saudi')) out.push((r) => r.is_saudi === f.is_saudi);
  if (f.age_min !== undefined && !skip.includes('age_min')) out.push((r) => r.age_years != null && r.age_years >= f.age_min!);
  if (f.age_max_exclusive !== undefined && !skip.includes('age_max_exclusive'))
    out.push((r) => r.age_years != null && r.age_years < f.age_max_exclusive!);
  return out;
}

export function dimValue(dim: Dimension, r: VisitRow): string {
  const ms = Date.parse(r.visit_at);
  switch (dim) {
    case 'month': return riyadhMonthOf(ms);
    case 'day': return riyadhDayOf(ms);
    case 'encounter_type': return r.encounter_type ?? '__unknown';
    case 'department': return r.department ?? '__unknown';
    case 'payor': return r.payor ?? '__unknown';
    case 'discharge_type': return r.discharge_type ?? '__none';
    case 'gender': return r.gender ?? '__unknown';
    case 'nationality_group': return r.is_saudi === true ? 'saudi' : r.is_saudi === false ? 'non_saudi' : '__unknown';
    case 'age_band': return ageBandOf(r.age_years);
  }
}

export function coverageFor(windows: CoverageWindow[], start: string, endExclusive: string): Coverage {
  const days = daysInRange(start, endExclusive);
  const covered = days.map((d) => windows.some((w) => w.start <= d && d < w.end_exclusive));
  const nCovered = covered.filter(Boolean).length;
  const months = new Map<string, { total: number; covered: number }>();
  days.forEach((d, i) => {
    const m = d.slice(0, 7);
    const e = months.get(m) ?? { total: 0, covered: 0 };
    e.total++;
    if (covered[i]) e.covered++;
    months.set(m, e);
  });
  const gaps: Coverage['gaps'] = [];
  days.forEach((d, i) => {
    if (covered[i]) return;
    const last = gaps[gaps.length - 1];
    if (last && last.end_exclusive === d) last.end_exclusive = days[i + 1] ?? endExclusive;
    else gaps.push({ start: d, end_exclusive: days[i + 1] ?? endExclusive });
  });
  const status: CoverageStatus = nCovered === 0 ? 'none' : nCovered === days.length ? 'complete' : 'partial';
  return {
    status,
    covered_days: nCovered,
    total_days: days.length,
    gaps,
    months: [...months.entries()].map(([period, e]) => ({
      period,
      status: e.covered === 0 ? 'none' : e.covered === e.total ? 'complete' : 'partial',
    })),
  };
}

export interface LocalDataset {
  rows: VisitRow[];
  windows: CoverageWindow[];
  datasetVersion: number;
  demo: boolean;
}

export function runLocalQuery(ds: LocalDataset, req: MetricRequest): MetricResult {
  validateRequest(req);
  const f = req.filters ?? {};
  const g = req.group_by ?? [];
  const lo = riyadhDayStartMs(req.start);
  const hi = riyadhDayStartMs(req.end_exclusive);
  const inWindow = ds.rows.filter((r) => {
    const t = Date.parse(r.visit_at);
    return t >= lo && t < hi;
  });
  const coverage = coverageFor(ds.windows, req.start, req.end_exclusive);
  const base: MetricResult = {
    request: { metric: req.metric, start: req.start, end_exclusive: req.end_exclusive, filters: f, group_by: g },
    value: null,
    rows: [],
    coverage,
    excluded: {},
    sources: ds.windows
      .filter((w) => w.start < req.end_exclusive && w.end_exclusive > req.start)
      .map((w) => ({ id: w.id, file_name: w.file_name, coverage_start: w.start, coverage_end_exclusive: w.end_exclusive })),
    dataset_version: ds.datasetVersion,
    definition_version: DEFINITION_VERSION,
    extracted_at: new Date().toISOString(),
    demo: ds.demo,
  };
  if (coverage.status === 'none') return base;

  const preds = predicates(f);
  const distinct = req.metric === 'distinct_patients';
  const matched = inWindow.filter((r) => preds.every((p) => p(r)) && (!distinct || r.patient_key != null));
  const aggregate = (rows: VisitRow[]) => (distinct ? new Set(rows.map((r) => r.patient_key)).size : rows.length);

  base.value = aggregate(matched);
  if (g.length) {
    const groups = new Map<string, { keys: string[]; rows: VisitRow[] }>();
    for (const r of matched) {
      const keys = g.map((d) => dimValue(d, r));
      const id = keys.join('\u0000');
      const e = groups.get(id) ?? { keys, rows: [] };
      e.rows.push(r);
      groups.set(id, e);
    }
    base.rows = [...groups.values()]
      .map(({ keys, rows }) => {
        const row: ResultRow = { value: aggregate(rows) };
        if (keys[0] !== undefined) row.d1 = keys[0];
        if (keys[1] !== undefined) row.d2 = keys[1];
        return row;
      })
      .sort((a, b) => cmp(a.d1, b.d1) || cmp(a.d2, b.d2));
  }

  const countNull = (skip: string[], isNull: Pred) => {
    const p = predicates(f, skip);
    return inWindow.filter((r) => p.every((x) => x(r)) && isNull(r)).length;
  };
  if (f.age_min !== undefined || f.age_max_exclusive !== undefined)
    base.excluded.unknown_age = countNull(['age_min', 'age_max_exclusive'], (r) => r.age_years == null);
  if (f.gender) base.excluded.unknown_gender = countNull(['gender'], (r) => r.gender == null);
  if (f.is_saudi !== undefined) base.excluded.unknown_nationality = countNull(['is_saudi'], (r) => r.is_saudi == null);
  if (distinct) base.excluded.unknown_patient = countNull([], (r) => r.patient_key == null);
  return base;
}

// Matches PostgreSQL text ordering closely enough for our ASCII keys (codes, ISO dates).
function cmp(a?: string, b?: string): number {
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  return a < b ? -1 : 1;
}
