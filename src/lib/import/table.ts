// Generic table import: find the header row, infer column types and roles, normalise values.
// Personal columns (names, national IDs, phones, addresses…) default to "ignore" and are never sent.
// Identifier columns (file numbers, employee numbers…) are hashed in the database.
import { addDays, parseLocalDateTime } from '../dates';
import type { ColRole, ColType, DatasetColumn, Row } from '../metrics/types';

export type Cell = string | number | boolean | Date | null | undefined;
export type Grid = Cell[][];

export function cellText(v: Cell): string {
  if (v == null) return '';
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    const time = v.getUTCHours() || v.getUTCMinutes() ? ` ${p(v.getUTCHours())}:${p(v.getUTCMinutes())}` : '';
    return `${p(v.getUTCDate())}-${p(v.getUTCMonth() + 1)}-${v.getUTCFullYear()}${time}`;
  }
  return String(v).replace(/\s+/g, ' ').trim();
}
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

const PERSONAL = /^(patient\s*name|patient|arabic patient name|arabic name|english name|name|full name|nok name|nok type|nok)$|(^|\b)(national ?id|nationalid|iqama|border|passport|mobile|phone|tel|contact|email|e-mail|address)(\b|$)|^id$|^الاسم|اسم المريض|هوية|الهوية|إقامة|اقامة|جواز|جوال|هاتف|بريد|عنوان/i;
/** Staff columns (doctors, therapists, users) are useful categories, not patient identity. */
const STAFF_COL = /doctor|consultant|physician|care ?provider|therapist|triage by|referred by|referred to (physician|careprovider)|deposited by|captured by|issued by|^user$|طبيب|استشاري|معالج/i;
const SERIAL = /^(s\.?\s?no\.?|#|no\.?|serial|م|ت|التسلسل|الرقم التسلسلي)$/i;
const IDENT = /\b(mrn|file ?no|medical record|employee ?(id|no|number)|emp ?(id|no)|staff ?(id|no)|visit ?id|encounter ?id|record ?id|id)\b|رقم الملف|الرقم الوظيفي|رقم الموظف|رقم الزيارة|السجل الطبي/i;

const LABELS: Record<string, string> = {
  'care provider': 'مقدم الرعاية', 'coding scheme': 'نظام الترميز', 'code': 'الرمز', 'description': 'الوصف', 'captured by': 'سجّله',
  'captured on': 'تاريخ التسجيل', 'visit start date': 'تاريخ بداية الزيارة', 'visit end date': 'تاريخ نهاية الزيارة', 'diagnosis': 'التشخيص',
  'new / follow up visit': 'جديد / متابعة', 'appointment date/time': 'موعد الزيارة', 'patient mrn': 'رقم الملف الطبي', 'encounter type': 'نوع الزيارة',
  'visit date': 'تاريخ الزيارة', 'consultant name': 'الاستشاري', 'revisit within days': 'العودة خلال (أيام)', 'ward / bed': 'الجناح / السرير',
  'order type': 'نوع الطلب', 'prescription no.': 'رقم الوصفة', 'order location': 'موقع الطلب', 'order date & time': 'تاريخ الطلب', 'item code': 'رمز الصنف',
  'item name': 'اسم الصنف', 'dosage': 'الجرعة', 'frequency': 'التكرار', 'qty': 'الكمية', 'order status': 'حالة الطلب', 'age / gender': 'العمر / الجنس',
  'referral date and time': 'تاريخ التحويل', 'referred by care provider': 'المحوِّل', 'referred from department': 'القسم المحوِّل',
  'referred to physician': 'الطبيب المحوَّل إليه', 'referred to department': 'القسم المحوَّل إليه', 'referral cause': 'سبب التحويل', 'ambulance': 'إسعاف',
  'physician': 'الطبيب', 'therapist': 'المعالج', "today's date (dd-mm-yyyy)": 'التاريخ', 'new / follow up ( n or f )': 'جديد / متابعة (N/F)',
  'primary diagnosis ( icd 10 )': 'التشخيص الرئيسي', 'appointment / walk-in': 'موعد / حضور مباشر', 'walk-in or appointment': 'موعد / حضور مباشر',
  'show / no show': 'حضر / لم يحضر', 'registration time ( hh:mm )': 'وقت التسجيل', 'appointment time ( hh:mm )': 'وقت الموعد',
  'kpi': 'المؤشر', 'cluster': 'التجمع', 'hospital name': 'المستشفى', 'year': 'السنة', 'start date': 'تاريخ البداية', 'end date': 'تاريخ النهاية', 'total count': 'العدد',
  'careprovider name': 'الطبيب', 'grand total': 'الإجمالي', 'total': 'الإجمالي', 'careprovider': 'الطبيب', 'department name': 'القسم', 'arrival date/time': 'وقت الوصول',
  'discharge date/time': 'وقت الخروج', 'requested on': 'تاريخ الطلب', 'request type': 'نوع الطلب', 'bill paid': 'الفاتورة مدفوعة', 'payor office': 'مكتب الدافع',
  'agreement': 'الاتفاقية', 'total bill amount': 'إجمالي الفاتورة', 'claim status': 'حالة المطالبة', 'net price': 'السعر الصافي', 'approved quantity': 'الكمية المعتمدة',
  'approved amount': 'المبلغ المعتمد', 'copay amount': 'مبلغ التحمل', 'tax amount': 'الضريبة', 'collected amount': 'المبلغ المحصل', 'bank deposit amount': 'المبلغ المودع',
  'eligibility': 'الأهلية', 'treating doctor': 'الطبيب المعالج', 'slots utilized': 'الفترات المستخدمة', 'slots not utilized': 'الفترات غير المستخدمة', 'total slots': 'إجمالي الفترات',
  'slots availability percentage': 'نسبة الإتاحة', 'slot date': 'تاريخ الفترة', 'service name ar': 'الخدمة', 'referral date': 'تاريخ التحويل',
  'referred to careprovider': 'الطبيب المحوَّل إليه', 'referred by': 'المحوِّل', 'physician optional': 'الطبيب', 'patient discharged ? (yes / no)': 'خرج المريض؟',
  'visit department': 'قسم الزيارة', 'requested number of days': 'عدد أيام الإجازة', 'approval status': 'حالة الاعتماد', 'status of request': 'حالة الطلب',
  'triage in date time': 'وقت الفرز', 'visit date time': 'وقت الزيارة', 'ctas level': 'مستوى الفرز CTAS', 'post-triage lwbs': 'غادر بعد الفرز دون رؤية الطبيب',
  'bed allocation area': 'منطقة السرير', 'ed chief complaints': 'الشكوى الرئيسية', 'referring hospital': 'المستشفى المحوِّل', 'bill date': 'تاريخ الفاتورة', 'amount': 'المبلغ',
  'type': 'النوع', 'death date time': 'تاريخ الوفاة', 'death reason': 'سبب الوفاة', 'cause of death': 'سبب الوفاة التفصيلي', 'died outside hospital': 'توفي خارج المستشفى',
  'brought dead': 'وصل متوفى', 'died in hospital': 'توفي في المستشفى', 'chief complaints': 'الشكوى الرئيسية', 'discharge disposition': 'نوع الخروج', 'time difference': 'الفرق بالساعات',
  'revisit within 72h': 'عودة خلال 72 ساعة', 'triage date and time': 'وقت الفرز', 'previous visit date': 'تاريخ الزيارة السابقة', 'iscancelled': 'ملغاة',
  'antibiotic name': 'اسم المضاد', 'dispensed qty': 'الكمية المصروفة', 'uom': 'الوحدة', 'referred to': 'جهة التحويل', 'speciality': 'التخصص',
  'encounter': 'نوع الزيارة', 'mrn': 'رقم الملف الطبي', 'gender': 'الجنس', 'sex': 'الجنس', 'age': 'العمر', 'nationality': 'الجنسية',
  'patient type': 'فئة المريض', 'payor': 'جهة الدفع', 'payer': 'جهة الدفع', 'actual visit start date & time': 'تاريخ ووقت الزيارة',
  'visit start date & time': 'بداية الزيارة', 'medical discharge date & time': 'الخروج الطبي', 'visit end date & time': 'نهاية الزيارة',
  'visit id': 'رقم الزيارة', 'department': 'القسم', 'appointment clinic': 'العيادة', 'ward': 'الجناح', 'bed': 'السرير', 'los': 'مدة البقاء',
  'primary careprovider': 'الطبيب المعالج', 'type of surgery': 'نوع العملية', 'discharge type': 'نوع الخروج',
  'admission diagnosis': 'تشخيص الدخول', 'discharge diagnosis': 'تشخيص الخروج', 'accident type': 'نوع الحادث', 'facility': 'المنشأة',
  'employee id': 'الرقم الوظيفي', 'employee no': 'الرقم الوظيفي', 'job title': 'المسمى الوظيفي', 'position': 'الوظيفة', 'grade': 'المرتبة',
  'hire date': 'تاريخ التعيين', 'joining date': 'تاريخ التعيين', 'salary': 'الراتب', 'status': 'الحالة', 'specialty': 'التخصص',
  'category': 'الفئة', 'qualification': 'المؤهل', 'section': 'القسم الفرعي', 'shift': 'المناوبة', 'date of birth': 'تاريخ الميلاد', 'dob': 'تاريخ الميلاد',
  'religion': 'الديانة', 'marital status': 'الحالة الاجتماعية', 'contract type': 'نوع العقد', 'unit': 'الوحدة', 'date': 'التاريخ',
};

export function columnKey(header: string, index: number): string {
  let h = 2166136261;
  const s = `${norm(header)}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  const ascii = norm(header).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  // Derived from the header only, so the same column gets the same key in every future file.
  void index;
  return ascii && /^[a-z]/.test(ascii) ? `${ascii}_${(h >>> 0).toString(36).slice(0, 4)}` : `c_${(h >>> 0).toString(36)}`;
}

export function headerSignature(headers: string[]): string {
  return headers.map(norm).filter(Boolean).sort().join('|');
}

/** Header row = the row with the most text cells that is followed by data rows. */
export function findHeaderRow(grid: Grid): number {
  let best = -1, bestScore = 0;
  for (let i = 0; i < Math.min(grid.length - 1, 40); i++) {
    const row = grid[i] ?? [];
    if (row.some((c) => /from\s*date|to\s*date/i.test(cellText(c)))) continue;
    const texts = new Set(row.filter((c) => typeof c === 'string' && c.trim() && !/^\d+([.,]\d+)?$/.test(c.trim())).map((c) => String(c).trim())).size;
    if (texts < 2) continue;
    const next = grid.slice(i + 1, i + 6).filter((r) => (r ?? []).filter((c) => cellText(c) !== '').length >= Math.min(2, texts)).length;
    const score = texts * (next > 0 ? 1 : 0) + next * 0.5;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

export function parseAgeYears(v: Cell): number | null | 'bad' {
  if (v == null || String(v).trim() === '') return null;
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= 130 ? v : 'bad';
  const t = String(v).trim();
  const m = /^(\d{1,3})\s*(?:Y|Yr|Yrs|Year|Years|سنة|سنه)\b/i.exec(t) ?? /^(\d{1,3})(?:\.0)?$/.exec(t);
  if (!m) return 'bad';
  const n = Number(m[1]);
  return n <= 130 ? n : 'bad';
}

function toNumber(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  const t = String(v).trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

function toDateTime(v: Cell): { iso: string; hasTime: boolean } | null {
  if (v instanceof Date) {
    const t = cellText(v);
    const iso = parseLocalDateTime(t);
    return iso ? { iso, hasTime: /\d{2}:\d{2}$/.test(t) } : null;
  }
  if (typeof v === 'number') return null;
  const t = cellText(v);
  if (!t) return null;
  const iso = parseLocalDateTime(t);
  if (iso) return { iso, hasTime: /\d{1,2}:\d{2}/.test(t) };
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(t);
  if (m) return { iso: `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:00+03:00`, hasTime: !!m[4] };
  return null;
}

const BOOL_T = new Set(['yes', 'y', 'true', 'نعم']);
const BOOL_F = new Set(['no', 'n', 'false', 'لا']);

export interface ColumnPlan extends DatasetColumn {
  index: number;
  samples: string[];
  filled: number;
  parse: 'age' | null;
  invalid: number;
}

export function inferColumns(headers: string[], body: Grid): ColumnPlan[] {
  const total = body.length;
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const h = norm(header);
    const vals = body.map((r) => r?.[index]).filter((v) => cellText(v) !== '');
    const sample = vals.slice(0, 500);
    const frac = (f: (v: Cell) => boolean) => (sample.length ? sample.filter(f).length / sample.length : 0);
    let type: ColType = 'text';
    let parse: ColumnPlan['parse'] = null;
    const textVals = sample.map((v) => cellText(v));
    const idLike = textVals.some((t) => /^0\d+/.test(t) || /^\d{9,}$/.test(t));
    if (/(^|\b)age\b|العمر|عمر/.test(h) && frac((v) => parseAgeYears(v) !== 'bad') >= 0.9) { type = 'number'; parse = 'age'; }
    else if (!idLike && frac((v) => toNumber(v) != null) >= 0.9) type = 'number';
    else if (frac((v) => toDateTime(v) != null) >= 0.9) type = sample.some((v) => toDateTime(v)?.hasTime) ? 'datetime' : 'date';
    else if (sample.length && frac((v) => BOOL_T.has(norm(cellText(v))) || BOOL_F.has(norm(cellText(v)))) === 1) type = 'boolean';
    const distinct = new Set(textVals).size;
    let role: ColRole;
    if (!header.trim() || SERIAL.test(header.trim()) || vals.length === 0) role = 'ignore';
    else if (PERSONAL.test(header) && !STAFF_COL.test(header)) role = 'ignore';
    else if (IDENT.test(header)) role = 'identifier';
    else if (type === 'date' || type === 'datetime') role = 'date';
    else if (type === 'number') role = 'measure';
    else if (type === 'text' && STAFF_COL.test(header)) role = 'dimension';
    else if (type === 'text' && total > 30 && distinct / Math.max(1, vals.length) > 0.9) role = 'identifier';
    else role = 'dimension';
    const label = LABELS[h] ?? (/[؀-ۿ]/.test(header) ? header.replace(/\s+/g, ' ').trim() : header.replace(/\s+/g, ' ').trim());
    let key = columnKey(header, index);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n > 0) key = `${key}_${n}`.slice(0, 40);
    return {
      index, key, label, type, role, source_header: header.replace(/\s+/g, ' ').trim(),
      samples: role === 'ignore' || role === 'identifier' ? [] : [...new Set(textVals)].slice(0, 3),
      filled: vals.length, parse, invalid: 0,
    };
  });
}

export function convert(c: ColumnPlan, v: Cell): string | number | boolean | null | 'invalid' {
  if (cellText(v) === '') return null;
  switch (c.type) {
    case 'number': {
      if (c.parse === 'age') { const a = parseAgeYears(v); return a === 'bad' ? 'invalid' : a; }
      const n = toNumber(v); return n == null ? 'invalid' : n;
    }
    case 'datetime': { const d = toDateTime(v); return d ? d.iso : 'invalid'; }
    case 'date': { const d = toDateTime(v); return d ? d.iso.slice(0, 10) : 'invalid'; }
    case 'boolean': { const t = norm(cellText(v)); return BOOL_T.has(t) ? true : BOOL_F.has(t) ? false : 'invalid'; }
    default: return cellText(v);
  }
}

export interface ParsedTable {
  headerRowIndex: number;
  headers: string[];
  columns: ColumnPlan[];
  rows: { row_no: number; data: Row }[];
  emptyRows: number;
  declared: { start: string | null; endInclusive: string | null };
  preset: Preset | null;
}

export interface Preset { id: 'visit_report'; name: string; unit_label: string; mode: 'append'; period_header: string; key_header: string }

const VISIT_PRESET: Preset = { id: 'visit_report', name: 'زيارات المرضى', unit_label: 'زيارة', mode: 'append', period_header: 'actual visit start date & time', key_header: 'visit id' };

export function detectPreset(headers: string[]): Preset | null {
  const h = headers.map(norm);
  return h.includes('visit id') && h.includes('encounter') && h.includes(VISIT_PRESET.period_header) ? VISIT_PRESET : null;
}

function findDeclared(grid: Grid, headerRow: number) {
  let start: string | null = null, endInclusive: string | null = null;
  for (let i = 0; i < headerRow; i++) for (const c of grid[i] ?? []) {
    const t = cellText(c);
    const from = /(from\s*date|من تاريخ|من)\s*:?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{4})/i.exec(t);
    const to = /(to\s*date|إلى تاريخ|الى تاريخ|إلى|الى)\s*:?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{4})/i.exec(t);
    if (from) start = parseLocalDateTime(from[2])?.slice(0, 10) ?? start;
    if (to) endInclusive = parseLocalDateTime(to[2])?.slice(0, 10) ?? endInclusive;
  }
  return { start, endInclusive };
}

const FOOTER = /printed by|printed date|page\s*\d+\s*of|^page\s*\d+$|^total$|^grand total$|^المجموع$|^الإجمالي$|^الاجمالي$/i;
const DECLARED = /from\s*date|to\s*date|من تاريخ|إلى تاريخ/i;

/** "Department : X", "Speciality : Y", or a lone label row such as "Emergency" heading a group of data rows. */
function sectionOf(r: Cell[] | undefined): { label: string; value: string } | null {
  const cells = (r ?? []).map((c) => cellText(c)).filter((t) => t !== '');
  if (cells.length === 0 || cells.length > 2) return null;
  if (cells.some((t) => FOOTER.test(t))) return null;
  const joined = cells.join(' ');
  const m = /^(.{2,40}?)\s*:\s*(.*)$/.exec(joined);
  if (m) return { label: m[1].trim(), value: m[2].replace(/^:\s*/, '').trim() };
  if (cells.length === 1 && !/^[\d.,/: -]+$/.test(cells[0]) && cells[0].length <= 60) return { label: 'المجموعة', value: cells[0] };
  return null;
}

/** Combine a parent header row (e.g. "Saudi" over "M"/"F") with the header row. */
function combinedHeaders(grid: Grid, hr: number, childIdx = hr): string[] {
  const child = (grid[childIdx] ?? []).map((c) => cellText(c));
  const parentRow = childIdx !== hr ? (grid[hr] ?? []).map((c) => cellText(c)) : hr > 0 ? (grid[hr - 1] ?? []).map((c) => cellText(c)) : [];
  const parentTexts = parentRow.filter(Boolean);
  if (parentTexts.length < 2 || parentTexts.some((t) => DECLARED.test(t) || /:\s*$/.test(t))) return child;
  const width = Math.max(child.length, parentRow.length);
  const out: string[] = [];
  let carry = '', carried = 0;
  for (let j = 0; j < width; j++) {
    const p = parentRow[j] ?? '';
    if (p) { carry = p; carried = 0; } else carried++;
    const parent = p || (carried === 1 ? carry : '');
    const c = child[j] ?? '';
    out.push(parent && c ? `${parent} ${c}` : parent || c);
  }
  return out;
}

export function parseTable(grid: Grid, override?: { headerRowIndex?: number; columns?: ColumnPlan[] }): ParsedTable {
  const hr = override?.headerRowIndex ?? findHeaderRow(grid);
  if (hr < 0) return { headerRowIndex: -1, headers: [], columns: [], rows: [], emptyRows: 0, declared: { start: null, endInclusive: null }, preset: null };
  // A sub-header row right under the header (all short texts, no numbers/dates, no "label : value") is part of the header.
  const next = (grid[hr + 1] ?? []).map((c) => cellText(c)).filter(Boolean);
  const subHeader = !override && next.length >= 2 && next.every((t) => !/^-?[\d.,]+$/.test(t) && !/\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(t) && !t.includes(':') && t.length <= 40);
  const headers = subHeader ? combinedHeaders(grid, hr, hr + 1) : combinedHeaders(grid, hr);
  const bodyStart = subHeader ? hr + 2 : hr + 1;
  const width = Math.max(headers.length, ...grid.slice(hr + 1, hr + 50).map((r) => r?.length ?? 0));
  while (headers.length < width) headers.push('');

  // Classify body rows once: data, group header (section), or footer/empty.
  type Kind = { kind: 'data'; r: Cell[]; i: number; sections: Record<string, string> } | { kind: 'skip' };
  const sections: Record<string, string> = {};
  const sectionLabels: string[] = [];
  // Multi-page exports repeat the title block and the column titles; such rows are not data.
  const preamble = new Set(grid.slice(0, bodyStart).flatMap((r) => (r ?? []).map((c) => norm(cellText(c)))).filter(Boolean));
  const nonEmptyHeaders = headers.filter(Boolean).length;
  // When the report numbers its records (S no / Sr / م), a row without that number is not a record:
  // wrapped text continued on the next printed line, or a summary table printed after the list.
  const bodyRows = grid.slice(bodyStart);
  const isSerial = (c: Cell) => typeof c === 'number' ? Number.isInteger(c) && c > 0 : /^\d{1,7}$/.test(cellText(c).trim());
  let anchor = -1;
  for (let j = 0; j < Math.min(headers.length, 4) && anchor < 0; j++) {
    if (!/^(s\.?\s*no\.?|sr\.?\s*(no\.?)?|serial(\s*no\.?)?|sl\.?\s*no\.?|#|م|ت|الرقم التسلسلي|رقم تسلسلي)$/i.test(headers[j].trim())) continue;
    const vals = bodyRows.slice(0, 400).map((r) => r?.[j] ?? null).filter((c) => cellText(c) !== '' && !preamble.has(norm(cellText(c))) && !FOOTER.test(cellText(c)) && !DECLARED.test(cellText(c)));
    if (vals.length >= 5 && vals.filter(isSerial).length >= vals.length * 0.9) anchor = j;
  }
  const classified: Kind[] = bodyRows.map((r, i) => {
    const filled = (r ?? []).filter((c) => cellText(c) !== '');
    if (filled.length === 0) return { kind: 'skip' };
    if (anchor >= 0 && !isSerial(r?.[anchor] ?? null)) return { kind: 'skip' };
    if ((r ?? []).slice(0, 6).some((c) => FOOTER.test(cellText(c)) || DECLARED.test(cellText(c)))) return { kind: 'skip' };
    const repeats = filled.filter((c) => preamble.has(norm(cellText(c)))).length;
    if (repeats > 0 && repeats >= filled.length / 2) return { kind: 'skip' };
    if (filled.length <= 2 && nonEmptyHeaders > 3) {
      // A wrapped cell continued on the next line leaves the first column empty: not a record.
      const firstIdx = (r ?? []).findIndex((c) => cellText(c) !== '');
      if (firstIdx > 1) return { kind: 'skip' };
      const sec = sectionOf(r);
      if (sec) {
        if (sec.value && !sectionLabels.includes(sec.label)) sectionLabels.push(sec.label);
        sections[sec.label] = sec.value;
        return { kind: 'skip' };
      }
      if (filled.length === 1) return { kind: 'skip' };
    }
    return { kind: 'data', r: r ?? [], i, sections: { ...sections } };
  });
  const dataRows = classified.filter((x): x is Extract<Kind, { kind: 'data' }> => x.kind === 'data');
  const body = dataRows.map((x) => x.r);

  const preset = detectPreset(headers);
  let columns = override?.columns ?? inferColumns(headers, body);
  if (!override?.columns) {
    // Group headers become ordinary category columns, filled down.
    sectionLabels.forEach((label, n) => {
      const vals = dataRows.map((x) => x.sections[label]).filter(Boolean);
      columns.push({
        index: -1 - n, key: columnKey(`section:${label}`, -1), label: LABELS[norm(label)] ?? label, type: 'text', role: 'dimension',
        source_header: `[${label}]`, samples: [...new Set(vals)].slice(0, 3), filled: vals.length, parse: null, invalid: 0,
      });
    });
    if (preset) {
      columns = columns.map((c) => {
        const h = norm(c.source_header ?? '');
        if (h === preset.key_header) return { ...c, role: 'identifier' as ColRole };
        if (h === preset.period_header) return { ...c, type: 'datetime' as ColType, role: 'date' as ColRole };
        if (h === 'los') return { ...c, type: 'number' as ColType, role: 'measure' as ColRole };
        return c;
      });
    }
  }
  columns = columns.map((c) => ({ ...c, invalid: 0 }));
  const sectionByIndex = new Map(columns.filter((c) => c.index < 0).map((c) => [c.index, c.source_header!.slice(1, -1)]));
  const rows: ParsedTable['rows'] = dataRows.map((x) => {
    const data: Row = {};
    for (const c of columns) {
      if (c.role === 'ignore') continue;
      const raw = c.index < 0 ? x.sections[sectionByIndex.get(c.index)!] : x.r[c.index];
      const v = convert(c, raw);
      if (v === 'invalid') { c.invalid++; data[c.key] = null; } else if (v !== null) data[c.key] = v;
    }
    return { row_no: bodyStart + 1 + x.i, data };
  });
  return { headerRowIndex: hr, headers, columns, rows, emptyRows: classified.length - dataRows.length, declared: findDeclared(grid, hr), preset };
}

/** Coverage proposal for period datasets; a report cut during its last day does not mark that day complete. */
export function proposeCoverage(
  declared: { start: string | null; endInclusive: string | null },
  observed: { first: string | null; last: string | null },
): { start: string; end_exclusive: string; note: string | null } | null {
  const start = declared.start ?? observed.first?.slice(0, 10) ?? null;
  const endIncl = declared.endInclusive ?? observed.last?.slice(0, 10) ?? null;
  if (!start || !endIncl) return null;
  let end_exclusive = addDays(endIncl, 1);
  let note: string | null = declared.start ? null : 'لم يذكر الملف فترته؛ الفترة مقترحة من أول وآخر تاريخ.';
  if (observed.last && observed.last.length > 10 && observed.last.slice(0, 10) === endIncl) {
    const hour = Number(observed.last.slice(11, 13));
    if (hour < 20 && endIncl > start) {
      end_exclusive = endIncl;
      note = `آخر سجل في ${endIncl} كان الساعة ${observed.last.slice(11, 16)}؛ يبدو أن الملف استُخرج أثناء ذلك اليوم، لذلك لم يُعتبر اليوم الأخير مكتملًا.`;
    }
  }
  return { start, end_exclusive, note };
}

export function observedRange(rows: { data: Row }[], key: string | null): { first: string | null; last: string | null } {
  if (!key) return { first: null, last: null };
  const vals = rows.map((r) => r.data[key]).filter((v): v is string => typeof v === 'string').sort();
  return { first: vals[0] ?? null, last: vals[vals.length - 1] ?? null };
}

export function csvToGrid(text: string): Grid {
  const out: Grid = [];
  let row: Cell[] = [], field = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); out.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); out.push(row); }
  return out;
}
