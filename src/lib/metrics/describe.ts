// Deterministic Arabic phrasing of a result. Numbers come only from the engine result.
import { DIMENSIONS, METRICS, valueLabel } from './catalog';
import type { MetricFilters, MetricRequest, MetricResult } from './types';
import { formatInstant, formatPeriod } from '../dates';
import { countNoun, fmtNum } from '../format';

export function filterPhrases(f: MetricFilters): string[] {
  const out: string[] = [];
  if (f.encounter_type?.length) out.push(f.encounter_type.map((v) => valueLabel('encounter_type', v)).join(' و'));
  if (f.department?.length) out.push(`قسم ${f.department.map((v) => valueLabel('department', v)).join(' و')}`);
  if (f.gender) out.push(f.gender === 'M' ? 'الذكور' : 'الإناث');
  if (f.is_saudi !== undefined) out.push(f.is_saudi ? 'السعوديون' : 'غير السعوديين');
  if (f.age_min !== undefined && f.age_max_exclusive !== undefined) out.push(`العمر من ${fmtNum(f.age_min)} إلى أقل من ${fmtNum(f.age_max_exclusive)}`);
  else if (f.age_min !== undefined) out.push(`العمر ${fmtNum(f.age_min)} سنة فأكثر`);
  else if (f.age_max_exclusive !== undefined) out.push(`العمر أقل من ${fmtNum(f.age_max_exclusive)} سنة`);
  if (f.payor?.length) out.push(`جهة الدفع: ${f.payor.map((v) => valueLabel('payor', v)).join('، ')}`);
  if (f.discharge_type?.length) out.push(`نوع الخروج: ${f.discharge_type.map((v) => valueLabel('discharge_type', v)).join('، ')}`);
  return out;
}

export function requestTitle(r: MetricRequest): string {
  const m = METRICS[r.metric].label;
  const parts = filterPhrases(r.filters);
  const by = r.group_by.length ? ` حسب ${r.group_by.map((d) => DIMENSIONS[d]).join(' و')}` : '';
  return `${m}${parts.length ? ` — ${parts.join('، ')}` : ''}${by}`;
}

export function periodText(r: MetricRequest): string {
  return formatPeriod(r.start, r.end_exclusive);
}

/** Number and unit kept apart so the number can be bidi-isolated while the unit flows in Arabic order. */
export function countParts(res: MetricResult): { value: number; unit: string } | null {
  if (res.value == null) return null;
  return { value: res.value, unit: countNoun(res.value, res.request.metric === 'visits' ? 'visit' : 'patient') };
}

export function headline(res: MetricResult): string {
  const unit = res.request.metric === 'visits' ? 'visit' : 'patient';
  if (res.value == null) return 'لا توجد بيانات معتمدة لهذه الفترة';
  return `${fmtNum(res.value)} ${countNoun(res.value, unit)}`;
}

export function coverageText(res: MetricResult): { tone: 'ok' | 'warn' | 'none'; text: string } {
  const c = res.coverage;
  if (c.status === 'complete') return { tone: 'ok', text: 'التغطية كاملة' };
  if (c.status === 'none') return { tone: 'none', text: 'الفترة غير مغطاة ببيانات معتمدة' };
  const gaps = c.gaps.slice(0, 2).map((g) => formatPeriod(g.start, g.end_exclusive)).join('، ');
  return { tone: 'warn', text: `تغطية جزئية: ${fmtNum(c.covered_days)} من ${fmtNum(c.total_days)} يومًا${gaps ? ` — ناقص: ${gaps}` : ''}` };
}

export function exclusionNotes(res: MetricResult): string[] {
  const e = res.excluded;
  const out: string[] = [];
  if (e.unknown_age) out.push(`استُبعدت ${fmtNum(e.unknown_age)} ${countNoun(e.unknown_age, 'visit')} لعدم تسجيل العمر`);
  if (e.unknown_gender) out.push(`استُبعدت ${fmtNum(e.unknown_gender)} ${countNoun(e.unknown_gender, 'visit')} لعدم تسجيل الجنس`);
  if (e.unknown_nationality) out.push(`استُبعدت ${fmtNum(e.unknown_nationality)} ${countNoun(e.unknown_nationality, 'visit')} لعدم تسجيل الجنسية`);
  if (e.unknown_patient) out.push(`${fmtNum(e.unknown_patient)} ${countNoun(e.unknown_patient, 'visit')} بلا رقم ملف لم تدخل في عد المرضى`);
  return out;
}

export function sourceText(res: MetricResult): string {
  if (res.demo) return 'بيانات تجريبية للعرض — ليست أرقام المستشفى';
  if (!res.sources.length) return 'لا يوجد مصدر معتمد';
  const s = res.sources.map((x) => x.file_name).slice(0, 2).join('، ');
  return `${s}${res.sources.length > 2 ? ` و${fmtNum(res.sources.length - 2)} أخرى` : ''} — إصدار البيانات ${fmtNum(res.dataset_version)}`;
}

/** Plain text used for copy-to-clipboard: exact value, unit, period, coverage, source. */
export function copyText(res: MetricResult): string {
  return [
    `${requestTitle(res.request)}`,
    `الفترة: ${periodText(res.request)}`,
    `النتيجة: ${headline(res)}`,
    `${coverageText(res).text}`,
    ...exclusionNotes(res),
    `المصدر: ${sourceText(res)}`,
    `تاريخ الاستخراج: ${formatInstant(res.extracted_at)}`,
  ].join('\n');
}
