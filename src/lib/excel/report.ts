// Build a new Arabic statistical workbook from one engine result. Numeric cells stay numbers.
import type ExcelJSType from 'exceljs';
import { loadExcel } from './readGrid';
import type { MetricResult } from '../metrics/types';
import { DIMENSIONS, METRICS, sortKeys, valueLabel } from '../metrics/catalog';
import { coverageText, exclusionNotes, filterPhrases, periodText, requestTitle } from '../metrics/describe';
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
  rowDim: string | null;
  colDim: string | null;
  rowKeys: string[];
  colKeys: string[];
  cell: (r: string, c: string) => number;
  rowTotals: boolean;
}

export function toTable(res: MetricResult): ReportTable {
  const g = res.request.group_by;
  if (!g.length) return { rowDim: null, colDim: null, rowKeys: ['__total'], colKeys: ['__value'], cell: () => res.value ?? 0, rowTotals: false };
  if (g.length === 1) {
    const rows = sortKeys(g[0], res.rows.map((r) => r.d1!));
    return { rowDim: g[0], colDim: null, rowKeys: rows, colKeys: ['__value'], cell: (r) => res.rows.find((x) => x.d1 === r)?.value ?? 0, rowTotals: false };
  }
  const rowKeys = sortKeys(g[0], [...new Set(res.rows.map((r) => r.d1!))]);
  const colKeys = sortKeys(g[1], [...new Set(res.rows.map((r) => r.d2!))]);
  return { rowDim: g[0], colDim: g[1], rowKeys, colKeys, cell: (r, c) => res.rows.find((x) => x.d1 === r && x.d2 === c)?.value ?? 0, rowTotals: true };
}

export async function buildReportWorkbook(res: MetricResult, title?: string): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'مساعد الإحصاء';
  wb.created = new Date(res.extracted_at);
  const additive = res.request.metric === 'visits';
  const unit = METRICS[res.request.metric];
  const t = toTable(res);
  const nCols = 1 + t.colKeys.length + (t.rowTotals && additive ? 1 : 0);

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
  put(1, HOSPITAL_NAME, { size: 11, color: { argb: 'FF46615F' } });
  put(2, title?.trim() || requestTitle(res.request), { size: 15, bold: true });
  put(3, `الفترة: ${periodText(res.request)} (من ${res.request.start} حتى ما قبل ${res.request.end_exclusive}، بتوقيت الرياض)`);
  put(4, `وحدة العد: ${unit.label} — ${unit.definition}`);
  put(5, `المرشحات: ${filterPhrases(res.request.filters).join('، ') || 'بلا مرشحات'}`);
  put(6, `${coverageText(res).text}${exclusionNotes(res).length ? ` — ${exclusionNotes(res).join('؛ ')}` : ''}`, { color: { argb: res.coverage.status === 'complete' ? 'FF136A58' : 'FF8A5A06' } });
  ws.getRow(2).height = 26;
  [3, 4, 5, 6].forEach((r) => (ws.getRow(r).height = 30));

  const head = 8;
  const headers = [t.rowDim ? DIMENSIONS[t.rowDim as keyof typeof DIMENSIONS] : 'البيان',
    ...t.colKeys.map((c) => (c === '__value' ? unit.label : valueLabel(t.colDim!, c))),
    ...(t.rowTotals && additive ? ['الإجمالي'] : [])];
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
    label.value = rk === '__total' ? 'الإجمالي' : safeText(valueLabel(t.rowDim!, rk));
    label.font = { name: FONT, color: { argb: INK } };
    label.alignment = { horizontal: 'right', readingOrder: 'rtl' };
    label.border = border;
    t.colKeys.forEach((ck, j) => {
      const c = ws.getCell(r, 2 + j);
      c.value = t.cell(rk, ck);
      c.numFmt = '#,##0';
      c.font = { name: FONT, color: { argb: INK } };
      c.alignment = { horizontal: 'center' };
      c.border = border;
    });
    if (t.rowTotals && additive) {
      const c = ws.getCell(r, 2 + t.colKeys.length);
      const from = ws.getCell(r, 2).address, to = ws.getCell(r, 1 + t.colKeys.length).address;
      c.value = { formula: `SUM(${from}:${to})`, result: t.colKeys.reduce((a, ck) => a + t.cell(rk, ck), 0) };
      c.numFmt = '#,##0';
      c.font = { name: FONT, bold: true, color: { argb: INK } };
      c.alignment = { horizontal: 'center' };
      c.border = border;
    }
    if (i % 2 === 1) for (let k = 1; k <= nCols; k++) ws.getCell(r, k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
  });

  let after = head + 1 + t.rowKeys.length;
  if (t.rowDim) {
    const tr = after;
    const lc = ws.getCell(tr, 1);
    lc.value = additive ? 'الإجمالي' : 'الإجمالي (مرضى مختلفون، لا يساوي مجموع الفئات)';
    lc.font = { name: FONT, bold: true };
    lc.alignment = { horizontal: 'right', readingOrder: 'rtl', wrapText: true };
    const cols = t.colKeys.length + (t.rowTotals && additive ? 1 : 0);
    for (let j = 0; j < cols; j++) {
      const c = ws.getCell(tr, 2 + j);
      if (additive) {
        const from = ws.getCell(head + 1, 2 + j).address, to = ws.getCell(tr - 1, 2 + j).address;
        const sum = j < t.colKeys.length ? t.rowKeys.reduce((a, rk) => a + t.cell(rk, t.colKeys[j]), 0) : (res.value ?? 0);
        c.value = { formula: `SUM(${from}:${to})`, result: sum };
      } else {
        c.value = j === 0 && t.colKeys.length === 1 ? res.value ?? 0 : null;
      }
      c.numFmt = '#,##0';
      c.font = { name: FONT, bold: true };
      c.alignment = { horizontal: 'center' };
      c.border = { top: { style: 'medium', color: { argb: ACCENT } } };
    }
    lc.border = { top: { style: 'medium', color: { argb: ACCENT } } };
    after = tr + 1;
  }

  const foot = after + 1;
  put(foot, `المصدر: ${res.sources.map((s) => s.file_name).join('، ') || '—'} — إصدار البيانات ${res.dataset_version}، تعريف المؤشر ${res.definition_version}`, { size: 9, color: { argb: 'FF46615F' } });
  put(foot + 1, `تاريخ الاستخراج: ${formatInstant(res.extracted_at)}`, { size: 9, color: { argb: 'FF46615F' } });
  if (res.demo) put(foot + 2, 'تنبيه: بيانات تجريبية مولّدة للعرض، ليست أرقام المستشفى.', { size: 10, bold: true, color: { argb: 'FFA32F3A' } });

  ws.getColumn(1).width = 34;
  for (let j = 2; j <= nCols; j++) ws.getColumn(j).width = 14;
  ws.pageSetup.printArea = `A1:${ws.getCell(foot + 2, lastCol).address}`;

  const m = wb.addWorksheet('المنهجية', { views: [{ rightToLeft: true }] });
  const lines: [string, string][] = [
    ['المؤشر', unit.label],
    ['التعريف', unit.definition],
    ['حدود الفترة', 'بداية اليوم الأول حتى ما قبل بداية اليوم التالي لآخر يوم، بتوقيت الرياض (UTC+3).'],
    ['العمر', 'العمر بالسنوات وقت الزيارة كما ورد في المصدر. «18 فأكثر» تشمل من عمره 18 سنة.'],
    ['القيم المفقودة', 'السجل بلا قيمة للحقل المرشَّح يُستبعد ويُذكر عدده، ولا يُعامل كصفر.'],
    ['التغطية', `${res.coverage.covered_days} يومًا مغطى من ${res.coverage.total_days}`],
    ['البيانات الشخصية', 'لا يتضمن التقرير أسماء أو أرقام هوية أو ملفات.'],
  ];
  lines.forEach(([k, v], i) => {
    const a = m.getCell(i + 1, 1); a.value = k; a.font = { name: FONT, bold: true };
    const b = m.getCell(i + 1, 2); b.value = safeText(v); b.font = { name: FONT }; b.alignment = { wrapText: true, readingOrder: 'rtl', horizontal: 'right' };
  });
  m.getColumn(1).width = 18;
  m.getColumn(2).width = 80;

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export function downloadBuffer(buf: ArrayBuffer, name: string) {
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
