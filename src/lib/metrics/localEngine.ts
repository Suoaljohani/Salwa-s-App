// In-browser implementation of the dataset_query contract (supabase/migrations/*_generic_datasets.sql).
// Used for the clearly-labelled demo mode and for import previews before approval.
import type { Coverage, CoverageStatus, DatasetColumn, DatasetInfo, Filter, GroupBy, ResultRow, Row, StatRequest, StatResult } from './types';
import { MetricError } from './types';
import { daysBetween, daysInRange, riyadhDayOf, riyadhDayStartMs } from '../dates';

export interface LocalWindow { id: string; file_name: string; start: string | null; end_exclusive: string | null; as_of?: string | null }
export interface LocalDataset { info: DatasetInfo; rows: Row[]; windows: LocalWindow[]; demo: boolean }

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const OPS = new Set(['eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'contains', 'is_null', 'not_null']);

function col(info: DatasetInfo, key: string | undefined): DatasetColumn {
  const c = info.columns.find((x) => x.key === key && x.role !== 'ignore');
  if (!c) throw new MetricError(`unknown_column:${key}`);
  return c;
}

/** Comparable value of a cell: numbers as numbers, dates as YYYY-MM-DD, datetimes as epoch ms. */
function cell(c: DatasetColumn, r: Row): number | string | boolean | null {
  const v = r[c.key];
  if (v == null || v === '') return null;
  switch (c.type) {
    case 'number': return typeof v === 'number' ? v : null;
    case 'datetime': { const t = Date.parse(String(v)); return Number.isFinite(t) ? t : null; }
    case 'date': return DAY_RE.test(String(v)) ? String(v) : null;
    case 'boolean': return typeof v === 'boolean' ? v : null;
    default: return String(v);
  }
}

function filterValue(c: DatasetColumn, v: unknown): number | string | boolean | null {
  if (v == null) return null;
  switch (c.type) {
    case 'number': return Number(v);
    case 'datetime': return riyadhDayStartMs(String(v).slice(0, 10));
    case 'date': return String(v).slice(0, 10);
    case 'boolean': return v === true || v === 'true';
    default: return String(v);
  }
}

/** SQL renders numbers/booleans/dates via ::text; mirror that for "in" lists and plain grouping. */
function asText(c: DatasetColumn, r: Row): string | null {
  const v = r[c.key];
  if (v == null || v === '') return null;
  if (c.type === 'datetime') return String(v);
  return String(v);
}

function pred(info: DatasetInfo, f: Filter): (r: Row) => boolean {
  if (!OPS.has(f.op)) throw new MetricError(`bad_filter_op:${f.op}`);
  const c = col(info, f.column);
  const fv = f.op === 'in' || f.op === 'not_in' ? null : filterValue(c, f.value);
  const list = Array.isArray(f.value) ? new Set(f.value.map(String)) : new Set<string>();
  return (r) => {
    const v = cell(c, r);
    switch (f.op) {
      case 'is_null': return v == null;
      case 'not_null': return v != null;
    }
    if (v == null) return false;
    switch (f.op) {
      case 'eq': return v === fv;
      case 'neq': return v !== fv;
      case 'gt': return (v as number) > (fv as number);
      case 'gte': return (v as number) >= (fv as number);
      case 'lt': return (v as number) < (fv as number);
      case 'lte': return (v as number) <= (fv as number);
      case 'contains': return String(v).toLowerCase().includes(String(f.value ?? '').toLowerCase());
      case 'in': return list.has(asText(c, r)!);
      case 'not_in': return !list.has(asText(c, r)!);
    }
    return false;
  };
}

export function groupKey(info: DatasetInfo, g: GroupBy, r: Row): string {
  const c = col(info, g.column);
  const v = cell(c, r);
  if (v == null) return '__unknown';
  if (c.type === 'date' || c.type === 'datetime') {
    const day = c.type === 'datetime' ? riyadhDayOf(v as number) : (v as string);
    const grain = g.grain ?? 'month';
    return grain === 'day' ? day : grain === 'month' ? day.slice(0, 7) : day.slice(0, 4);
  }
  if (c.type === 'number' && g.bins?.length) {
    const b = g.bins;
    const n = v as number;
    if (n < b[0]) return `lt:${b[0]}`;
    for (let i = 1; i < b.length; i++) if (n < b[i]) return `${b[i - 1]}:${b[i]}`;
    return `ge:${b[b.length - 1]}`;
  }
  return asText(c, r) ?? '__unknown';
}

export function coverageFor(windows: LocalWindow[], start: string, endExclusive: string): Coverage {
  const days = daysInRange(start, endExclusive);
  const covered = days.map((d) => windows.some((w) => w.start != null && w.end_exclusive != null && w.start <= d && d < w.end_exclusive));
  const n = covered.filter(Boolean).length;
  const months = new Map<string, { total: number; covered: number }>();
  days.forEach((d, i) => {
    const e = months.get(d.slice(0, 7)) ?? { total: 0, covered: 0 };
    e.total++; if (covered[i]) e.covered++;
    months.set(d.slice(0, 7), e);
  });
  const gaps: Coverage['gaps'] = [];
  days.forEach((d, i) => {
    if (covered[i]) return;
    const last = gaps[gaps.length - 1];
    const next = days[i + 1] ?? endExclusive;
    if (last && last.end_exclusive === d) last.end_exclusive = next; else gaps.push({ start: d, end_exclusive: next });
  });
  const status: CoverageStatus = n === 0 ? 'none' : n === days.length ? 'complete' : 'partial';
  return {
    status, covered_days: n, total_days: days.length, gaps,
    months: [...months].map(([period, e]) => ({ period, status: e.covered === 0 ? 'none' : e.covered === e.total ? 'complete' : 'partial' })),
  };
}

export function validateRequest(info: DatasetInfo, req: StatRequest): void {
  if ((req.filters ?? []).length > 12) throw new MetricError('bad_filters');
  if ((req.group_by ?? []).length > 2) throw new MetricError('too_many_dimensions');
  const m = req.measure ?? { op: 'count' };
  if (!['count', 'count_distinct', 'sum', 'avg', 'min', 'max'].includes(m.op)) throw new MetricError('bad_measure');
  if (m.op !== 'count') {
    const c = col(info, m.column);
    if (m.op !== 'count_distinct' && c.type !== 'number') throw new MetricError('measure_needs_number');
  }
  for (const f of req.filters ?? []) pred(info, f);
  for (const g of req.group_by ?? []) {
    const c = col(info, g.column);
    if ((c.type === 'date' || c.type === 'datetime') && g.grain && !['day', 'month', 'year'].includes(g.grain)) throw new MetricError('bad_grain');
  }
  if (req.period) {
    if (!info.period_column) throw new MetricError('dataset_has_no_period');
    const { start, end_exclusive } = req.period;
    if (!DAY_RE.test(start) || !DAY_RE.test(end_exclusive)) throw new MetricError('bad_dates');
    const span = daysBetween(start, end_exclusive);
    if (!(span > 0) || span > 3700) throw new MetricError('bad_dates');
  }
}

export function runLocalQuery(ds: LocalDataset, req: StatRequest): StatResult {
  const info = ds.info;
  validateRequest(info, req);
  const filters = req.filters ?? [];
  const groups = req.group_by ?? [];
  const m = req.measure ?? { op: 'count' };

  let inPeriod: (r: Row) => boolean = () => true;
  if (req.period) {
    const pc = col(info, info.period_column!);
    if (pc.type === 'datetime') {
      const lo = riyadhDayStartMs(req.period.start), hi = riyadhDayStartMs(req.period.end_exclusive);
      inPeriod = (r) => { const t = cell(pc, r) as number | null; return t != null && t >= lo && t < hi; };
    } else {
      inPeriod = (r) => { const d = cell(pc, r) as string | null; return d != null && d >= req.period!.start && d < req.period!.end_exclusive; };
    }
  }
  const coverage = req.period && info.mode === 'append' ? coverageFor(ds.windows, req.period.start, req.period.end_exclusive) : null;
  const base: StatResult = {
    request: req,
    dataset: { id: info.id, name: info.name, unit_label: info.unit_label, mode: info.mode, period_column: info.period_column },
    value: null, rows: [], coverage, excluded: [], total_rows: ds.rows.length,
    sources: ds.windows.map((w) => ({ id: w.id, file_name: w.file_name, coverage_start: w.start, coverage_end_exclusive: w.end_exclusive, as_of: w.as_of ?? null })),
    dataset_version: info.version, extracted_at: new Date().toISOString(), demo: ds.demo,
  };
  if (coverage?.status === 'none') return base;

  const preds = filters.map((f) => pred(info, f));
  const mc = m.op === 'count' ? null : col(info, m.column);
  const scoped = ds.rows.filter(inPeriod);
  const matched = scoped.filter((r) => preds.every((p) => p(r)) && (!mc || cell(mc, r) != null));

  const aggregate = (rows: Row[]): number | null => {
    if (m.op === 'count') return rows.length;
    const vals = rows.map((r) => cell(mc!, r)).filter((v) => v != null);
    if (m.op === 'count_distinct') return new Set(vals.map(String)).size;
    const nums = vals as number[];
    if (!nums.length) return null;
    switch (m.op) {
      case 'sum': return nums.reduce((a, b) => a + b, 0);
      case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
      case 'min': return Math.min(...nums);
      case 'max': return Math.max(...nums);
    }
    return null;
  };

  base.value = aggregate(matched);
  if (groups.length) {
    const map = new Map<string, { keys: string[]; rows: Row[] }>();
    for (const r of matched) {
      const keys = groups.map((g) => groupKey(info, g, r));
      const id = keys.join('\u0000');
      const e = map.get(id) ?? { keys, rows: [] };
      e.rows.push(r);
      map.set(id, e);
    }
    base.rows = [...map.values()].slice(0, 500).map(({ keys, rows }) => {
      const row: ResultRow = { value: aggregate(rows) ?? 0 };
      row.d1 = keys[0];
      if (keys[1] !== undefined) row.d2 = keys[1];
      return row;
    }).sort((a, b) => (a.d1! < b.d1! ? -1 : a.d1! > b.d1! ? 1 : (a.d2 ?? '') < (b.d2 ?? '') ? -1 : (a.d2 ?? '') > (b.d2 ?? '') ? 1 : 0));
  }

  filters.forEach((f, i) => {
    if (f.op === 'is_null' || f.op === 'not_null') return;
    const c = col(info, f.column);
    const others = preds.filter((_, j) => j !== i);
    const n = scoped.filter((r) => others.every((p) => p(r)) && cell(c, r) == null).length;
    if (n > 0) base.excluded.push({ column: c.key, label: c.label, n });
  });
  if (mc) {
    const n = scoped.filter((r) => preds.every((p) => p(r)) && cell(mc, r) == null).length;
    if (n > 0) base.excluded.push({ column: mc.key, label: mc.label, n, measure: true });
  }
  return base;
}

/** Catalog statistics for a local dataset (mirrors ds_catalog). */
export function localCatalogInfo(ds: LocalDataset): DatasetInfo {
  const info = ds.info;
  const columns = info.columns.filter((c) => c.role !== 'ignore').map((c) => {
    if (c.role === 'identifier') return { ...c };
    if (c.type === 'number' || c.type === 'date' || c.type === 'datetime') {
      const vals = ds.rows.map((r) => r[c.key]).filter((v) => v != null && v !== '') as (number | string)[];
      const sorted = [...vals].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return { ...c, min: sorted[0] ?? null, max: sorted[sorted.length - 1] ?? null, nulls: ds.rows.length - vals.length };
    }
    const m = new Map<string, number>();
    for (const r of ds.rows) { const v = r[c.key]; if (v != null && v !== '') m.set(String(v), (m.get(String(v)) ?? 0) + 1); }
    const values = [...m].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n);
    return { ...c, values: values.slice(0, 40), distinct: values.length };
  });
  return {
    ...info, columns, row_count: ds.rows.length,
    coverage: ds.windows.map((w) => ({ start: w.start, end_exclusive: w.end_exclusive, file_name: w.file_name, as_of: w.as_of ?? null })),
  };
}
