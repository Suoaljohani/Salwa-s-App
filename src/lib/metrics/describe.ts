// Deterministic Arabic phrasing of a request/result. Numbers come only from the engine result.
import { MEASURE_LABEL, colOf, keyLabel } from './catalog';
import type { DatasetInfo, Filter, StatRequest, StatResult } from './types';
import { formatInstant, formatPeriod } from '../dates';
import { fmtNum } from '../format';

type DsLike = Pick<DatasetInfo, 'columns' | 'name' | 'unit_label'> | null | undefined;

const OP_AR: Record<string, string> = { eq: '=', neq: '≠', gt: 'أكبر من', gte: 'من', lt: 'أقل من', lte: 'حتى', contains: 'يحتوي', in: 'ضمن', not_in: 'ليس ضمن', is_null: 'غير مسجّل', not_null: 'مسجّل' };

export function filterPhrase(ds: DsLike, f: Filter): string {
  const c = colOf(ds, f.column);
  const name = c?.label ?? f.column;
  const val = (v: unknown) => keyLabel(c, undefined, String(v));
  switch (f.op) {
    case 'eq': return c && c.type === 'text' ? val(f.value) : `${name}: ${val(f.value)}`;
    case 'neq': return `${name} غير ${val(f.value)}`;
    case 'in': return (f.value as unknown[]).map(val).join(' أو ');
    case 'not_in': return `${name} ليس ${(f.value as unknown[]).map(val).join(' أو ')}`;
    case 'gte': return c && /عمر|age/i.test(c.label + (c.source_header ?? '')) ? `${name} ${fmtNum(Number(f.value))} فأكثر` : `${name} ≥ ${fmtNum(Number(f.value))}`;
    case 'gt': return `${name} أكبر من ${fmtNum(Number(f.value))}`;
    case 'lt': return `${name} أقل من ${fmtNum(Number(f.value))}`;
    case 'lte': return `${name} ≤ ${fmtNum(Number(f.value))}`;
    case 'contains': return `${name} يحتوي «${String(f.value)}»`;
    default: return `${name} ${OP_AR[f.op] ?? f.op}`;
  }
}

export function measurePhrase(ds: DsLike, r: StatRequest): string {
  const m = r.measure ?? { op: 'count' };
  if (m.op === 'count') return `عدد ${unitPlural(ds?.unit_label ?? 'السجلات')}`;
  const c = colOf(ds, m.column);
  if (m.op === 'count_distinct') return `عدد ${c?.label ?? m.column} المختلفة`;
  const word: Record<string, string> = { sum: 'مجموع', avg: 'متوسط', min: 'أدنى', max: 'أعلى' };
  return `${word[m.op] ?? MEASURE_LABEL[m.op]} ${c?.label ?? m.column}`;
}

function unitPlural(u: string): string {
  const known: Record<string, string> = { 'زيارة': 'الزيارات', 'موظف': 'الموظفين', 'سرير': 'الأسرّة', 'مريض': 'المرضى', 'سجل': 'السجلات', 'عملية': 'العمليات', 'ولادة': 'الولادات' };
  return known[u] ?? u;
}

export function requestTitle(ds: DsLike, r: StatRequest): string {
  const parts = r.filters.map((f) => filterPhrase(ds, f));
  const by = r.group_by.length ? ` حسب ${r.group_by.map((g) => colOf(ds, g.column)?.label ?? g.column).join(' و')}` : '';
  return `${measurePhrase(ds, r)}${parts.length ? ` — ${parts.join('، ')}` : ''}${by}`;
}

export function periodText(res: StatResult): string {
  const p = res.request.period;
  if (p) return formatPeriod(p.start, p.end_exclusive);
  const asOf = res.sources.find((s) => s.as_of)?.as_of;
  if (res.dataset.mode === 'snapshot') return asOf ? `حسب البيانات بتاريخ ${formatPeriod(asOf, nextDay(asOf))}` : 'حسب آخر نسخة معتمدة';
  return 'كل الفترة المعتمدة';
}
function nextDay(d: string) { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); }

/** Unit shown after a value. */
export function valueUnit(res: StatResult): string {
  const m = res.request.measure ?? { op: 'count' };
  if (m.op === 'count') return res.dataset.unit_label;
  return '';
}

export function fmtValue(res: StatResult, v: number | null): string {
  if (v == null) return '—';
  const m = res.request.measure ?? { op: 'count' };
  return fmtNum(m.op === 'avg' ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100);
}

export function headline(res: StatResult): string {
  if (res.value == null) return res.coverage?.status === 'none' ? 'لا توجد بيانات معتمدة لهذه الفترة' : 'لا توجد قيم';
  const u = valueUnit(res);
  return `${fmtValue(res, res.value)}${u ? ` ${u}` : ''}`;
}

export function coverageText(res: StatResult): { tone: 'ok' | 'warn' | 'none'; text: string } {
  const c = res.coverage;
  if (!c) {
    if (res.dataset.mode === 'snapshot') return { tone: 'ok', text: 'آخر نسخة معتمدة' };
    return { tone: 'ok', text: 'كل البيانات المعتمدة' };
  }
  if (c.status === 'complete') return { tone: 'ok', text: 'التغطية كاملة' };
  if (c.status === 'none') return { tone: 'none', text: 'الفترة غير مغطاة ببيانات معتمدة' };
  const gaps = c.gaps.slice(0, 2).map((g) => formatPeriod(g.start, g.end_exclusive)).join('، ');
  return { tone: 'warn', text: `تغطية جزئية: ${fmtNum(c.covered_days)} من ${fmtNum(c.total_days)} يومًا${gaps ? ` — ناقص: ${gaps}` : ''}` };
}

export function exclusionNotes(res: StatResult): string[] {
  return res.excluded.map((e) => e.measure
    ? `${fmtNum(e.n)} ${res.dataset.unit_label} بلا قيمة لـ«${e.label}» لم تدخل في الحساب`
    : `استُبعد ${fmtNum(e.n)} ${res.dataset.unit_label} لعدم تسجيل «${e.label}»`);
}

export function sourceText(res: StatResult): string {
  if (res.demo) return 'بيانات تجريبية للعرض — ليست أرقام المستشفى';
  if (!res.sources.length) return `${res.dataset.name} — لا يوجد مصدر معتمد`;
  const s = res.sources.map((x) => x.file_name).slice(-2).join('، ');
  return `${res.dataset.name}: ${s}${res.sources.length > 2 ? ` و${fmtNum(res.sources.length - 2)} أخرى` : ''} — إصدار ${fmtNum(res.dataset_version)}`;
}

export function copyText(ds: DsLike, res: StatResult): string {
  return [
    requestTitle(ds, res.request),
    `الفترة: ${periodText(res)}`,
    `النتيجة: ${headline(res)}`,
    coverageText(res).text,
    ...exclusionNotes(res),
    `المصدر: ${sourceText(res)}`,
    `وقت الحساب: ${formatInstant(res.extracted_at)}`,
  ].join('\n');
}
