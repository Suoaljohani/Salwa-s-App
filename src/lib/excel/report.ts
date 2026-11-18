// Build a new Arabic statistical workbook from one engine result. Numeric cells stay numbers.
import type ExcelJSType from 'exceljs';
import { loadExcel } from './readGrid';
import type { DatasetInfo, StatResult } from '../metrics/types';
import { MEASURE_LABEL, colOf, keyLabel, sortKeys } from '../metrics/catalog';
import { coverageText, exclusionNotes, filterPhrase, measurePhrase, periodText, requestTitle } from '../metrics/describe';
import { formatInstant } from '../dates';
import { HOSPITAL_NAME } from '../config';

const FONT = 'Arial';
const INK = 'FF10292D';
const ACCENT = 'FF136A58';
const BAND = 'FFF1F5F4';
const LINE = 'FFD5DEDC';

/**
 * Labels are written as typed string cells (t="s"), which spreadsheets never evaluate,
 * so text such as "=SUM(...)" or "-5" coming from a source file cannot become a formula.
 * Control characters are removed.
 */
export function safeText(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

export interface ReportTable {
  rowHead: string;
  colHead: string | null;
  rowKeys: string[];
  colKeys: string[];
  rowLabel: (k: string) => string;
  colLabel: (k: string) => string;
  cell: (r: string, c: string) => number | null;
}

export function toTable(res: StatResult, ds: DatasetInfo | undefined): ReportTable {
  const g = res.request.group_by;
  const valueHead = res.request.measure.op === 'count' ? res.dataset.unit_label : MEASURE_LABEL[res.request.measure.op];
  const missing = res.request.measure.op === 'count' || res.request.measure.op === 'count_distinct' || res.request.measure.op === 'sum' ? 0 : null;
  if (!g.length) return { rowHead: 'البيان', colHead: null, rowKeys: ['__total'], colKeys: ['__value'], rowLabel: () => 'الإجمالي', colLabel: () => valueHead, cell: () => res.value };
  const c1 = colOf(ds, g[0].column);
  const rowKeys = sortKeys(c1, g[0], [...new Set(res.rows.map((r) => r.d1!))]);
  if (g.length === 1) {
    return { rowHead: c1?.label ?? '', colHead: null, rowKeys, colKeys: ['__value'], rowLabel: (k) => keyLabel(c1, g[0], k), colLabel: () => valueHead,
      cell: (r) => res.rows.find((x) => x.d1 === r)?.value ?? missing };
  }
  const c2 = colOf(ds, g[1].column);
  const colKeys = sortKeys(c2, g[1], [...new Set(res.rows.map((r) => r.d2!))]);
  return { rowHead: c1?.label ?? '', colHead: c2?.label ?? '', rowKeys, colKeys, rowLabel: (k) => keyLabel(c1, g[0], k), colLabel: (k) => keyLabel(c2, g[1], k),
    cell: (r, c) => res.rows.find((x) => x.d1 === r && x.d2 === c)?.value ?? missing };
}

export async function buildReportWorkbook(res: StatResult, ds: DatasetInfo | undefined, title?: string): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'مساعد الإحصاء';
  wb.created = new Date(res.extracted_at);
  const additive = res.request.measure.op === 'count' || res.request.measure.op === 'sum';
  const t = toTable(res, ds);
  const rowTotals = additive && t.colKeys.length > 1;
  const nCols = 1 + t.colKeys.length + (rowTotals ? 1 : 0);
  const numFmt = res.request.measure.op === 'avg' ? '#,##0.0' : '#,##0.##';

  const ws = wb.addWorksheet('التقرير', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 8 }],
    pageSetup: { orientation: nCols > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
    headerFooter: { oddFooter: '&Lصفحة &P من &N&R' + HOSPITAL_NAME },
  });
  const lastCol = Math.max(nCols, 3);
  const put = (row: number, text: string, opts: Partial<ExcelJSType.Font> = {}) => {
    ws.mergeCells(row, 1, row, lastCol);
    const c = ws.getCell(row, 1);
    c.value = safeText(text);
    c.font = { name: FONT, size: 11, color: { argb: INK }, ...opts };
    c.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
  };
  put(1, `${HOSPITAL_NAME} — ${res.dataset.name}`, { size: 11, color: { argb: 'FF46615F' } });
  put(2, title?.trim() || requestTitle(ds, res.request), { size: 15, bold: true });
  put(3, `الفترة: ${periodText(res)}${res.request.period ? ` (من ${res.request.period.start} حتى ما قبل ${res.request.period.end_exclusive}، بتوقيت الرياض)` : ''}`);
  put(4, `الحساب: ${measurePhrase(ds, res.request)} — كل سجل = ${res.dataset.unit_label}`);
  put(5, `المرشحات: ${res.request.filters.map((f) => filterPhrase(ds, f)).join('، ') || 'بلا مرشحات'}`);
  put(6, `${coverageText(res).text}${exclusionNotes(res).length ? ` — ${exclusionNotes(res).join('؛ ')}` : ''}`, { color: { argb: res.coverage?.status === 'partial' ? 'FF8A5A06' : 'FF136A58' } });
  ws.getRow(2).height = 26;
  [3, 4, 5, 6].forEach((r) => (ws.getRow(r).height = 30));

  const head = 8;
  const headers = [t.rowHead || 'البيان', ...t.colKeys.map((c) => t.colLabel(c)), ...(rowTotals ? ['الإجمالي'] : [])];
  headers.forEach((h, i) => {
    const c = ws.getCell(head, i + 1);
    c.value = safeText(h);
    c.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } };
    c.alignment = { horizontal: i === 0 ? 'right' : 'center', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
  });
  ws.getRow(head).height = 28;

  const border: Partial<ExcelJSType.Borders> = { bottom: { style: 'thin', color: { argb: LINE } } };
  t.rowKeys.forEach((rk, i) => {
    const r = head + 1 + i;
    const label = ws.getCell(r, 1);
    label.value = safeText(t.rowLabel(rk));
    label.font = { name: FONT, color: { argb: INK } };
    label.alignment = { horizontal: 'right', readingOrder: 'rtl' };
    label.border = border;
    t.colKeys.forEach((ck, j) => {
      const c = ws.getCell(r, 2 + j);
      c.value = t.cell(rk, ck);
      c.numFmt = numFmt;
      c.font = { name: FONT, color: { argb: INK } };
      c.alignment = { horizontal: 'center' };
      c.border = border;
    });
    if (rowTotals) {
      const c = ws.getCell(r, 2 + t.colKeys.length);
      c.value = { formula: `SUM(${ws.getCell(r, 2).address}:${ws.getCell(r, 1 + t.colKeys.length).address})`, result: t.colKeys.reduce((a, ck) => a + (t.cell(rk, ck) ?? 0), 0) };
      c.numFmt = numFmt;
      c.font = { name: FONT, bold: true, color: { argb: INK } };
      c.alignment = { horizontal: 'center' };
      c.border = border;
    }
    if (i % 2 === 1) for (let k = 1; k <= nCols; k++) ws.getCell(r, k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
  });

  let after = head + 1 + t.rowKeys.length;
  if (res.request.group_by.length) {
    const tr = after;
    const lc = ws.getCell(tr, 1);
    lc.value = additive ? 'الإجمالي' : res.request.measure.op === 'count_distinct' ? 'الإجمالي (بدون تكرار، لا يساوي مجموع الفئات)' : 'القيمة الإجمالية';
    lc.font = { name: FONT, bold: true };
    lc.alignment = { horizontal: 'right', readingOrder: 'rtl', wrapText: true };
    lc.border = { top: { style: 'medium', color: { argb: ACCENT } } };
    const cols = t.colKeys.length + (rowTotals ? 1 : 0);
    for (let j = 0; j < cols; j++) {
      const c = ws.getCell(tr, 2 + j);
      if (additive) {
        const sum = j < t.colKeys.length ? t.rowKeys.reduce((a, rk) => a + (t.cell(rk, t.colKeys[j]) ?? 0), 0) : (res.value ?? 0);
        c.value = { formula: `SUM(${ws.getCell(head + 1, 2 + j).address}:${ws.getCell(tr - 1, 2 + j).address})`, result: sum };
      } else c.value = j === 0 && t.colKeys.length === 1 ? res.value : null;
      c.numFmt = numFmt;
      c.font = { name: FONT, bold: true };
      c.alignment = { horizontal: 'center' };
      c.border = { top: { style: 'medium', color: { argb: ACCENT } } };
    }
    after = tr + 1;
  }

  const foot = after + 1;
  put(foot, `المصدر: ${res.sources.map((s) => s.file_name).join('، ') || '—'} — إصدار البيانات ${res.dataset_version}`, { size: 9, color: { argb: 'FF46615F' } });
  put(foot + 1, `تاريخ الاستخراج: ${formatInstant(res.extracted_at)}`, { size: 9, color: { argb: 'FF46615F' } });
  if (res.demo) put(foot + 2, 'تنبيه: بيانات تجريبية مولّدة للعرض، ليست أرقام المستشفى.', { size: 10, bold: true, color: { argb: 'FFA32F3A' } });
  ws.getColumn(1).width = 34;
  for (let j = 2; j <= nCols; j++) ws.getColumn(j).width = 14;
  ws.pageSetup.printArea = `A1:${ws.getCell(foot + 2, lastCol).address}`;

  const m = wb.addWorksheet('المنهجية', { views: [{ rightToLeft: true }] });
  const lines: [string, string][] = [
    ['قاعدة البيانات', `${res.dataset.name} — كل سجل = ${res.dataset.unit_label}`],
    ['الحساب', measurePhrase(ds, res.request)],
    ['حدود الفترة', res.request.period ? 'بداية اليوم الأول حتى ما قبل بداية اليوم التالي لآخر يوم، بتوقيت الرياض (UTC+3).' : periodText(res)],
    ['القيم المفقودة', 'السجل بلا قيمة للحقل المرشَّح أو المحسوب يُستبعد ويُذكر عدده، ولا يُعامل كصفر.'],
    ['التغطية', res.coverage ? `${res.coverage.covered_days} يومًا مغطى من ${res.coverage.total_days}` : coverageText(res).text],
    ['البيانات الشخصية', 'لا يتضمن التقرير أسماء أو أرقام هوية؛ المعرّفات مشفّرة ولا تظهر.'],
  ];
  lines.forEach(([k, v], i) => {
    const a = m.getCell(i + 1, 1); a.value = k; a.font = { name: FONT, bold: true };
    const b = m.getCell(i + 1, 2); b.value = safeText(v); b.font = { name: FONT }; b.alignment = { wrapText: true, readingOrder: 'rtl', horizontal: 'right' };
  });
  m.getColumn(1).width = 18;
  m.getColumn(2).width = 80;
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function downloadBuffer(buf: ArrayBuffer, name: string) {
  const { saveFile } = await import('../native');
  return saveFile(buf, name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
