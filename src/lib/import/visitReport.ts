// Parse a hospital "All Patient Visit Report" (or a compatible XLSX/CSV) into normalised visit rows.
// Works on a plain grid so it is testable without a workbook library.
// Names, national IDs, phone numbers and next-of-kin are never read into the output.
import { addDays, parseLocalDateTime } from '../dates';
import type { VisitRow } from '../metrics/types';

export type Cell = string | number | boolean | Date | null | undefined;
export type Grid = Cell[][];

export type FieldId =
  | 'visit_id' | 'mrn' | 'encounter_type' | 'department' | 'clinic' | 'gender' | 'age'
  | 'nationality' | 'payor' | 'patient_type' | 'visit_at' | 'discharge_type' | 'los';

export const FIELDS: { id: FieldId; label: string; required: boolean; synonyms: string[] }[] = [
  { id: 'visit_id', label: 'رقم الزيارة', required: true, synonyms: ['visit id', 'visit no', 'encounter id', 'رقم الزيارة'] },
  { id: 'visit_at', label: 'تاريخ ووقت الزيارة', required: true, synonyms: ['actual visit start date & time', 'visit start date & time', 'visit date', 'تاريخ الزيارة'] },
  { id: 'encounter_type', label: 'نوع الزيارة', required: true, synonyms: ['encounter', 'encounter type', 'visit type', 'نوع الزيارة'] },
  { id: 'mrn', label: 'رقم الملف الطبي', required: false, synonyms: ['mrn', 'medical record number', 'file no', 'رقم الملف'] },
  { id: 'department', label: 'القسم', required: false, synonyms: ['department', 'dept', 'القسم'] },
  { id: 'clinic', label: 'العيادة', required: false, synonyms: ['appointment clinic', 'clinic', 'العيادة'] },
  { id: 'gender', label: 'الجنس', required: false, synonyms: ['gender', 'sex', 'الجنس'] },
  { id: 'age', label: 'العمر وقت الزيارة', required: false, synonyms: ['age', 'العمر'] },
  { id: 'nationality', label: 'الجنسية', required: false, synonyms: ['nationality', 'الجنسية'] },
  { id: 'payor', label: 'جهة الدفع', required: false, synonyms: ['payor', 'payer', 'جهة الدفع'] },
  { id: 'patient_type', label: 'فئة المريض', required: false, synonyms: ['patient type'] },
  { id: 'discharge_type', label: 'نوع الخروج', required: false, synonyms: ['discharge type', 'نوع الخروج'] },
  { id: 'los', label: 'مدة البقاء', required: false, synonyms: ['los', 'length of stay'] },
];

/** Columns that are recognised as personal identifiers and are deliberately ignored. */
export const IGNORED_PERSONAL = ['patient name', 'arabic patient name', 'national id', 'border /iqama no', 'mobile no', 'nok type', 'nok name'];

export type Mapping = Partial<Record<FieldId, number>>;

export interface ColumnInfo {
  index: number;
  header: string;
  samples: string[];
  personal: boolean;
}

export interface ParsedRow extends VisitRow {
  row_no: number;
  /** raw MRN: only sent to the database, where it is replaced by a keyed hash */
  mrn: string | null;
}

export interface RowIssue {
  row_no: number;
  code: 'missing_visit_id' | 'bad_visit_date' | 'missing_encounter' | 'bad_age' | 'duplicate_visit_id';
  detail?: string;
}

export interface ParseResult {
  headerRowIndex: number;
  columns: ColumnInfo[];
  mapping: Mapping;
  declared: { start: string | null; endInclusive: string | null };
  rows: ParsedRow[];
  issues: RowIssue[];
  observed: { first: string | null; last: string | null };
  /** proposed coverage: declared period, trimmed when the last day looks cut off */
  proposedCoverage: { start: string; end_exclusive: string; note: string | null } | null;
  totals: { dataRows: number; accepted: number; rejected: number; duplicatesInFile: number };
}

const norm = (v: Cell) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export function cellText(v: Cell): string {
  if (v == null) return '';
  if (v instanceof Date) {
    // Excel dates are local wall-clock values stored without zone; keep the wall clock.
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(v.getUTCDate())}-${p(v.getUTCMonth() + 1)}-${v.getUTCFullYear()} ${p(v.getUTCHours())}:${p(v.getUTCMinutes())}`;
  }
  return String(v).trim();
}

export function findHeaderRow(grid: Grid): number {
  let best = -1, bestScore = 0;
  for (let i = 0; i < Math.min(grid.length, 40); i++) {
    const cells = (grid[i] ?? []).map(norm);
    let score = 0;
    for (const f of FIELDS) if (cells.some((c) => f.synonyms.includes(c))) score += f.required ? 3 : 1;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return bestScore >= 6 ? best : -1;
}

export function suggestMapping(headers: string[]): Mapping {
  const m: Mapping = {};
  const h = headers.map((x) => norm(x));
  for (const f of FIELDS) {
    for (const syn of f.synonyms) {
      const idx = h.findIndex((x, i) => x === syn && !Object.values(m).includes(i));
      if (idx >= 0) { m[f.id] = idx; break; }
    }
  }
  return m;
}

function findDeclared(grid: Grid, headerRow: number): { start: string | null; endInclusive: string | null } {
  let start: string | null = null, endInclusive: string | null = null;
  for (let i = 0; i < headerRow; i++) {
    for (const c of grid[i] ?? []) {
      const t = cellText(c);
      const from = /from\s*date\s*:\s*(\d{1,2}-\d{1,2}-\d{4})/i.exec(t);
      const to = /to\s*date\s*:\s*(\d{1,2}-\d{1,2}-\d{4})/i.exec(t);
      if (from) start = parseLocalDateTime(from[1])?.slice(0, 10) ?? null;
      if (to) endInclusive = parseLocalDateTime(to[1])?.slice(0, 10) ?? null;
    }
  }
  return { start, endInclusive };
}

/** "21 Y 2 M 18 D" → 21. "64 Y" → 64. A bare number → that number. Otherwise null. */
export function parseAgeYears(v: Cell): number | null | 'bad' {
  if (v == null || String(v).trim() === '') return null;
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= 130 ? v : 'bad';
  const t = String(v).trim();
  const m = /^(\d{1,3})\s*Y\b/i.exec(t) ?? /^(\d{1,3})$/.exec(t);
  if (!m) return 'bad';
  const n = Number(m[1]);
  return n <= 130 ? n : 'bad';
}

function parseGender(v: Cell): 'M' | 'F' | null {
  const t = norm(v);
  if (['male', 'm', 'ذكر'].includes(t)) return 'M';
  if (['female', 'f', 'أنثى', 'انثى'].includes(t)) return 'F';
  return null;
}

function parseVisitAt(v: Cell): string | null {
  if (v instanceof Date) return parseLocalDateTime(cellText(v));
  if (typeof v === 'number') {
    // Excel serial date (local wall clock)
    const ms = Math.round((v - 25569) * 86400_000);
    return parseLocalDateTime(cellText(new Date(ms)));
  }
  const t = cellText(v);
  return parseLocalDateTime(t) ?? (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(t) ? `${t.replace(' ', 'T').slice(0, 16)}:00+03:00` : null);
}

const clean = (v: Cell) => {
  const t = cellText(v).replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
};

export function parseVisitGrid(grid: Grid, mappingOverride?: Mapping): ParseResult {
  const headerRowIndex = findHeaderRow(grid);
  if (headerRowIndex < 0 && !mappingOverride) {
    return {
      headerRowIndex, columns: [], mapping: {}, declared: { start: null, endInclusive: null }, rows: [], issues: [],
      observed: { first: null, last: null }, proposedCoverage: null, totals: { dataRows: 0, accepted: 0, rejected: 0, duplicatesInFile: 0 },
    };
  }
  const hr = Math.max(headerRowIndex, 0);
  const headers = (grid[hr] ?? []).map((c) => cellText(c));
  const body = grid.slice(hr + 1);
  const columns: ColumnInfo[] = headers.map((header, index) => ({
    index,
    header,
    personal: IGNORED_PERSONAL.includes(norm(header)),
    samples: IGNORED_PERSONAL.includes(norm(header))
      ? []
      : body.slice(0, 40).map((r) => cellText(r?.[index])).filter(Boolean).slice(0, 3),
  })).filter((c) => c.header !== '');
  const mapping = mappingOverride ?? suggestMapping(headers);
  const declared = findDeclared(grid, hr);

  const rows: ParsedRow[] = [];
  const issues: RowIssue[] = [];
  const seen = new Set<string>();
  let dataRows = 0, dup = 0;
  const get = (r: Cell[], f: FieldId) => (mapping[f] === undefined ? undefined : r[mapping[f]!]);

  body.forEach((r, i) => {
    const row_no = hr + 2 + i; // 1-based sheet row
    if (!r || r.every((c) => cellText(c) === '')) return;
    const visitIdRaw = clean(get(r, 'visit_id'));
    const visitAtRaw = get(r, 'visit_at');
    // Skip footer/summary lines that carry no visit identity and no date.
    if (!visitIdRaw && !clean(visitAtRaw)) return;
    dataRows++;
    if (!visitIdRaw) { issues.push({ row_no, code: 'missing_visit_id' }); return; }
    const visit_at = parseVisitAt(visitAtRaw);
    if (!visit_at) { issues.push({ row_no, code: 'bad_visit_date', detail: cellText(visitAtRaw) }); return; }
    const encounter = clean(get(r, 'encounter_type'));
    if (!encounter) { issues.push({ row_no, code: 'missing_encounter' }); return; }
    if (seen.has(visitIdRaw)) { dup++; issues.push({ row_no, code: 'duplicate_visit_id', detail: visitIdRaw }); return; }
    seen.add(visitIdRaw);
    const age = parseAgeYears(get(r, 'age'));
    if (age === 'bad') issues.push({ row_no, code: 'bad_age', detail: cellText(get(r, 'age')) });
    const nationality = clean(get(r, 'nationality'));
    const losRaw = clean(get(r, 'los'));
    const los = losRaw != null && /^\d+$/.test(losRaw) ? Number(losRaw) : null;
    rows.push({
      row_no,
      visit_id: visitIdRaw,
      mrn: clean(get(r, 'mrn')),
      patient_key: null,
      encounter_type: encounter,
      department: clean(get(r, 'department')),
      clinic: clean(get(r, 'clinic')),
      gender: parseGender(get(r, 'gender')),
      age_years: age === 'bad' ? null : age,
      nationality,
      is_saudi: nationality == null ? null : /saudi|سعود/i.test(nationality),
      payor: clean(get(r, 'payor')),
      patient_type: clean(get(r, 'patient_type')),
      visit_at,
      discharge_type: clean(get(r, 'discharge_type')),
      los,
    });
  });

  const times = rows.map((r) => r.visit_at).sort();
  const observed = { first: times[0] ?? null, last: times[times.length - 1] ?? null };
  const rejected = issues.filter((x) => x.code !== 'bad_age').length;
  return {
    headerRowIndex: hr, columns, mapping, declared, rows, issues, observed,
    proposedCoverage: proposeCoverage(declared, observed),
    totals: { dataRows, accepted: rows.length, rejected, duplicatesInFile: dup },
  };
}

/**
 * Coverage = the period the source claims to contain completely.
 * A report run during its last day (e.g. 02-08 10:15 when the header says 02-08 23:59)
 * would otherwise mark a half-day as complete, so that last day is left out and noted.
 */
export function proposeCoverage(
  declared: { start: string | null; endInclusive: string | null },
  observed: { first: string | null; last: string | null },
): ParseResult['proposedCoverage'] {
  const start = declared.start ?? observed.first?.slice(0, 10) ?? null;
  const endIncl = declared.endInclusive ?? observed.last?.slice(0, 10) ?? null;
  if (!start || !endIncl) return null;
  let end_exclusive = addDays(endIncl, 1);
  let note: string | null = declared.start ? null : 'لم يذكر الملف فترته؛ الفترة مقترحة من أول وآخر زيارة.';
  if (observed.last && observed.last.slice(0, 10) === endIncl) {
    const hour = Number(observed.last.slice(11, 13));
    if (hour < 20 && endIncl > start) {
      end_exclusive = endIncl;
      note = `آخر زيارة في ${endIncl} كانت الساعة ${observed.last.slice(11, 16)}؛ يبدو أن التقرير استُخرج أثناء ذلك اليوم، لذلك لم يُعتبر اليوم الأخير مكتملًا.`;
    }
  }
  return { start, end_exclusive, note };
}

/** Parse a CSV text into a grid (RFC 4180 quotes). */
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
