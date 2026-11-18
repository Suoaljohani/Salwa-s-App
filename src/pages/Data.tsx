import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { FileDrop } from '../components/FileDrop';
import { IconData, IconDownload, IconHistory, IconUndo } from '../components/Icons';
import { Empty, Notice, Pill, Seg } from '../components/ui';
import { usePrefs } from '../lib/prefs';
import { bumpDataset } from '../lib/appState';
import { cue } from '../lib/sound';
import { sha256Hex } from '../lib/hash';
import { readWorkbookGrids } from '../lib/excel/readGrid';
import { csvToGrid, headerSignature, observedRange, parseTable, proposeCoverage, type ColumnPlan, type Grid, type ParsedTable } from '../lib/import/table';
import { approveBatch, closeBatch, findLiveBatchByHash, listBatches, originalUrl, saveDataset, stageImport, type BatchRecord, type StageProgress } from '../lib/import/service';
import { localCatalogInfo, runLocalQuery } from '../lib/metrics/localEngine';
import { keyLabel } from '../lib/metrics/catalog';
import { addDays, formatInstant, formatPeriod, todayRiyadh } from '../lib/dates';
import { downloadBuffer } from '../lib/excel/report';
import { fmtNum } from '../lib/format';
import { invalidate } from '../lib/metrics/engine';
import { useCatalog } from '../lib/catalogStore';
import type { ColRole, ColType, DatasetInfo } from '../lib/metrics/types';

const MAX_BYTES = 30 * 1024 * 1024;

const ROLE_LABEL: Record<ColRole, string> = {
  dimension: 'فئة (للتصفية والتوزيع)',
  measure: 'قيمة رقمية',
  date: 'تاريخ',
  identifier: 'معرّف (يُشفّر، للعد بدون تكرار)',
  ignore: 'لا يُحفظ (بيانات شخصية أو غير لازمة)',
};
const TYPE_LABEL: Record<ColType, string> = { text: 'نص', number: 'رقم', date: 'تاريخ', datetime: 'تاريخ ووقت', boolean: 'نعم/لا' };

interface Draft {
  file: File;
  sha: string;
  sheets: { name: string; grid: Grid }[];
  sheet: number;
  parsed: ParsedTable;
  target: string; // 'new' or dataset id
  name: string;
  unit: string;
  mode: 'snapshot' | 'append';
  periodColumn: string | null;
  keyColumn: string | null;
  coverage: { start: string; end_exclusive: string } | null;
  asOf: string;
  existing: BatchRecord | null;
}

const STATUS: Record<BatchRecord['status'], { label: string; tone: 'ok' | 'warn' | 'neutral' }> = {
  approved: { label: 'معتمد', tone: 'ok' }, staged: { label: 'بانتظار الاعتماد', tone: 'warn' },
  rolled_back: { label: 'متراجع عنه', tone: 'neutral' }, rejected: { label: 'مرفوض', tone: 'neutral' },
};

function applyExisting(grid: Grid, parsed: ParsedTable, ds: DatasetInfo | undefined): ParsedTable {
  if (!ds) return parsed;
  // Reuse the saved column decisions for columns with the same key (same header).
  const columns = parsed.columns.map((c) => {
    const saved = ds.columns.find((x) => x.key === c.key);
    return saved ? { ...c, label: saved.label, type: saved.type, role: saved.role } : c;
  });
  return parseTable(grid, { headerRowIndex: parsed.headerRowIndex, columns });
}

export function DataPage() {
  const demo = usePrefs((p) => p.demoMode);
  const { catalog } = useCatalog();
  const [batches, setBatches] = useState<BatchRecord[] | null>(null);
  const [listError, setListError] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState<StageProgress | null>(null);
  const [staged, setStaged] = useState<BatchRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const refresh = () => {
    if (demo) { setBatches([]); return; }
    listBatches().then((b) => { setBatches(b); setListError(false); }).catch(() => setListError(true));
  };
  useEffect(refresh, [demo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => abort.current?.abort(), []);
  const changed = () => { invalidate(); bumpDataset(); refresh(); };

  const buildDraft = (file: File, sha: string, sheets: Draft['sheets'], sheet: number, existing: BatchRecord | null): Draft | null => {
    const grid = sheets[sheet].grid;
    let parsed = parseTable(grid);
    if (parsed.headerRowIndex < 0) return null;
    const sig = headerSignature(parsed.headers);
    const match = catalog?.datasets.find((d) => d.header_signature === sig);
    if (match) parsed = applyExisting(grid, parsed, match);
    const dateCols = parsed.columns.filter((c) => c.role === 'date');
    const preset = parsed.preset;
    const periodColumn = match?.period_column ?? (preset ? parsed.columns.find((c) => c.source_header?.toLowerCase() === preset.period_header)?.key ?? null : null);
    const keyColumn = match?.key_column ?? (preset ? parsed.columns.find((c) => c.source_header?.toLowerCase() === preset.key_header)?.key ?? null : null);
    const mode = match?.mode ?? preset?.mode ?? 'snapshot';
    const d: Draft = {
      file, sha, sheets, sheet, parsed, existing,
      target: match?.id ?? 'new',
      name: match?.name ?? preset?.name ?? guessName(parsed.headers, sheets[sheet].name) ?? file.name.replace(/\.(xlsx|csv)$/i, ''),
      unit: match?.unit_label ?? preset?.unit_label ?? guessUnit(parsed.headers),
      mode, periodColumn: periodColumn ?? (mode === 'append' ? dateCols[0]?.key ?? null : null), keyColumn,
      coverage: null, asOf: todayRiyadh(),
    };
    return withCoverage(d);
  };

  const withCoverage = (d: Draft): Draft => {
    if (d.mode !== 'append' || !d.periodColumn) return { ...d, coverage: null };
    const obs = observedRange(d.parsed.rows, d.periodColumn);
    const p = proposeCoverage(d.parsed.declared, obs);
    return { ...d, coverage: p ? { start: p.start, end_exclusive: p.end_exclusive } : null };
  };

  const onFile = async (file: File) => {
    setFileError(null); setDone(null); setStaged(null); setActionError(null);
    if (file.size > MAX_BYTES) { setFileError('حجم الملف أكبر من 30 م.ب. قسّمي الملف.'); return; }
    if (!/\.(xlsx|csv)$/i.test(file.name)) { setFileError('الصيغ المدعومة: XLSX وCSV.'); return; }
    setReading(true);
    try {
      const buf = await file.arrayBuffer();
      const sha = await sha256Hex(buf);
      const sheets = /\.csv$/i.test(file.name) ? [{ name: 'CSV', grid: csvToGrid(new TextDecoder('utf-8').decode(buf)) }] : (await readWorkbookGrids(buf)).sheets;
      let sheet = sheets.findIndex((s) => parseTable(s.grid).rows.length > 0);
      if (sheet < 0) sheet = 0;
      const d = buildDraft(file, sha, sheets, sheet, null);
      if (!d) { setFileError('لم يُعثر على صف عناوين وأعمدة في الملف.'); return; }
      if (!demo && d.target !== 'new') d.existing = await findLiveBatchByHash(d.target, sha).catch(() => null);
      setDraft(d);
    } catch {
      setFileError('تعذّر قراءة الملف. تأكدي أنه ملف Excel سليم غير محمي بكلمة مرور.');
    } finally { setReading(false); }
  };

  const updateColumn = (key: string, patch: Partial<ColumnPlan>) => {
    if (!draft) return;
    const columns = draft.parsed.columns.map((c) => (c.key === key ? { ...c, ...patch } : c));
    const parsed = parseTable(draft.sheets[draft.sheet].grid, { headerRowIndex: draft.parsed.headerRowIndex, columns });
    setDraft(withCoverage({ ...draft, parsed, periodColumn: draft.periodColumn && parsed.columns.find((c) => c.key === draft.periodColumn)?.role === 'date' ? draft.periodColumn : draft.periodColumn }));
  };

  const info: DatasetInfo | null = useMemo(() => draft && {
    id: 'preview', name: draft.name, unit_label: draft.unit, mode: draft.mode, period_column: draft.periodColumn, key_column: draft.keyColumn, version: 0, row_count: 0, coverage: [],
    columns: draft.parsed.columns.map(({ key, label, type, role, source_header }) => ({ key, label, type, role, source_header })),
  }, [draft]);

  const preview = useMemo(() => {
    if (!draft || !info || !draft.parsed.rows.length) return null;
    const ds = { info, rows: draft.parsed.rows.map((r) => r.data), windows: [{ id: 'p', file_name: draft.file.name, start: draft.coverage?.start ?? null, end_exclusive: draft.coverage?.end_exclusive ?? null }], demo: false };
    try {
      const cat = localCatalogInfo(ds);
      const dim = cat.columns.find((c) => c.role === 'dimension' && (c.values?.length ?? 0) >= 2 && (c.values?.length ?? 0) <= 8);
      const by = dim ? runLocalQuery({ ...ds, info: { ...info, mode: 'snapshot' } }, { dataset_id: 'preview', measure: { op: 'count' }, filters: [], group_by: [{ column: dim.key }], period: null }) : null;
      return { cat, dim, by };
    } catch { return null; }
  }, [draft, info]);

  const problems: string[] = [];
  if (draft) {
    if (!draft.name.trim()) problems.push('اكتبي اسمًا لقاعدة البيانات.');
    if (draft.mode === 'append' && !draft.periodColumn) problems.push('اختاري عمود التاريخ الذي يحدد الفترة.');
    if (draft.mode === 'append' && !draft.coverage) problems.push('حددي فترة التغطية.');
    if (!draft.parsed.columns.some((c) => c.role !== 'ignore')) problems.push('كل الأعمدة مستبعدة.');
  }

  const save = async () => {
    if (!draft || problems.length) return;
    setBusy(true); setActionError(null);
    abort.current = new AbortController();
    try {
      const target = draft.target === 'new' ? undefined : draft.target;
      const id = await saveDataset({
        id: target, name: draft.name, unit_label: draft.unit, mode: draft.mode, period_column: draft.mode === 'append' ? draft.periodColumn : null,
        key_column: draft.keyColumn, header_signature: headerSignature(draft.parsed.headers),
        columns: mergeColumns(catalog?.datasets.find((d) => d.id === target), draft.parsed.columns),
      });
      const b = await stageImport(draft.file, draft.sha, id, draft.parsed,
        draft.mode === 'append'
          ? { coverage_start: draft.coverage!.start, coverage_end_exclusive: draft.coverage!.end_exclusive, as_of: null }
          : { coverage_start: null, coverage_end_exclusive: null, as_of: draft.asOf },
        setProgress, abort.current.signal);
      setStaged(b);
      setDraft(null);
      changed();
    } catch (e) {
      const m = (e as Error).message;
      setActionError(m === 'duplicate_file' ? 'هذا الملف نفسه محفوظ من قبل لهذه البيانات؛ لن يُستورد مرة ثانية.' : 'تعذّر حفظ الدفعة. لم يُعتمد شيء. أعيدي المحاولة.');
      refresh();
    } finally { setBusy(false); setProgress(null); }
  };

  const approve = async (b: BatchRecord) => {
    setBusy(true); setActionError(null);
    try {
      await approveBatch(b.id);
      const ds = catalog?.datasets.find((d) => d.id === b.dataset_id);
      setDone(`اعتُمدت البيانات${ds ? ` في «${ds.name}»` : ''}، والمساعد والمؤشرات يستخدمانها مباشرة.`);
      setStaged(null);
      cue('success');
      changed();
    } catch { setActionError('تعذّر اعتماد الدفعة.'); } finally { setBusy(false); }
  };

  const close = async (b: BatchRecord, status: 'rolled_back' | 'rejected') => {
    if (!confirm(status === 'rolled_back' ? 'التراجع عن هذه الدفعة يزيلها من الحسابات (يبقى الأصل محفوظًا). متابعة؟' : 'رفض الدفعة وحذف صفوفها المجهزة؟')) return;
    setBusy(true);
    try { await closeBatch(b.id, status); if (staged?.id === b.id) setStaged(null); changed(); }
    catch { setActionError('تعذّر تنفيذ الإجراء.'); } finally { setBusy(false); }
  };

  const dsName = (id: string) => catalog?.datasets.find((d) => d.id === id)?.name ?? '';

  return (
    <main className="page">
      <header className="page-head">
        <h1>البيانات والاستيراد</h1>
        <p>ارفعي أي جدول Excel أو CSV — زيارات، موظفين، أسرّة، عمليات… يُحفظ الأصل، وتراجعين الأعمدة، ولا يدخل في الحسابات إلا بعد اعتمادك.</p>
      </header>

      {demo && <Notice tone="warn">أنتِ في الوضع التجريبي. يمكنك معاينة ملف، لكن الحفظ والاعتماد متاحان فقط مع الاتصال الحقيقي.</Notice>}
      {done && <Notice>{done}</Notice>}
      {actionError && <Notice tone="danger">{actionError}</Notice>}

      {catalog && catalog.datasets.length > 0 && !draft && (
        <section className="reading card" aria-labelledby="ds-h">
          <h2 id="ds-h">قواعد البيانات</h2>
          <ul className="list">
            {catalog.datasets.map((d) => (
              <li key={d.id} className="row row--between">
                <div>
                  <strong style={{ fontSize: 'var(--fs-sm)' }}>{d.name}</strong>
                  <div className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                    {fmtNum(d.row_count)} {d.unit_label} — {d.mode === 'append' ? 'تراكمي' : 'لقطة'} — {d.columns.filter((c) => c.role !== 'ignore').length} عمودًا
                    {d.mode === 'append' && d.coverage.length > 0 && <> — {formatPeriod(d.coverage.map((c) => c.start!).sort()[0], d.coverage.map((c) => c.end_exclusive!).sort().at(-1)!)}</>}
                  </div>
                </div>
                <Pill tone={d.row_count ? 'ok' : 'warn'}>{d.row_count ? 'معتمدة' : 'بلا بيانات'}</Pill>
              </li>
            ))}
          </ul>
        </section>
      )}

      {staged && (
        <section className="reading card" aria-labelledby="staged-h">
          <h2 id="staged-h">دفعة جاهزة للاعتماد — {dsName(staged.dataset_id)}</h2>
          <BatchSummary b={staged} />
          {staged.duplicate_in_file > 0 && <p className="muted">تجاهل الخادم {fmtNum(staged.duplicate_in_file)} صفًا مكرر المفتاح.</p>}
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => approve(staged)}>اعتماد وإتاحتها للحسابات</button>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => close(staged, 'rejected')}>رفض</button>
          </div>
        </section>
      )}

      {!draft && !staged && (
        <div className="reading card">
          <FileDrop accept=".xlsx,.csv" busy={reading} onFile={onFile} title="ارفعي ملف بيانات" hint="XLSX أو CSV حتى 30 م.ب" />
          {fileError && <div style={{ marginTop: 12 }}><Notice tone="danger">{fileError}</Notice></div>}
        </div>
      )}

      {draft && (
        <section className="stack" aria-label="مراجعة الملف">
          <div className="reading card">
            <div className="row row--between">
              <h2 style={{ margin: 0 }}><bdi>{draft.file.name}</bdi></h2>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setDraft(null)}>إلغاء</button>
            </div>
            {draft.existing && <div style={{ marginTop: 10 }}><Notice tone="warn">هذا الملف نفسه {draft.existing.status === 'approved' ? 'معتمد' : 'محفوظ'} منذ {formatInstant(draft.existing.created_at)}. لن يُستورد مرة ثانية حتى لا تتضاعف الأرقام.</Notice></div>}
            {draft.sheets.length > 1 && (
              <label className="field" style={{ marginTop: 12 }}><span>الورقة</span>
                <select className="select" value={draft.sheet} onChange={(e) => { const d = buildDraft(draft.file, draft.sha, draft.sheets, Number(e.target.value), draft.existing); if (d) setDraft(d); }}>
                  {draft.sheets.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
                </select></label>
            )}
            <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginBottom: 0 }}>
              <bdi className="num">{fmtNum(draft.parsed.rows.length)}</bdi> صفًا و<bdi className="num">{fmtNum(draft.parsed.columns.length)}</bdi> عمودًا
              {draft.parsed.preset && <> — تعرّف التطبيق على «تقرير الزيارات» وطبّق إعداداته</>}
            </p>
          </div>

          <div className="reading card">
            <h2>إلى أي قاعدة بيانات؟</h2>
            <label className="field"><span>الوجهة</span>
              <select className="select" value={draft.target} onChange={(e) => {
                const ds = catalog?.datasets.find((d) => d.id === e.target.value);
                const parsed = ds ? applyExisting(draft.sheets[draft.sheet].grid, draft.parsed, ds) : draft.parsed;
                setDraft(withCoverage({ ...draft, parsed, target: e.target.value, name: ds?.name ?? draft.name, unit: ds?.unit_label ?? draft.unit, mode: ds?.mode ?? draft.mode, periodColumn: ds?.period_column ?? draft.periodColumn, keyColumn: ds?.key_column ?? draft.keyColumn }));
              }}>
                <option value="new">قاعدة بيانات جديدة</option>
                {catalog?.datasets.map((d) => <option key={d.id} value={d.id}>إضافة إلى: {d.name}</option>)}
              </select></label>
            <div className="row" style={{ marginTop: 10 }}>
              <label className="field" style={{ flex: '2 1 200px' }}><span>الاسم</span><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
              <label className="field" style={{ flex: '1 1 120px' }}><span>كل صف يمثّل</span><input className="input" value={draft.unit} placeholder="زيارة، موظف، سرير…" onChange={(e) => setDraft({ ...draft, unit: e.target.value })} /></label>
            </div>
            <div className="setting" style={{ marginTop: 6 }}>
              <span>نوع البيانات<small>{draft.mode === 'snapshot' ? 'كل ملف جديد يحل محل السابق بالكامل (مثل قائمة الموظفين الحالية).' : 'كل ملف يضيف فترة جديدة، والملف المصحح لفترة يحل محلها (مثل الزيارات الشهرية).'}</small></span>
              <Seg label="نوع البيانات" value={draft.mode} onChange={(mode) => setDraft(withCoverage({ ...draft, mode, periodColumn: draft.periodColumn ?? draft.parsed.columns.find((c) => c.role === 'date')?.key ?? null }))}
                options={[{ value: 'snapshot', label: 'لقطة' }, { value: 'append', label: 'تراكمي' }]} />
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              {draft.mode === 'append' && (
                <label className="field" style={{ flex: '1 1 160px' }}><span>عمود الفترة</span>
                  <select className="select" value={draft.periodColumn ?? ''} onChange={(e) => setDraft(withCoverage({ ...draft, periodColumn: e.target.value || null }))}>
                    <option value="">—</option>
                    {draft.parsed.columns.filter((c) => c.type === 'date' || c.type === 'datetime').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select></label>
              )}
              <label className="field" style={{ flex: '1 1 160px' }}><span>مفتاح منع التكرار (اختياري)</span>
                <select className="select" value={draft.keyColumn ?? ''} onChange={(e) => setDraft({ ...draft, keyColumn: e.target.value || null })}>
                  <option value="">بلا مفتاح</option>
                  {draft.parsed.columns.filter((c) => c.role === 'identifier').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select></label>
            </div>
          </div>

          <div className="reading card">
            <h2>الأعمدة</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: 'var(--fs-sm)' }}>الأعمدة الشخصية (أسماء، هوية، جوال…) مستبعدة تلقائيًا ولا تُحفظ. المعرّفات تُحوَّل في الخادم إلى رموز مشفرة.</p>
            <ul className="list">
              {draft.parsed.columns.map((c) => (
                <li key={c.key}>
                  <div className="row row--between">
                    <div style={{ minWidth: 0 }}>
                      <div className="faint" style={{ fontSize: 'var(--fs-xs)' }}><bdi dir="auto">{c.source_header || '(بلا عنوان)'}</bdi>{c.samples.length > 0 && <> — مثال: <bdi>{c.samples.join('، ')}</bdi></>}</div>
                    </div>
                    {c.invalid > 0 && <Pill tone="warn">{fmtNum(c.invalid)} قيمة غير مقروءة</Pill>}
                  </div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <input className="input" aria-label="اسم العمود" style={{ flex: '2 1 150px' }} value={c.label} disabled={c.role === 'ignore'} onChange={(e) => updateColumn(c.key, { label: e.target.value })} />
                    <select className="select" aria-label="النوع" style={{ flex: '1 1 100px' }} value={c.type} disabled={c.role === 'ignore'} onChange={(e) => updateColumn(c.key, { type: e.target.value as ColType, parse: null })}>
                      {(Object.keys(TYPE_LABEL) as ColType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                    </select>
                    <select className="select" aria-label="الدور" style={{ flex: '2 1 180px' }} value={c.role} onChange={(e) => updateColumn(c.key, { role: e.target.value as ColRole })}>
                      {(Object.keys(ROLE_LABEL) as ColRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="reading card">
            <h2>{draft.mode === 'append' ? 'التغطية' : 'تاريخ البيانات'}</h2>
            {draft.mode === 'append' ? (
              draft.coverage ? (
                <div className="row">
                  <label className="field"><span>من (شامل)</span><input className="input" type="date" dir="ltr" value={draft.coverage.start} onChange={(e) => setDraft({ ...draft, coverage: { ...draft.coverage!, start: e.target.value } })} /></label>
                  <label className="field"><span>إلى (شامل)</span><input className="input" type="date" dir="ltr" value={addDays(draft.coverage.end_exclusive, -1)} onChange={(e) => setDraft({ ...draft, coverage: { ...draft.coverage!, end_exclusive: addDays(e.target.value, 1) } })} /></label>
                </div>
              ) : <Notice tone="warn">اختاري عمود الفترة لتحديد التغطية.</Notice>
            ) : (
              <label className="field"><span>البيانات صحيحة بتاريخ</span><input className="input" type="date" dir="ltr" value={draft.asOf} onChange={(e) => setDraft({ ...draft, asOf: e.target.value })} /></label>
            )}
            {draft.mode === 'append' && (() => {
              const obs = observedRange(draft.parsed.rows, draft.periodColumn);
              const note = proposeCoverage(draft.parsed.declared, obs)?.note;
              return note ? <div style={{ marginTop: 10 }}><Notice tone="warn">{note}</Notice></div> : null;
            })()}
            {draft.mode === 'append' && <p className="faint" style={{ fontSize: 'var(--fs-xs)' }}>التغطية تعني أن الملف يحتوي كل سجلات هذه الأيام. الأيام خارجها تظهر كبيانات ناقصة، لا كصفر.</p>}
          </div>

          {preview && (
            <div className="reading card">
              <h2>معاينة قبل الاعتماد</h2>
              <dl className="kv">
                <dt>السجلات</dt><dd><bdi className="num">{fmtNum(draft.parsed.rows.length)}</bdi> {draft.unit}</dd>
                {preview.by && preview.dim && preview.by.rows.map((r) => <Fragment key={r.d1}><dt>{keyLabel(preview.dim, undefined, r.d1)}</dt><dd><bdi className="num">{fmtNum(r.value)}</bdi></dd></Fragment>)}
                {draft.parsed.emptyRows > 0 && <><dt>صفوف فارغة أو ملخصات تُركت</dt><dd><bdi className="num">{fmtNum(draft.parsed.emptyRows)}</bdi></dd></>}
              </dl>
            </div>
          )}

          {problems.length > 0 && <Notice tone="warn">{problems.join(' ')}</Notice>}
          <div className="row">
            <button type="button" className="btn btn--primary" disabled={demo || busy || !!draft.existing || problems.length > 0 || !draft.parsed.rows.length} onClick={save}>حفظ الأصل وتجهيز الدفعة</button>
            {progress && <span className="faint" role="status">{progress.phase === 'upload' ? 'رفع الملف الأصلي…' : `تجهيز الصفوف: ${fmtNum(progress.done)} من ${fmtNum(progress.total)}`}</span>}
          </div>
        </section>
      )}

      <section className="reading card" style={{ marginTop: 16 }} aria-labelledby="hist-h">
        <h2 id="hist-h"><IconHistory aria-hidden style={{ width: 16, height: 16, verticalAlign: -2, marginInlineEnd: 6 }} />سجل الملفات</h2>
        {listError && <Notice tone="danger">تعذّر تحميل السجل.</Notice>}
        {batches && batches.length === 0 && <Empty icon={<IconData aria-hidden />} title="لا توجد ملفات بعد" />}
        {batches === null && !listError && <div className="skeleton" style={{ height: 60 }} />}
        {batches && batches.length > 0 && (
          <ul className="list">
            {batches.map((b) => (
              <li key={b.id}>
                <div className="row row--between">
                  <strong style={{ fontSize: 'var(--fs-sm)', minWidth: 0, overflowWrap: 'anywhere' }}><bdi>{b.file_name}</bdi></strong>
                  <Pill tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Pill>
                </div>
                <div className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{dsName(b.dataset_id)}</div>
                <BatchSummary b={b} />
                <div className="row" style={{ marginTop: 6 }}>
                  {b.status === 'staged' && <button type="button" className="btn btn--sm btn--primary" disabled={busy} onClick={() => approve(b)}>اعتماد</button>}
                  {b.status === 'staged' && <button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={() => close(b, 'rejected')}>رفض</button>}
                  {b.status === 'approved' && <button type="button" className="btn btn--sm btn--quiet" disabled={busy} onClick={() => close(b, 'rolled_back')}><IconUndo aria-hidden />تراجع</button>}
                  {b.storage_path && <button type="button" className="btn btn--sm btn--quiet" onClick={async () => { const u = await originalUrl(b.storage_path!); if (!u) return; const buf = await (await fetch(u)).arrayBuffer(); await downloadBuffer(buf, b.file_name); }}><IconDownload aria-hidden />الأصل</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

const STAFF = /employee|emp ?id|job title|الوظيفي|الموظف|منسوب|المسمى/i;
const BEDS = /\bbed\b|السرير|الأسرة/i;
function guessUnit(headers: string[]): string {
  const h = headers.join(' ');
  if (STAFF.test(h)) return 'موظف';
  if (/visit|زيارة/i.test(h)) return 'زيارة';
  if (BEDS.test(h)) return 'سرير';
  return 'سجل';
}
function guessName(headers: string[], sheet: string): string | null {
  const h = headers.join(' ');
  if (STAFF.test(h)) return 'الموظفون';
  return /^sheet\d*$/i.test(sheet) || sheet === 'CSV' ? null : sheet;
}

/** Keep columns already known to the dataset (from older files) and add new ones. */
function mergeColumns(existing: DatasetInfo | undefined, cols: ColumnPlan[]) {
  const map = new Map((existing?.columns ?? []).map((c) => [c.key, c]));
  for (const c of cols) map.set(c.key, { key: c.key, label: c.label, type: c.type, role: c.role, source_header: c.source_header });
  return [...map.values()];
}

function BatchSummary({ b }: { b: BatchRecord }) {
  return (
    <div className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 2 }}>
      {b.coverage_start && b.coverage_end_exclusive ? <>التغطية {formatPeriod(b.coverage_start, b.coverage_end_exclusive)}</> : b.as_of ? <>بتاريخ {formatPeriod(b.as_of, addDays(b.as_of, 1))}</> : null}
      {' — '}<bdi className="num">{fmtNum(b.row_count)}</bdi> سجل
      {b.approved_at ? <> — اعتُمد {formatInstant(b.approved_at)}</> : <> — رُفع {formatInstant(b.created_at)}</>}
    </div>
  );
}
