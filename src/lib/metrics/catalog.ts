import type { DatasetColumn, DatasetInfo, GroupBy, MeasureOp } from './types';

export const MEASURE_LABEL: Record<MeasureOp, string> = {
  count: 'العدد',
  count_distinct: 'العدد المميز',
  sum: 'المجموع',
  avg: 'المتوسط',
  min: 'الأدنى',
  max: 'الأعلى',
};

export const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export function monthLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  return `${MONTHS_AR[m - 1]} ${y}`;
}

/** Common category translations; raw source text is shown when nothing is known. */
const KNOWN: Record<string, string> = {
  Emergency: 'الطوارئ', Outpatient: 'العيادات الخارجية', Inpatient: 'التنويم', 'Day Care': 'الرعاية اليومية',
  Male: 'ذكر', Female: 'أنثى', M: 'ذكر', F: 'أنثى',
  'Saudi Government': 'حكومي', Selfpay: 'دفع ذاتي',
  Discharged: 'خروج', 'Referred to Another Hospital': 'تحويل إلى مستشفى آخر',
  'SAUDI ARABIA': 'السعودية', true: 'نعم', false: 'لا',
  'Emergency Medicine': 'طب الطوارئ', 'Diabetes Screening Clinic': 'عيادة فحص السكري', 'Physical Therapy': 'العلاج الطبيعي',
  'MEDICAL REHABILITATION': 'التأهيل الطبي', 'Occupational Therapy': 'العلاج الوظيفي',
};

export function colOf(ds: Pick<DatasetInfo, 'columns'> | null | undefined, key: string | undefined): DatasetColumn | undefined {
  return ds?.columns.find((c) => c.key === key);
}

function cleanMixed(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').trim();
  const arabic = s.match(/[؀-ۿ][؀-ۿ\s&]*[؀-ۿ]/g);
  if (arabic && arabic.join('').length >= 4 && /[A-Za-z]/.test(s)) return arabic.join(' ').replace(/\s+/g, ' ').trim();
  return s;
}

/** Arabic display of a group key for a given column / grouping. */
export function keyLabel(col: DatasetColumn | undefined, g: GroupBy | undefined, key: string | undefined | null): string {
  if (key == null) return '—';
  if (key === '__unknown') return 'غير مسجّل';
  if (col && (col.type === 'date' || col.type === 'datetime')) {
    const grain = g?.grain ?? 'month';
    if (grain === 'month') return monthLabel(key);
    return key;
  }
  if (col?.type === 'number' && g?.bins?.length) {
    const [a, b] = key.split(':');
    if (a === 'lt') return `أقل من ${b}`;
    if (a === 'ge') return `${b} فأكثر`;
    return `${a} إلى أقل من ${b}`;
  }
  if (col?.type === 'boolean') return key === 'true' ? 'نعم' : key === 'false' ? 'لا' : key;
  return KNOWN[key] ?? cleanMixed(key);
}

/** Short axis label for numeric bins. */
export function shortKey(col: DatasetColumn | undefined, g: GroupBy | undefined, key: string): string {
  if (key === '__unknown') return 'غير مسجّل';
  if (col?.type === 'number' && g?.bins?.length) {
    const [a, b] = key.split(':');
    if (a === 'lt') return `‎<${b}`;
    if (a === 'ge') return `${b}+`;
    return `${a}–${Number(b) - 1}`;
  }
  return keyLabel(col, g, key);
}

/** Deterministic order: time and bins ascending, categories by known order then text; unknown last. */
export function sortKeys(col: DatasetColumn | undefined, g: GroupBy | undefined, keys: string[]): string[] {
  const rank = (k: string): number => {
    if (k === '__unknown') return Number.MAX_SAFE_INTEGER;
    if (col?.type === 'number' && g?.bins?.length) {
      const [a, b] = k.split(':');
      return a === 'lt' ? -Infinity : a === 'ge' ? Number(b) + 1e9 : Number(a);
    }
    if (col?.type === 'number') return Number(k);
    return 0;
  };
  return [...keys].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/** Sensible default bins for a numeric column (age-like columns get clinical bands). */
export function defaultBins(col: DatasetColumn): number[] | undefined {
  if (col.type !== 'number') return undefined;
  if (/عمر|age/i.test(`${col.label} ${col.source_header ?? ''}`)) return [14, 18, 45, 65];
  const min = Number(col.min), max = Number(col.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return undefined;
  if (max - min <= 12 && Number.isInteger(min) && Number.isInteger(max)) return undefined;
  const step = niceStep((max - min) / 5);
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max && out.length < 8; v += step) if (v > min) out.push(v);
  return out.length ? out : undefined;
}

function niceStep(x: number): number {
  const p = 10 ** Math.floor(Math.log10(x));
  const f = x / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

/** Fields that the current sources do not contain (answered as unavailable, never guessed). */
export function hasColumnLike(ds: DatasetInfo[], re: RegExp): boolean {
  return ds.some((d) => d.columns.some((c) => re.test(`${c.label} ${c.source_header ?? ''}`)));
}
