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

const PERSONAL = /(^|\b)(patient name|arabic patient name|name|full name|nok|national ?id|iqama|border|passport|mobile|phone|tel|email|e-mail|address)(\b|$)|اسم|الاسم|هوية|الهوية|إقامة|اقامة|جواز|جوال|هاتف|بريد|عنوان/i;
const SERIAL = /^(s\.?\s?no\.?|#|no\.?|serial|م|ت|التسلسل|الرقم التسلسلي)$/i;
const IDENT = /\b(mrn|file ?no|medical record|employee ?(id|no|number)|emp ?(id|no)|staff ?(id|no)|visit ?id|encounter ?id|record ?id|id)\b|رقم الملف|الرقم الوظيفي|رقم الموظف|رقم الزيارة|السجل الطبي/i;

const LABELS: Record<string, string> = {
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
  const m = /^(\d{1,3})\s*Y\b/i.exec(t) ?? /^(\d{1,3})$/.exec(t);
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
    else if (PERSONAL.test(header)) role = 'ignore';
    else if (IDENT.test(header)) role = 'identifier';
    else if (type === 'date' || type === 'datetime') role = 'date';
    else if (type === 'number') role = 'measure';
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

export function parseTable(grid: Grid, override?: { headerRowIndex?: number; columns?: ColumnPlan[] }): ParsedTable {
  const hr = override?.headerRowIndex ?? findHeaderRow(grid);
  if (hr < 0) return { headerRowIndex: -1, headers: [], columns: [], rows: [], emptyRows: 0, declared: { start: null, endInclusive: null }, preset: null };
  const headers = (grid[hr] ?? []).map((c) => cellText(c));
  const width = Math.max(headers.length, ...grid.slice(hr + 1, hr + 50).map((r) => r?.length ?? 0));
  while (headers.length < width) headers.push('');
  const body = grid.slice(hr + 1);
  const preset = detectPreset(headers);
  let columns = override?.columns ?? inferColumns(headers, body);
  if (!override?.columns && preset) {
    columns = columns.map((c) => {
      const h = norm(c.source_header ?? '');
      if (h === preset.key_header) return { ...c, role: 'identifier' as ColRole };
      if (h === preset.period_header) return { ...c, type: 'datetime' as ColType, role: 'date' as ColRole };
      if (h === 'los') return { ...c, type: 'number' as ColType, role: 'measure' as ColRole };
      return c;
    });
  }
  columns = columns.map((c) => ({ ...c, invalid: 0 }));
  const rows: ParsedTable['rows'] = [];
  let emptyRows = 0;
  body.forEach((r, i) => {
    const filled = (r ?? []).filter((c) => cellText(c) !== '').length;
    if (filled === 0) { emptyRows++; return; }
    // Footer/summary lines: a single filled cell in a wide table.
    if (filled === 1 && headers.filter(Boolean).length > 3) { emptyRows++; return; }
    const data: Row = {};
    for (const c of columns) {
      if (c.role === 'ignore') continue;
      const v = convert(c, r?.[c.index]);
      if (v === 'invalid') { c.invalid++; data[c.key] = null; } else if (v !== null) data[c.key] = v;
    }
    rows.push({ row_no: hr + 2 + i, data });
  });
  return { headerRowIndex: hr, headers, columns, rows, emptyRows, declared: findDeclared(grid, hr), preset };
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
