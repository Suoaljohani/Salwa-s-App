import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { buildReportWorkbook } from '../src/lib/excel/report';
import { fillTemplate, proposeMappings, scanTemplate } from '../src/lib/excel/template';
import { readWorkbookGrids } from '../src/lib/excel/readGrid';
import { localCatalogInfo, runLocalQuery } from '../src/lib/metrics/localEngine';
import { inferColumns, parseAgeYears, parseTable, proposeCoverage } from '../src/lib/import/table';
import type { Catalog } from '../src/lib/metrics/types';
import { batchA, staffDs, visitsDs } from './fixtures/datasets';

const V = visitsDs(batchA, [{ start: '2026-07-01', end_exclusive: '2026-08-01' }]);
const cat: Catalog = { version: 1, datasets: [localCatalogInfo(V), localCatalogInfo(staffDs)] };
const toAB = (b: unknown) => { const u = b as Uint8Array; return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer; };
async function load(buf: ArrayBuffer) { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb; }

describe('new report workbook', () => {
  test('numbers stay numeric, totals match the engine, RTL, identifiers never printed', async () => {
    const res = runLocalQuery(staffDs, { dataset_id: 's', measure: { op: 'count' }, filters: [], group_by: [{ column: 'cat' }, { column: 'gender' }] });
    const wb = await load(toAB(await buildReportWorkbook(res, cat.datasets[1], 'توزيع الموظفين')));
    const ws = wb.getWorksheet('التقرير')!;
    expect(ws.views[0].rightToLeft).toBe(true);
    let grand = 0;
    ws.eachRow((row) => { if (row.getCell(1).value === 'الإجمالي') row.eachCell((c) => { const v = c.value as ExcelJS.CellFormulaValue; if (v && typeof v === 'object' && 'result' in v) grand = Number(v.result); }); });
    expect(grand).toBe(res.value);
    expect(JSON.stringify(ws.getSheetValues())).not.toMatch(/E1|E2|P1/);
  });
});

async function makeTemplate(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('نموذج');
  ws.mergeCells('A1:D1');
  ws.getCell('A1').value = 'نموذج إحصائي شهري';
  ws.getCell('A3').value = 'البيان'; ws.getCell('B3').value = 'ذكور'; ws.getCell('C3').value = 'إناث'; ws.getCell('D3').value = 'المجموع';
  ws.getCell('A4').value = 'زيارات الطوارئ'; ws.getCell('A5').value = 'زيارات العيادات الخارجية';
  ws.getCell('D4').value = { formula: 'B4+C4' }; ws.getCell('D5').value = { formula: 'B5+C5' };
  ws.getCell('A7').value = 'ملاحظة ثابتة';
  ws.getCell('B4').numFmt = '#,##0';
  ws.pageSetup.orientation = 'landscape';
  return toAB(await wb.xlsx.writeBuffer());
}

describe('template filling', () => {
  test('targets exclude formulas and unrelated rows; copy filled; untouched cells verified', async () => {
    const tpl = await makeTemplate();
    const { scan } = await scanTemplate(tpl);
    expect(scan.targets.map((t) => t.address).sort()).toEqual(['B4', 'B5', 'C4', 'C5']);
    const maps = proposeMappings(scan.targets, cat, 'v', { start: '2026-07-01', end_exclusive: '2026-08-01' });
    const b4 = maps.find((m) => m.target.address === 'B4')!;
    expect(b4.request?.filters).toEqual(expect.arrayContaining([{ column: 'enc', op: 'eq', value: 'Emergency' }, { column: 'gender', op: 'eq', value: 'Male' }]));
    const values = maps.map((m) => ({ sheet: m.target.sheet, address: m.target.address, value: runLocalQuery(V, m.request!).value! }));
    const out = await fillTemplate(tpl, values);
    expect(out.verification.ok).toBe(true);
    const ws = (await load(out.buffer)).getWorksheet('نموذج')!;
    expect(ws.getCell('B4').value).toBe(5);
    expect(ws.getCell('C4').value).toBe(1);
    expect((ws.getCell('D4').value as ExcelJS.CellFormulaValue).formula).toBe('B4+C4');
    expect(ws.getCell('A7').value).toBe('ملاحظة ثابتة');
    expect(ws.getCell('B4').numFmt).toBe('#,##0');
    expect(ws.pageSetup.orientation).toBe('landscape');
  });
});

describe('generic import', () => {
  test('roles: personal columns ignored, identifiers hashed later, types inferred', () => {
    const headers = ['م', 'Employee ID', 'Name', 'National ID', 'Job Title', 'Gender', 'Hire Date', 'Salary', 'Mobile'];
    const body = Array.from({ length: 40 }, (_, i) => [i + 1, `E${i}`, `Person ${i}`, `10${i}88776655`, i % 3 ? 'Nurse' : 'Doctor', i % 2 ? 'Male' : 'Female', `0${(i % 9) + 1}-03-2020`, 5000 + i, `05${i}1234567`]);
    const cols = inferColumns(headers, body);
    const role = (h: string) => cols.find((c) => c.source_header === h)!.role;
    expect(role('م')).toBe('ignore');
    expect(role('Name')).toBe('ignore');
    expect(role('National ID')).toBe('ignore');
    expect(role('Mobile')).toBe('ignore');
    expect(role('Employee ID')).toBe('identifier');
    expect(role('Job Title')).toBe('dimension');
    expect(cols.find((c) => c.source_header === 'Hire Date')!.type).toBe('date');
    expect(cols.find((c) => c.source_header === 'Salary')!).toMatchObject({ type: 'number', role: 'measure' });
    const t = parseTable([headers, ...body]);
    expect(JSON.stringify(t.rows)).not.toMatch(/Person|887766|1234567/);
  });
  test('numbered report: wrapped-text lines and a trailing summary table are not records', () => {
    const headers = ['S no', 'Visit Date', 'MRN', 'Department', 'CTAS Level', 'Complaint', 'Doctor'];
    const rec = (i: number) => [i, `0${(i % 9) + 1}-01-2025 10:00`, `M${i}`, 'Emergency', 'V-Non Urgent', 'Cough and fever', 'DR A'];
    const grid = [
      ['ER Patient Journey Report'], headers,
      ...Array.from({ length: 30 }, (_, i) => rec(i + 1)),
      [null, null, null, 'Government', null, 'continued text', 'SALEH'],
      ['ER Patient Journey Report'], headers,
      ...Array.from({ length: 30 }, (_, i) => rec(i + 31)),
      [null, 'L1', 'L2', 'L3', 'L4', 'L5', 'LWBS'],
      [null, '01-01-2025', 0, 1, 5, 9, 0],
    ];
    const t = parseTable(grid);
    expect(t.rows.length).toBe(60);
  });
  test('age text and coverage cut on the last day', () => {
    expect(parseAgeYears('21 Y 2 M 18 D')).toBe(21);
    expect(parseAgeYears('64 Y ')).toBe(64);
    expect(proposeCoverage({ start: '2026-07-01', endInclusive: '2026-08-02' }, { first: '2026-07-01T00:40:00+03:00', last: '2026-08-02T10:15:00+03:00' })).toMatchObject({ end_exclusive: '2026-08-02' });
  });
});

// Real hospital file: only runs where the private sample exists locally (never committed).
const SAMPLE = process.env.SALWA_SAMPLE ?? '';
describe.skipIf(!SAMPLE || !existsSync(SAMPLE))('real visit report (local only)', () => {
  test('preset recognised and July 2026 counts match the independent reference', async () => {
    const b = readFileSync(SAMPLE);
    const g = await readWorkbookGrids(toAB(b));
    const t = parseTable(g.sheets[0].grid);
    expect(t.preset?.id).toBe('visit_report');
    expect(t.rows.length).toBe(1201);
    expect(JSON.stringify(t.rows)).not.toMatch(/BANDAR|بندر|1129454664|0530003340/);
    const col = (h: string) => t.columns.find((c) => c.source_header?.toLowerCase() === h)!.key;
    const info = { id: 'r', name: 'r', unit_label: 'زيارة', mode: 'append' as const, period_column: col('actual visit start date & time'), key_column: col('visit id'), version: 1, row_count: 0, coverage: [],
      columns: t.columns.map(({ key, label, type, role, source_header }) => ({ key, label, type, role, source_header })) };
    const ds = { info, rows: t.rows.map((r) => r.data), windows: [{ id: 'w', file_name: 'f', start: '2026-07-01', end_exclusive: '2026-08-02' }], demo: false };
    const P = { start: '2026-07-01', end_exclusive: '2026-08-01' };
    const run = (r: object) => runLocalQuery(ds, { dataset_id: 'r', measure: { op: 'count' }, filters: [], group_by: [], period: P, ...r }).value;
    expect(run({})).toBe(1139);
    expect(run({ filters: [{ column: col('encounter'), op: 'eq', value: 'Emergency' }, { column: col('age'), op: 'gte', value: 18 }] })).toBe(558);
    expect(run({ measure: { op: 'count_distinct', column: col('mrn') }, filters: [{ column: col('encounter'), op: 'eq', value: 'Emergency' }] })).toBe(765);
    expect(run({ period: { start: '2026-06-01', end_exclusive: '2026-07-01' } })).toBeNull();
  });
});
