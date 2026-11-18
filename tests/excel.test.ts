import { describe, expect, test } from 'vitest';
import ExcelJS from 'exceljs';
import { buildReportWorkbook } from '../src/lib/excel/report';
import { fillTemplate, proposeMappings, scanTemplate } from '../src/lib/excel/template';
import { runLocalQuery } from '../src/lib/metrics/localEngine';
import { parseAgeYears, parseVisitGrid, proposeCoverage } from '../src/lib/import/visitReport';
import { batchA, windows } from './fixtures/edgeCases';

const ds = { rows: batchA, windows: [{ ...windows.A, id: 'a', file_name: 'A.xlsx' }], datasetVersion: 3, demo: false };

async function load(buf: ArrayBuffer) { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb; }

describe('new report workbook', () => {
  test('numeric cells, consistent totals, RTL, no personal data', async () => {
    const res = runLocalQuery(ds, { metric: 'visits', start: '2026-07-01', end_exclusive: '2026-08-01', filters: {}, group_by: ['encounter_type', 'gender'] });
    const wb = await load(await buildReportWorkbook(res, 'اختبار'));
    const ws = wb.getWorksheet('التقرير')!;
    expect(ws.views[0].rightToLeft).toBe(true);
    const nums: number[] = [];
    let totalCell: ExcelJS.CellFormulaValue | null = null;
    ws.eachRow((row) => row.eachCell((c) => {
      if (typeof c.value === 'number') nums.push(c.value);
      if (c.value && typeof c.value === 'object' && 'formula' in c.value && row.getCell(1).value === 'الإجمالي') totalCell = c.value as ExcelJS.CellFormulaValue;
    }));
    expect(nums.length).toBeGreaterThan(0);
    expect(totalCell).not.toBeNull();
    // Last formula in the totals row is the grand total and its cached result equals the engine total.
    let grand = 0;
    ws.eachRow((row) => { if (row.getCell(1).value === 'الإجمالي') row.eachCell((c) => { const v = c.value as ExcelJS.CellFormulaValue; if (v && typeof v === 'object' && 'result' in v) grand = Number(v.result); }); });
    expect(grand).toBe(res.value);
    const text = JSON.stringify(ws.getSheetValues());
    expect(text).not.toMatch(/P1|P2|MRN/);
  });
});

async function makeTemplate(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('نموذج');
  ws.mergeCells('A1:D1');
  ws.getCell('A1').value = 'نموذج إحصائي شهري';
  ws.getCell('A3').value = 'البيان';
  ws.getCell('B3').value = 'ذكور';
  ws.getCell('C3').value = 'إناث';
  ws.getCell('D3').value = 'المجموع';
  ws.getCell('A4').value = 'زيارات الطوارئ';
  ws.getCell('A5').value = 'زيارات العيادات';
  ws.getCell('D4').value = { formula: 'B4+C4' };
  ws.getCell('D5').value = { formula: 'B5+C5' };
  ws.getCell('A7').value = 'ملاحظة ثابتة';
  ws.getCell('B4').numFmt = '#,##0';
  ws.pageSetup.orientation = 'landscape';
  const b = (await wb.xlsx.writeBuffer()) as unknown as Uint8Array; // Node returns a Buffer
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

describe('template filling', () => {
  test('finds targets, never formulas; fills a copy; untouched cells verified', async () => {
    const tpl = await makeTemplate();
    const { scan } = await scanTemplate(tpl);
    const addrs = scan.targets.map((t) => t.address).sort();
    expect(addrs).toEqual(['B4', 'B5', 'C4', 'C5']);
    expect(scan.unsupported).toEqual([]);
    const maps = proposeMappings(scan.targets, { start: '2026-07-01', end_exclusive: '2026-08-01', label: 'يوليو 2026' });
    const b4 = maps.find((m) => m.target.address === 'B4')!;
    expect(b4.request).toMatchObject({ metric: 'visits', filters: { encounter_type: ['Emergency'], gender: 'M' } });
    expect(b4.status).toBe('needs_review');

    const values = maps.map((m) => ({ sheet: m.target.sheet, address: m.target.address, value: runLocalQuery(ds, m.request!).value! }));
    const out = await fillTemplate(tpl, values);
    expect(out.verification.ok).toBe(true);
    const wb = await load(out.buffer);
    const ws = wb.getWorksheet('نموذج')!;
    expect(ws.getCell('B4').value).toBe(5); // A1 A2 A3 A5 A9
    expect(ws.getCell('C4').value).toBe(1); // A4 (A6 has no gender)
    expect((ws.getCell('D4').value as ExcelJS.CellFormulaValue).formula).toBe('B4+C4');
    expect(ws.getCell('A7').value).toBe('ملاحظة ثابتة');
    expect(ws.getCell('B4').numFmt).toBe('#,##0');
    expect(ws.pageSetup.orientation).toBe('landscape');
  });
});

describe('import parsing', () => {
  test('age text', () => {
    expect(parseAgeYears('21 Y 2 M 18 D')).toBe(21);
    expect(parseAgeYears('64 Y ')).toBe(64);
    expect(parseAgeYears(null)).toBeNull();
    expect(parseAgeYears('abc')).toBe('bad');
  });
  test('header detection, personal columns ignored, duplicates in file', () => {
    const grid = [
      ['Al-Hadithah Hospital'],
      ['From Date : 01-07-2026 00:00', null, 'To Date : 31-07-2026 23:59'],
      ['S.No', 'Encounter', 'MRN', 'Patient Name', 'National ID', 'Gender', 'Age', 'Actual Visit Start\nDate & Time', 'Visit ID', 'Department'],
      [1, 'Emergency', '100', 'X Y', '123', 'Male', '18 Y 0 M 0 D', '31-07-2026 23:59', 'V1', 'Emergency Medicine'],
      [2, 'Emergency', '100', 'X Y', '123', 'Male', '18 Y 0 M 1 D', '01-07-2026 00:00', 'V2', 'Emergency Medicine'],
      [3, 'Emergency', '101', 'Z', '124', 'Female', '40 Y', '02-07-2026 10:00', 'V2', 'Emergency Medicine'],
    ];
    const r = parseVisitGrid(grid);
    expect(r.totals).toMatchObject({ accepted: 2, duplicatesInFile: 1 });
    expect(r.columns.filter((c) => c.personal).map((c) => c.header)).toEqual(['Patient Name', 'National ID']);
    expect(JSON.stringify(r.rows)).not.toMatch(/X Y|123/);
    expect(r.rows[0].visit_at).toBe('2026-07-31T23:59:00+03:00');
    expect(r.proposedCoverage).toMatchObject({ start: '2026-07-01', end_exclusive: '2026-08-01', note: null });
  });
  test('report cut during its last day does not mark that day complete', () => {
    expect(proposeCoverage({ start: '2026-07-01', endInclusive: '2026-08-02' }, { first: '2026-07-01T00:40:00+03:00', last: '2026-08-02T10:15:00+03:00' }))
      .toMatchObject({ end_exclusive: '2026-08-02' });
  });
});
