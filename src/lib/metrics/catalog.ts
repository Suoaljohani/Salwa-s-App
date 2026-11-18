import type { Dimension, MetricId } from './types';

/** Bump when a definition below changes meaning. Mirrors app_config.definition_version. */
export const DEFINITION_VERSION = 1;

export const METRICS: Record<MetricId, { label: string; unit: string; unitPlural: string; definition: string }> = {
  visits: {
    label: 'الزيارات',
    unit: 'زيارة',
    unitPlural: 'زيارات',
    definition: 'كل سجل زيارة بمعرّف زيارة فريد يُعد مرة واحدة. تكرار مراجعة الشخص يُعد زيارات متعددة.',
  },
  distinct_patients: {
    label: 'المرضى المختلفون',
    unit: 'مريض',
    unitPlural: 'مرضى',
    definition: 'عدد المرضى المختلفين بحسب رقم الملف الطبي بعد تحويله إلى معرّف مستعار. المريض الذي راجع أكثر من مرة يُعد مرة واحدة في الفترة.',
  },
};

export const DIMENSIONS: Record<Dimension, string> = {
  month: 'الشهر',
  day: 'اليوم',
  encounter_type: 'نوع الزيارة',
  department: 'القسم',
  payor: 'جهة الدفع',
  discharge_type: 'نوع الخروج',
  gender: 'الجنس',
  nationality_group: 'الجنسية',
  age_band: 'الفئة العمرية',
};

export const DIMENSION_ORDER: Dimension[] = [
  'month', 'encounter_type', 'department', 'gender', 'age_band', 'nationality_group', 'payor', 'discharge_type', 'day',
];

/** Age bands: non-overlapping, age measured at the visit; 18 belongs to 18to44. */
export const AGE_BANDS: { id: string; label: string; min: number; maxExclusive: number | null }[] = [
  { id: 'lt14', label: 'أقل من 14', min: 0, maxExclusive: 14 },
  { id: '14to17', label: '14 إلى أقل من 18', min: 14, maxExclusive: 18 },
  { id: '18to44', label: '18 إلى أقل من 45', min: 18, maxExclusive: 45 },
  { id: '45to64', label: '45 إلى أقل من 65', min: 45, maxExclusive: 65 },
  { id: '65plus', label: '65 فأكثر', min: 65, maxExclusive: null },
];

/** Compact axis labels; full wording stays in tables and tooltips. */
export const AGE_SHORT: Record<string, string> = { lt14: '‎<14', '14to17': '14–17', '18to44': '18–44', '45to64': '45–64', '65plus': '65+', __unknown: 'غير مسجّل' };

export function ageBandOf(age: number | null): string {
  if (age == null) return '__unknown';
  for (const b of AGE_BANDS) if (age >= b.min && (b.maxExclusive == null || age < b.maxExclusive)) return b.id;
  return '__unknown';
}

const ENCOUNTER_LABELS: Record<string, string> = {
  Emergency: 'الطوارئ',
  Outpatient: 'العيادات الخارجية',
  Inpatient: 'التنويم',
  'Day Care': 'الرعاية اليومية',
};

const PAYOR_LABELS: Record<string, string> = {
  'Saudi Government': 'حكومي',
  Selfpay: 'دفع ذاتي',
};

const DISCHARGE_LABELS: Record<string, string> = {
  Discharged: 'خروج',
  'Referred to Another Hospital': 'تحويل إلى مستشفى آخر',
};

/** Arabic label for a category value; raw source text is kept when no translation is known. */
export function valueLabel(dim: Dimension | string, value: string | undefined | null): string {
  if (value == null) return '—';
  if (value === '__unknown') return 'غير مسجّل';
  if (value === '__none') return 'غير محدد';
  switch (dim) {
    case 'gender':
      return value === 'M' ? 'ذكور' : value === 'F' ? 'إناث' : value;
    case 'nationality_group':
      return value === 'saudi' ? 'سعودي' : value === 'non_saudi' ? 'غير سعودي' : value;
    case 'age_band':
      return AGE_BANDS.find((b) => b.id === value)?.label ?? value;
    case 'encounter_type':
      return ENCOUNTER_LABELS[value] ?? value;
    case 'payor':
      return PAYOR_LABELS[value] ?? value;
    case 'discharge_type':
      return DISCHARGE_LABELS[value] ?? value;
    case 'department':
      return cleanDepartment(value);
    case 'month':
      return monthLabel(value);
    default:
      return value;
  }
}

/** Departments arrive as mixed "English   عربي" strings; prefer the Arabic part when present. */
export function cleanDepartment(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').trim();
  const arabic = s.match(/[؀-ۿ][؀-ۿ\s&]*[؀-ۿ]/g);
  if (arabic && arabic.join('').length >= 4) return arabic.join(' ').replace(/\s+/g, ' ').trim();
  const known: Record<string, string> = {
    'Emergency Medicine': 'طب الطوارئ',
    'Diabetes Screening Clinic': 'عيادة فحص السكري',
    'Physical Therapy': 'العلاج الطبيعي',
    'MEDICAL REHABILITATION': 'التأهيل الطبي',
    'Occupational Therapy': 'العلاج الوظيفي',
  };
  return known[s] ?? s;
}

export const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export function monthLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  return `${MONTHS_AR[m - 1]} ${y}`;
}

/** Source fields that are known not to exist in the current visit report. */
export const UNAVAILABLE_FIELDS: Record<string, string> = {
  ctas: 'تصنيف CTAS غير موجود في تقرير الزيارات الحالي',
  diagnosis: 'التشخيص غير مسجّل في معظم سجلات التقرير الحالي',
  ward: 'التنويم والأسرّة غير موجودة في التقرير الحالي',
};
