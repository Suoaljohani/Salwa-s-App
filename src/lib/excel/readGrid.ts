import type ExcelJSType from 'exceljs';
import type { Cell, Grid } from '../import/table';

export async function loadExcel(): Promise<typeof ExcelJSType> {
  const mod = await import('exceljs');
  return ((mod as unknown as { default?: typeof ExcelJSType }).default ?? mod) as typeof ExcelJSType;
}

export function cellValue(v: ExcelJSType.CellValue): Cell {
  if (v == null) return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    const o = v as unknown as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('');
    if ('result' in o) return (o.result as Cell) ?? null;
    if ('text' in o) return String(o.text);
    if ('error' in o) return null;
    return null;
  }
  return v as Cell;
}

export function worksheetGrid(ws: ExcelJSType.Worksheet): Grid {
  const grid: Grid = [];
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: Cell[] = [];
    // Merged ranges: only the top-left (master) cell carries the value, as in Excel itself.
    row.eachCell({ includeEmpty: true }, (cell, col) => { cells[col - 1] = cell.isMerged && cell.master.address !== cell.address ? null : cellValue(cell.value); });
    grid[rowNumber - 1] = cells;
  });
  for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];
  return grid;
}

export interface WorkbookGrids { sheets: { name: string; grid: Grid }[] }

export async function readWorkbookGrids(buf: ArrayBuffer): Promise<WorkbookGrids> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return { sheets: wb.worksheets.map((ws) => ({ name: ws.name, grid: worksheetGrid(ws) })) };
}
