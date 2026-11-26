// Operator bulk import: parses hospital report exports with the app's own parser and loads them
// through the admin_import edge function (same staging + approval RPCs as the app).
//   npx tsx scripts/bulk-import/run.ts --dry  <files...>
//   npx tsx scripts/bulk-import/run.ts --import --list files.txt   (needs SUPABASE_SECRET or a proxy-injected apikey)
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { readWorkbookGrids } from '../../src/lib/excel/readGrid';
import { cellText, headerSignature, observedRange, parseTable, proposeCoverage, columnKey, type ParsedTable, type Grid } from '../../src/lib/import/table';
import { formatPeriod, addDays } from '../../src/lib/dates';
import { REPORTS, type ReportSpec } from './reports';

const args = process.argv.slice(2);
const mode = args.includes('--import') ? 'import' : 'dry';
const REPLACE = args.includes('--replace');
const listIdx = args.indexOf('--list');
const files = listIdx >= 0 ? readFileSync(args[listIdx + 1], 'utf8').split('\n').map((x) => x.trim()).filter(Boolean) : args.filter((a) => !a.startsWith('--'));
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

// Direct Supabase REST with the project's secret key. The key is never in this file or the repo:
// SUPABASE_SECRET (or a network proxy that injects the apikey header) supplies it.
const BASE = 'https://znwlsbaacdvwhlruqzer.supabase.co';
const H = () => ({ apikey: process.env.SUPABASE_SECRET ?? 'proxy-injected', 'Content-Type': 'application/json' });

async function http(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(BASE + path, { method, headers: { ...H(), ...headers }, body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body) });
      const text = await res.text();
      let out: any; try { out = text ? JSON.parse(text) : null; } catch { out = text; }
      if (!res.ok) throw new Error(`${res.status} ${typeof out === 'object' ? out?.message ?? JSON.stringify(out) : String(out).slice(0, 200)}`);
      return out;
    } catch (e) {
      if (attempt === 3 || /^4\d\d /.test((e as Error).message)) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

async function call(body: any): Promise<any> {
  switch (body.action) {
    case 'upsert_dataset': {
      const d = body.dataset;
      const existing = await http('GET', `/rest/v1/datasets?select=id&name=eq.${encodeURIComponent(d.name)}`);
      const row = { ...d, updated_at: new Date().toISOString() };
      if (existing.length) { await http('PATCH', `/rest/v1/datasets?id=eq.${existing[0].id}`, row); return { id: existing[0].id }; }
      const [created] = await http('POST', '/rest/v1/datasets', row, { Prefer: 'return=representation' });
      return { id: created.id };
    }
    case 'upload_original':
      return http('POST', `/storage/v1/object/private-files/${body.path}`, new Uint8Array(Buffer.from(body.base64, 'base64')),
        { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'x-upsert': 'true' });
    case 'create_batch': {
      const b = body.batch;
      const live = await http('GET', `/rest/v1/dataset_batches?select=id,status&dataset_id=eq.${b.dataset_id}&file_sha256=eq.${b.file_sha256}&status=in.(staged,approved)`);
      if (live.length && live[0].status === 'staged') {
        // An interrupted earlier run: discard its partial staging and start clean.
        await http('POST', '/rest/v1/rpc/ds_close', { p_batch: live[0].id, p_status: 'rejected' });
      } else if (live.length && REPLACE) {
        // Re-import after a parser fix: roll the old version back and drop its rows (they were mis-parsed).
        await http('POST', '/rest/v1/rpc/ds_close', { p_batch: live[0].id, p_status: 'rolled_back' });
        await http('DELETE', `/rest/v1/dataset_rows?batch_id=eq.${live[0].id}`);
      } else if (live.length) return { id: live[0].id, status: live[0].status, existing: true };
      const [created] = await http('POST', '/rest/v1/dataset_batches', b, { Prefer: 'return=representation' });
      return { id: created.id, status: 'staged', existing: false };
    }
    case 'stage_rows': return http('POST', '/rest/v1/rpc/ds_stage_rows', { p_batch: body.batch_id, p_rows: body.rows });
    case 'approve': return { version: await http('POST', '/rest/v1/rpc/ds_approve', { p_batch: body.batch_id }) };
    default: throw new Error('unknown action');
  }
}

function titleOf(grid: unknown[][]): string {
  for (let i = 0; i < 6; i++) for (const c of grid[i] ?? []) {
    const t = cellText(c as never).trim();
    if (t && !/hospital|al quraiyat|from date|to date|facility/i.test(t)) return t;
  }
  return '';
}

export interface Plan { file: string; spec: ReportSpec; parsed: ParsedTable; periodKey: string | null; keyKey: string | null; coverage: { start: string; end_exclusive: string } | null; note: string | null; reportPeriod: string | null }

async function plan(file: string): Promise<Plan | { file: string; skip: string }> {
  // Very large exports (hundreds of thousands of merged cells) are pre-converted to a JSON grid
  // with scripts/bulk-import/xml2grid.py, because loading them fully in ExcelJS takes hours.
  const grid = file.endsWith('.grid.json')
    ? (JSON.parse(readFileSync(file, 'utf8')) as Grid)
    : await (async () => {
      const buf = readFileSync(file);
      const { sheets } = await readWorkbookGrids(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
      return sheets[0].grid;
    })();
  const title = titleOf(grid);
  const spec = REPORTS.find((r) => r.title.test(title.trim()));
  if (!spec) return { file, skip: `تقرير غير معروف: «${title}»` };
  if (spec.skip) return { file, skip: spec.skip };
  const parsed = parseTable(grid);
  if (!parsed.rows.length) return { file, skip: 'لا توجد صفوف بيانات' };
  const byHeader = (h?: string | null) => (h ? parsed.columns.find((c) => norm(c.source_header ?? '') === norm(h)) ?? null : null);
  const pc = byHeader(spec.period);
  if (spec.period && (!pc || (pc.type !== 'date' && pc.type !== 'datetime'))) return { file, skip: `عمود الفترة «${spec.period}» غير مقروء كتاريخ (${pc?.type ?? 'غير موجود'})` };
  if (pc) pc.role = 'date';
  const kc = byHeader(spec.key);
  if (kc) kc.role = 'identifier';
  let coverage = null, note = null, reportPeriod: string | null = null;
  if (pc) {
    const obs = observedRange(parsed.rows, pc.key);
    const p = proposeCoverage(parsed.declared, obs);
    if (p) { coverage = { start: p.start, end_exclusive: p.end_exclusive }; note = p.note; }
  }
  if (spec.aggregate) {
    const d = parsed.declared;
    reportPeriod = d.start && d.endInclusive ? formatPeriod(d.start, addDays(d.endInclusive, 1)) : 'غير محددة';
    const key = columnKey('report period', -1);
    parsed.columns.push({ index: -99, key, label: 'فترة التقرير', type: 'text', role: 'dimension', source_header: '[report period]', samples: [reportPeriod], filled: parsed.rows.length, parse: null, invalid: 0 });
    for (const r of parsed.rows) r.data[key] = reportPeriod;
  }
  return { file, spec, parsed, periodKey: pc?.key ?? null, keyKey: kc?.key ?? null, coverage, note, reportPeriod };
}

async function main() {
  for (const file of files) {
    const t0 = Date.now();
    const p = await plan(file);
    if ('skip' in p) { console.log(`\n## ${basename(file)} — تخطٍّ: ${p.skip}`); continue; }
    const { spec, parsed } = p;
    console.log(`\n## ${basename(file)} → «${spec.name}» (${spec.aggregate ? 'مجمّع' : 'تفصيلي'}) — ${parsed.rows.length} صف، تُركت ${parsed.emptyRows} — ${Date.now() - t0}ms`);
    console.log(`   الفترة: ${p.coverage ? `${p.coverage.start} → ${p.coverage.end_exclusive}` : p.reportPeriod ?? '—'}${p.note ? ` (${p.note})` : ''}`);
    for (const c of parsed.columns) {
      const mark = c.role === 'ignore' ? '✗' : c.role === 'identifier' ? '#' : ' ';
      console.log(`   ${mark} ${c.role.padEnd(10)} ${c.type.padEnd(8)} ${(c.source_header ?? '').slice(0, 40).padEnd(40)} → ${c.label}${c.invalid ? `  [${c.invalid} غير مقروء]` : ''}${c.role !== 'ignore' && c.role !== 'identifier' && c.samples.length ? `  e.g. ${c.samples.slice(0, 2).join(' | ').slice(0, 60)}` : ''}`);
    }
    if (mode !== 'import') continue;

    const columns = parsed.columns.map(({ key, label, type, role, source_header }) => ({ key, label, type, role, source_header }));
    const ds = await call({ action: 'upsert_dataset', dataset: {
      name: spec.name, unit_label: spec.unit, description: spec.description,
      mode: 'append', period_column: p.periodKey, key_column: p.keyKey, header_signature: headerSignature(parsed.headers), columns,
    } });
    const orig = file.replace(/\.grid\.json$/, '.xlsx');
    const raw = readFileSync(orig);
    const sha = createHash('sha256').update(raw).digest('hex');
    const path = `originals/${ds.id}/${sha}.xlsx`;
    let originalNote = '';
    if (raw.length <= 40 * 1024 * 1024) {
      await call({ action: 'upload_original', path, base64: raw.toString('base64') }).catch((e) => { originalNote = ` (لم يُرفع الأصل: ${(e as Error).message.slice(0, 80)})`; });
    } else originalNote = ' (الأصل أكبر من 6 م.ب؛ لم يُرفع عبر هذه الأداة)';
    const quality = {
      invalid: Object.fromEntries(parsed.columns.filter((c) => c.invalid > 0).map((c) => [c.label, c.invalid])),
      empty_rows: parsed.emptyRows, ignored_columns: parsed.columns.filter((c) => c.role === 'ignore' && c.source_header).map((c) => c.source_header),
      coverage_note: p.note, imported_by: 'bulk-import',
    };
    const batch = await call({ action: 'create_batch', batch: {
      dataset_id: ds.id, file_name: basename(orig), file_sha256: sha, storage_path: originalNote ? null : path, quality,
      coverage_start: p.coverage?.start ?? null, coverage_end_exclusive: p.coverage?.end_exclusive ?? null, as_of: p.coverage ? null : (parsed.declared.endInclusive ?? null),
    } });
    if (batch.existing) { console.log(`   ⟲ الملف نفسه موجود (${batch.status})؛ لم يُكرر.`); continue; }
    let inserted = 0, dups = 0;
    for (let i = 0; i < parsed.rows.length; i += 1000) {
      const r = await call({ action: 'stage_rows', batch_id: batch.id, rows: parsed.rows.slice(i, i + 1000) });
      inserted += r.inserted; dups += r.duplicates;
    }
    const ap = await call({ action: 'approve', batch_id: batch.id });
    console.log(`   ✓ جُهز ${inserted} واعتُمد (إصدار ${ap.version})${dups ? `، تكرار داخل الملف: ${dups}` : ''}${originalNote}`);
  }
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
