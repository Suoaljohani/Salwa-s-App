// Received-template filling: inspect, propose target cells, compute with the shared engine,
// write numbers into a copy, then re-open the copy and verify nothing else changed.
import type ExcelJSType from 'exceljs';
import { cellValue, loadExcel } from './readGrid';
import { listZipParts, scanFeatures, unsupportedFeatures, type FeatureScan } from './zipParts';
import { parseQuestion } from '../nlu/ruleParser';
import type { Catalog, StatRequest } from '../metrics/types';
import { sha256Hex } from '../hash';

export interface TargetCell {
  sheet: string;
  address: string;
  row: number;
  col: number;
  rowLabel: string;
  colLabel: string;
  /** current content type */
  existing: 'empty' | 'number';
}

export type CellStatus = 'mapped' | 'needs_review' | 'unavailable' | 'skipped';

export interface CellMapping {
  target: TargetCell;
  status: CellStatus;
  request: StatRequest | null;
  note?: string;
}

export interface TemplateScan {
  sheets: { name: string; rows: number; cols: number; formulas: number; merged: number }[];
  features: FeatureScan;
  unsupported: string[];
  targets: TargetCell[];
  formulaCells: number;
  structureHash: string;
}

const isText = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && !/^[\d\s.,٪%-]+$/.test(v);

function textOf(ws: ExcelJSType.Worksheet, r: number, c: number): string {
  const cell = ws.getCell(r, c);
  const master = cell.isMerged ? cell.master : cell;
  const v = cellValue(master.value);
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}

function rowHasContent(ws: ExcelJSType.Worksheet, r: number, maxC: number): boolean {
  for (let k = 1; k <= maxC; k++) {
    const v = cellValue(ws.getCell(r, k).value);
    if (v != null && String(v).trim() !== '') return true;
  }
  return false;
}

/**
 * A target is an empty (or plain-number, non-formula) cell that has a text label in its row
 * and a text header above it in its column, inside the used range. Formula cells are never targets.
 */
export function findTargets(ws: ExcelJSType.Worksheet): TargetCell[] {
  const out: TargetCell[] = [];
  const maxR = Math.min(ws.rowCount, 400), maxC = Math.min(ws.columnCount, 40);
  for (let r = 2; r <= maxR; r++) {
    for (let c = 1; c <= maxC; c++) {
      const cell = ws.getCell(r, c);
      if (cell.isMerged && cell.master.address !== cell.address) continue;
      if (cell.formula || (cell.value && typeof cell.value === 'object' && 'formula' in (cell.value as object))) continue;
      const v = cell.value;
      const existing = v == null || v === '' ? 'empty' : typeof v === 'number' ? 'number' : null;
      if (!existing) continue;
      let rowLabel = '';
      for (let k = 1; k <= maxC && !rowLabel; k++) if (k !== c && isText(textOf(ws, r, k))) rowLabel = textOf(ws, r, k);
      // Walk up to the column header without crossing a blank row: the cell must belong to one table block.
      let colLabel = '';
      for (let k = r - 1; k >= 1 && !colLabel; k--) {
        const t = textOf(ws, k, c);
        if (isText(t)) { colLabel = t; break; }
        if (!rowHasContent(ws, k, maxC)) break;
      }
      if (rowLabel && colLabel && rowLabel !== colLabel) out.push({ sheet: ws.name, address: cell.address, row: r, col: c, rowLabel, colLabel, existing });
    }
  }
  return out;
}

export async function scanTemplate(buf: ArrayBuffer): Promise<{ scan: TemplateScan; wb: ExcelJSType.Workbook }> {
  const features = scanFeatures(listZipParts(buf));
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  let formulaCells = 0;
  const sheets: TemplateScan['sheets'] = [];
  const targets: TargetCell[] = [];
  const shape: string[] = [];
  wb.eachSheet((ws) => {
    let formulas = 0;
    ws.eachRow((row) => row.eachCell((cell) => {
      if (cell.formula) formulas++;
      const t = textOf(ws, Number(cell.row), Number(cell.col));
      if (t) shape.push(`${ws.name}!${cell.address}=${t}`);
    }));
    formulaCells += formulas;
    sheets.push({ name: ws.name, rows: ws.rowCount, cols: ws.columnCount, formulas, merged: Object.keys((ws as unknown as { _merges: object })._merges ?? {}).length });
    targets.push(...findTargets(ws));
  });
  const structureHash = await sha256Hex(new TextEncoder().encode(shape.join('\n')).buffer as ArrayBuffer);
  return { scan: { sheets, features, unsupported: unsupportedFeatures(features), targets, formulaCells, structureHash }, wb };
}

/**
 * Propose a request for each cell from its row and column labels (local rule parser over the catalog).
 * The chosen dataset and period are applied to every proposal; Salwa confirms each one.
 */
export function proposeMappings(targets: TargetCell[], catalog: Catalog, datasetId: string, period: { start: string; end_exclusive: string } | null): CellMapping[] {
  const scoped: Catalog = { ...catalog, datasets: catalog.datasets.filter((d) => d.id === datasetId) };
  const ds = scoped.datasets[0];
  return targets.map((t) => {
    const phrase = `${t.rowLabel} ${t.colLabel}`;
    const out = parseQuestion(phrase, scoped);
    if (out.kind === 'unsupported') return { target: t, status: 'unavailable', request: null, note: out.reason };
    if (out.kind === 'clarify' || out.requests.length !== 1) return { target: t, status: 'needs_review', request: null, note: 'لم يُفهم معنى الخانة من عناوينها' };
    const req: StatRequest = { ...out.requests[0], group_by: [], period: ds?.period_column ? period : null };
    const understood = req.filters.length > 0 || req.measure.op !== 'count' || /عدد|إجمالي|اجمالي|total|مجموع/i.test(phrase);
    return { target: t, status: 'needs_review', request: understood ? req : null, note: understood ? undefined : 'العناوين لا تحدد مؤشرًا واضحًا' };
  });
}

export interface FillResult {
  buffer: ArrayBuffer;
  written: { address: string; sheet: string; value: number }[];
  verification: { ok: boolean; checks: { label: string; ok: boolean; detail?: string }[] };
}

function snapshot(wb: ExcelJSType.Workbook) {
  const m = new Map<string, string>();
  wb.eachSheet((ws) => ws.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (c) => {
    const v = c.value as unknown;
    const key = `${ws.name}!${c.address}`;
    if (v && typeof v === 'object' && 'formula' in (v as object)) m.set(key, `f:${(v as { formula: string }).formula}`);
    else if (v && typeof v === 'object' && 'sharedFormula' in (v as object)) m.set(key, `sf:${(v as { sharedFormula: string }).sharedFormula}`);
    else m.set(key, `v:${JSON.stringify(cellValue(v as ExcelJSType.CellValue))}|s:${c.numFmt ?? ''}`);
  })));
  return m;
}

export async function fillTemplate(original: ArrayBuffer, values: { sheet: string; address: string; value: number }[]): Promise<FillResult> {
  const ExcelJS = await loadExcel();
  const before = new ExcelJS.Workbook();
  await before.xlsx.load(original.slice(0));
  const snapBefore = snapshot(before);
  const merges = new Map<string, number>();
  before.eachSheet((ws) => merges.set(ws.name, Object.keys((ws as unknown as { _merges: object })._merges ?? {}).length));
  const print = new Map<string, string>();
  before.eachSheet((ws) => print.set(ws.name, JSON.stringify({ o: ws.pageSetup.orientation, a: ws.pageSetup.printArea ?? null, f: ws.pageSetup.fitToPage ?? null })));

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(original.slice(0));
  const written: FillResult['written'] = [];
  for (const v of values) {
    const ws = wb.getWorksheet(v.sheet);
    if (!ws) continue;
    const cell = ws.getCell(v.address);
    if (cell.formula) continue; // never overwrite a formula
    cell.value = v.value;
    written.push(v);
  }
  // Formulas are recalculated by Excel when the file opens; cached results are not trusted.
  (wb as unknown as { calcProperties: Record<string, unknown> }).calcProperties = { fullCalcOnLoad: true };
  const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;

  // Verify by re-opening the produced file.
  const after = new ExcelJS.Workbook();
  await after.xlsx.load(buffer.slice(0));
  const snapAfter = snapshot(after);
  const targets = new Set(written.map((w) => `${w.sheet}!${w.address}`));
  const changed: string[] = [];
  for (const [k, v] of snapBefore) if (!targets.has(k) && snapAfter.get(k) !== v) changed.push(k);
  for (const k of snapAfter.keys()) if (!targets.has(k) && !snapBefore.has(k)) changed.push(k);
  const wrongTargets = written.filter((w) => {
    const c = after.getWorksheet(w.sheet)?.getCell(w.address);
    return !c || c.value !== w.value;
  });
  const sheetsSame = before.worksheets.map((s) => s.name).join('|') === after.worksheets.map((s) => s.name).join('|');
  let mergesSame = true, printSame = true;
  after.eachSheet((ws) => {
    if (merges.get(ws.name) !== Object.keys((ws as unknown as { _merges: object })._merges ?? {}).length) mergesSame = false;
    if (print.get(ws.name) !== JSON.stringify({ o: ws.pageSetup.orientation, a: ws.pageSetup.printArea ?? null, f: ws.pageSetup.fitToPage ?? null })) printSame = false;
  });
  const checks = [
    { label: 'الخلايا غير المستهدفة والصيغ لم تتغير', ok: changed.length === 0, detail: changed.slice(0, 5).join('، ') },
    { label: 'كل خانة مستهدفة تحتوي الرقم المحسوب', ok: wrongTargets.length === 0 },
    { label: 'الأوراق وترتيبها كما هي', ok: sheetsSame },
    { label: 'الخلايا المدمجة كما هي', ok: mergesSame },
    { label: 'إعدادات الطباعة كما هي', ok: printSame },
  ];
  return { buffer, written, verification: { ok: checks.every((c) => c.ok), checks } };
}
