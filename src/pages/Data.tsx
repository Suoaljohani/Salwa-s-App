import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { FileDrop } from '../components/FileDrop';
import { IconData, IconDownload, IconHistory, IconUndo } from '../components/Icons';
import { Empty, Notice, Pill } from '../components/ui';
import { usePrefs } from '../lib/prefs';
import { bumpDataset } from '../lib/appState';
import { cue } from '../lib/sound';
import { sha256Hex } from '../lib/hash';
import { readWorkbookGrids } from '../lib/excel/readGrid';
import { csvToGrid, FIELDS, parseVisitGrid, type Grid, type Mapping, type ParseResult } from '../lib/import/visitReport';
import { approveBatch, closeBatch, findLiveBatchByHash, listBatches, originalUrl, overlapping, stageImport, type BatchRecord, type StageProgress } from '../lib/import/service';
import { runLocalQuery } from '../lib/metrics/localEngine';
import { valueLabel } from '../lib/metrics/catalog';
import { addDays, formatInstant, formatPeriod } from '../lib/dates';
import { fmtNum } from '../lib/format';

const MAX_BYTES = 30 * 1024 * 1024;

interface Draft {
  file: File;
  sha: string;
  sheets: { name: string; grid: Grid }[];
  sheet: number;
  parsed: ParseResult;
  mapping: Mapping;
  coverage: { start: string; end_exclusive: string } | null;
  existing: BatchRecord | null;
}

const ISSUE_LABEL: Record<string, string> = {
  missing_visit_id: 'بلا رقم زيارة',
  bad_visit_date: 'تاريخ زيارة غير مقروء',
  missing_encounter: 'بلا نوع زيارة',
  duplicate_visit_id: 'رقم زيارة مكرر داخل الملف',
  bad_age: 'عمر غير مقروء (حُفظ كغير مسجّل)',
};

const STATUS: Record<BatchRecord['status'], { label: string; tone: 'ok' | 'warn' | 'neutral' | 'danger' }> = {
  approved: { label: 'معتمد', tone: 'ok' },
  staged: { label: 'بانتظار الاعتماد', tone: 'warn' },
  rolled_back: { label: 'متراجع عنه', tone: 'neutral' },
  rejected: { label: 'مرفوض', tone: 'neutral' },
};

export function DataPage() {
  const demo = usePrefs((p) => p.demoMode);
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

  const onFile = async (file: File) => {
    setFileError(null); setDone(null); setStaged(null); setActionError(null);
    if (file.size > MAX_BYTES) { setFileError('حجم الملف أكبر من 30 م.ب. قسّمي التقرير على فترات أقصر.'); return; }
    if (!/\.(xlsx|csv)$/i.test(file.name)) { setFileError('الصيغ المدعومة حاليًا: XLSX وCSV.'); return; }
    setReading(true);
    try {
      const buf = await file.arrayBuffer();
      const sha = await sha256Hex(buf);
      const sheets = /\.csv$/i.test(file.name)
        ? [{ name: 'CSV', grid: csvToGrid(new TextDecoder('utf-8').decode(buf)) }]
        : (await readWorkbookGrids(buf)).sheets;
      let sheet = sheets.findIndex((s) => parseVisitGrid(s.grid).headerRowIndex >= 0);
      if (sheet < 0) sheet = 0;
      const parsed = parseVisitGrid(sheets[sheet].grid);
      const existing = demo ? null : await findLiveBatchByHash(sha).catch(() => null);
      setDraft({ file, sha, sheets, sheet, parsed, mapping: parsed.mapping, coverage: parsed.proposedCoverage ? { start: parsed.proposedCoverage.start, end_exclusive: parsed.proposedCoverage.end_exclusive } : null, existing });
    } catch {
      setFileError('تعذّر قراءة الملف. تأكدي أنه ملف Excel سليم غير محمي بكلمة مرور.');
    } finally {
      setReading(false);
    }
  };

  const remap = (patch: Mapping) => {
    if (!draft) return;
    const mapping = { ...draft.mapping, ...patch };
    for (const k of Object.keys(patch) as (keyof Mapping)[]) if (patch[k] === undefined) delete mapping[k];
    const parsed = parseVisitGrid(draft.sheets[draft.sheet].grid, mapping);
    setDraft({ ...draft, mapping, parsed });
  };

  const missingRequired = draft ? FIELDS.filter((f) => f.required && draft.mapping[f.id] === undefined) : [];
  const overlaps = draft?.coverage && batches ? overlapping(batches, draft.coverage.start, draft.coverage.end_exclusive) : [];

  const preview = useMemo(() => {
    if (!draft?.coverage || !draft.parsed.rows.length) return null;
    // Preview only, in memory: the raw MRN stands in for the server-side keyed hash.
    const ds = { rows: draft.parsed.rows.map((r) => ({ ...r, patient_key: r.mrn })), windows: [{ id: 'preview', file_name: draft.file.name, start: draft.coverage.start, end_exclusive: draft.coverage.end_exclusive }], datasetVersion: 0, demo: false };
    try {
      return {
        byEnc: runLocalQuery(ds, { metric: 'visits', start: draft.coverage.start, end_exclusive: draft.coverage.end_exclusive, filters: {}, group_by: ['encounter_type'] }),
        patients: runLocalQuery(ds, { metric: 'distinct_patients', start: draft.coverage.start, end_exclusive: draft.coverage.end_exclusive, filters: {}, group_by: [] }),
        unknownAge: draft.parsed.rows.filter((r) => r.age_years == null).length,
        unknownGender: draft.parsed.rows.filter((r) => r.gender == null).length,
        outside: draft.parsed.rows.filter((r) => r.visit_at.slice(0, 10) < draft.coverage!.start || r.visit_at.slice(0, 10) >= draft.coverage!.end_exclusive).length,
      };
    } catch { return null; }
  }, [draft]);

  const save = async () => {
    if (!draft?.coverage) return;
    setBusy(true); setActionError(null);
    abort.current = new AbortController();
    try {
      const b = await stageImport(draft.file, draft.sha, { ...draft.parsed, mapping: draft.mapping }, draft.coverage, setProgress, abort.current.signal);
      setStaged(b);
      setDraft(null);
      refresh();
    } catch (e) {
      const m = (e as Error).message;
      setActionError(m === 'duplicate_file' ? 'هذا الملف نفسه محفوظ من قبل؛ لن يُستورد مرة ثانية.' : 'تعذّر حفظ الدفعة. لم يُعتمد شيء. أعيدي المحاولة.');
      refresh();
    } finally {
      setBusy(false); setProgress(null);
    }
  };

  const approve = async (b: BatchRecord) => {
    setBusy(true); setActionError(null);
    try {
      const v = await approveBatch(b.id);
      setDone(`اعتُمدت الدفعة. إصدار البيانات الآن ${fmtNum(v)}، والمساعد والمؤشرات تستخدمه مباشرة.`);
      setStaged(null);
      cue('success');
      bumpDataset();
      refresh();
    } catch { setActionError('تعذّر اعتماد الدفعة.'); } finally { setBusy(false); }
  };

  const close = async (b: BatchRecord, status: 'rolled_back' | 'rejected') => {
    const msg = status === 'rolled_back' ? 'التراجع عن هذه الدفعة يزيل بياناتها من الحسابات (يبقى الأصل محفوظًا). متابعة؟' : 'رفض الدفعة وحذف صفوفها المجهزة؟';
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      await closeBatch(b.id, status);
      if (staged?.id === b.id) setStaged(null);
      bumpDataset();
      refresh();
    } catch { setActionError('تعذّر تنفيذ الإجراء.'); } finally { setBusy(false); }
  };

  return (
    <main className="page">
      <header className="page-head">
        <h1>البيانات والاستيراد</h1>
        <p>ارفعي تقرير زيارات Excel أو CSV. يُحفظ الأصل، وتُراجع الأعمدة والجودة، ولا يدخل في الحسابات إلا بعد اعتمادك.</p>
      </header>

      {demo && <Notice tone="warn">أنتِ في الوضع التجريبي. يمكنك معاينة ملف، لكن الحفظ والاعتماد متاحان فقط مع الاتصال الحقيقي.</Notice>}
      {done && <Notice>{done}</Notice>}
      {actionError && <Notice tone="danger">{actionError}</Notice>}

      {staged && (
        <section className="reading card" aria-labelledby="staged-h">
          <h2 id="staged-h">دفعة جاهزة للاعتماد</h2>
          <BatchSummary b={staged} />
          {(staged.duplicate_in_file > 0) && <p className="muted">تجاهل الخادم {fmtNum(staged.duplicate_in_file)} صفًا مكرر رقم الزيارة.</p>}
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => approve(staged)}>اعتماد وإتاحتها للحسابات</button>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => close(staged, 'rejected')}>رفض</button>
          </div>
        </section>
      )}

      {!draft && !staged && (
        <div className="reading card">
          <FileDrop accept=".xlsx,.csv" busy={reading} onFile={onFile} title="ارفعي تقرير الزيارات" hint="XLSX أو CSV حتى 30 م.ب" />
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
                <select className="select" value={draft.sheet} onChange={(e) => {
                  const sheet = Number(e.target.value);
                  const parsed = parseVisitGrid(draft.sheets[sheet].grid);
                  setDraft({ ...draft, sheet, parsed, mapping: parsed.mapping, coverage: parsed.proposedCoverage ? { start: parsed.proposedCoverage.start, end_exclusive: parsed.proposedCoverage.end_exclusive } : draft.coverage });
                }}>{draft.sheets.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}</select>
              </label>
            )}
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>مستوى التفاصيل</dt><dd>سجل لكل زيارة</dd>
              <dt>الفترة المذكورة في الملف</dt><dd>{draft.parsed.declared.start ? formatPeriod(draft.parsed.declared.start, addDays(draft.parsed.declared.endInclusive ?? draft.parsed.declared.start, 1)) : 'غير مذكورة'}</dd>
              <dt>أول وآخر زيارة</dt><dd>{draft.parsed.observed.first ? <>{formatInstant(draft.parsed.observed.first)} — {formatInstant(draft.parsed.observed.last!)}</> : '—'}</dd>
              <dt>الصفوف</dt><dd><bdi className="num">{fmtNum(draft.parsed.totals.accepted)}</bdi> مقبول من <bdi className="num">{fmtNum(draft.parsed.totals.dataRows)}</bdi></dd>
            </dl>
          </div>

          <div className="reading card">
            <h2>ربط الأعمدة</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: 'var(--fs-sm)' }}>
              أعمدة الهوية الشخصية ({draft.parsed.columns.filter((c) => c.personal).length}) لا تُقرأ ولا تُحفظ. رقم الملف يُحوَّل في الخادم إلى معرّف مستعار لعد المرضى المختلفين.
            </p>
            <div className="table-scroll">
              <table className="data">
                <thead><tr><th scope="col">الحقل</th><th scope="col">العمود في الملف</th><th scope="col">مثال</th></tr></thead>
                <tbody>
                  {FIELDS.map((f) => {
                    const idx = draft.mapping[f.id];
                    const col = draft.parsed.columns.find((c) => c.index === idx);
                    return (
                      <tr key={f.id}>
                        <td>{f.label}{f.required && <span aria-label="مطلوب" style={{ color: 'var(--warn)' }}> *</span>}</td>
                        <td>
                          <select className="select" dir="ltr" aria-label={`عمود ${f.label}`} value={idx ?? ''} onChange={(e) => remap({ [f.id]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                            <option value="">— غير مربوط —</option>
                            {draft.parsed.columns.filter((c) => !c.personal).map((c) => <option key={c.index} value={c.index}>{c.header.replace(/\s+/g, ' ')}</option>)}
                          </select>
                        </td>
                        <td className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{f.id === 'mrn' ? (col ? 'مخفي' : '') : <bdi>{col?.samples[0] ?? ''}</bdi>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {missingRequired.length > 0 && <div style={{ marginTop: 10 }}><Notice tone="danger">اربطي الحقول المطلوبة: {missingRequired.map((f) => f.label).join('، ')}.</Notice></div>}
          </div>

          <div className="reading card">
            <h2>التغطية والجودة</h2>
            {draft.coverage ? (
              <div className="row">
                <label className="field"><span>من (شامل)</span><input className="input" type="date" dir="ltr" value={draft.coverage.start} onChange={(e) => setDraft({ ...draft, coverage: { ...draft.coverage!, start: e.target.value } })} /></label>
                <label className="field"><span>إلى (شامل)</span><input className="input" type="date" dir="ltr" value={addDays(draft.coverage.end_exclusive, -1)} onChange={(e) => setDraft({ ...draft, coverage: { ...draft.coverage!, end_exclusive: addDays(e.target.value, 1) } })} /></label>
              </div>
            ) : <Notice tone="warn">لم تُحدد فترة التغطية.</Notice>}
            {draft.parsed.proposedCoverage?.note && <div style={{ marginTop: 10 }}><Notice tone="warn">{draft.parsed.proposedCoverage.note}</Notice></div>}
            <p className="faint" style={{ fontSize: 'var(--fs-xs)' }}>التغطية تعني أن الملف يحتوي كل زيارات هذه الأيام. الأيام خارجها تظهر في الحسابات كتغطية ناقصة، لا كصفر.</p>
            {overlaps.length > 0 && <Notice tone="warn">تتداخل هذه الفترة مع: {overlaps.map((b) => b.file_name).join('، ')}. عند الاعتماد تحل هذه النسخة محل السابقة داخل فترتها، ولا تُجمع فوقها.</Notice>}
            <ul className="list" style={{ marginTop: 8 }}>
              {Object.entries(draft.parsed.issues.reduce<Record<string, number>>((a, i) => { a[i.code] = (a[i.code] ?? 0) + 1; return a; }, {})).map(([code, n]) => (
                <li key={code} className="row row--between"><span>{ISSUE_LABEL[code] ?? code}</span><bdi className="num">{fmtNum(n)}</bdi></li>
              ))}
              {preview && <li className="row row--between"><span>عمر غير مسجّل</span><bdi className="num">{fmtNum(preview.unknownAge)}</bdi></li>}
              {preview && <li className="row row--between"><span>جنس غير مسجّل</span><bdi className="num">{fmtNum(preview.unknownGender)}</bdi></li>}
              {preview && preview.outside > 0 && <li className="row row--between"><span>زيارات خارج فترة التغطية (تُحفظ وتُحسب ضمن تاريخها)</span><bdi className="num">{fmtNum(preview.outside)}</bdi></li>}
            </ul>
            {preview && (
              <>
                <h3 style={{ fontSize: 'var(--fs-sm)', margin: '14px 0 6px' }}>معاينة قبل الاعتماد</h3>
                <dl className="kv">
                  {preview.byEnc.rows.map((r) => <Fragment key={r.d1}><dt>{valueLabel('encounter_type', r.d1)}</dt><dd><bdi className="num">{fmtNum(r.value)}</bdi> زيارة</dd></Fragment>)}
                  <dt>المرضى المختلفون</dt><dd><bdi className="num">{fmtNum(preview.patients.value)}</bdi></dd>
                </dl>
              </>
            )}
          </div>

          <div className="row">
            <button type="button" className="btn btn--primary" disabled={demo || busy || !!draft.existing || missingRequired.length > 0 || !draft.coverage || !draft.parsed.rows.length} onClick={save}>
              حفظ الأصل وتجهيز الدفعة
            </button>
            {progress && <span className="faint" role="status">{progress.phase === 'upload' ? 'رفع الملف الأصلي…' : `تجهيز الصفوف: ${fmtNum(progress.done)} من ${fmtNum(progress.total)}`}</span>}
          </div>
        </section>
      )}

      <section className="reading card" style={{ marginTop: 16 }} aria-labelledby="hist-h">
        <h2 id="hist-h"><IconHistory aria-hidden style={{ width: 16, height: 16, verticalAlign: -2, marginInlineEnd: 6 }} />سجل المصادر</h2>
        {listError && <Notice tone="danger">تعذّر تحميل السجل.</Notice>}
        {batches && batches.length === 0 && <Empty icon={<IconData aria-hidden />} title="لا توجد مصادر بعد" />}
        {batches === null && !listError && <div className="skeleton" style={{ height: 60 }} />}
        {batches && batches.length > 0 && (
          <ul className="list">
            {batches.map((b) => (
              <li key={b.id}>
                <div className="row row--between">
                  <strong style={{ fontSize: 'var(--fs-sm)', minWidth: 0, overflowWrap: 'anywhere' }}><bdi>{b.file_name}</bdi></strong>
                  <Pill tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Pill>
                </div>
                <BatchSummary b={b} />
                <div className="row" style={{ marginTop: 6 }}>
                  {b.status === 'staged' && <button type="button" className="btn btn--sm btn--primary" disabled={busy} onClick={() => approve(b)}>اعتماد</button>}
                  {b.status === 'staged' && <button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={() => close(b, 'rejected')}>رفض</button>}
                  {b.status === 'approved' && <button type="button" className="btn btn--sm btn--quiet" disabled={busy} onClick={() => close(b, 'rolled_back')}><IconUndo aria-hidden />تراجع</button>}
                  {b.storage_path && <button type="button" className="btn btn--sm btn--quiet" onClick={async () => { const u = await originalUrl(b.storage_path!); if (u) location.assign(u); }}><IconDownload aria-hidden />الأصل</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function BatchSummary({ b }: { b: BatchRecord }) {
  return (
    <div className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 2 }}>
      التغطية {formatPeriod(b.coverage_start, b.coverage_end_exclusive)} — <bdi className="num">{fmtNum(b.row_count)}</bdi> زيارة
      {b.approved_at ? <> — اعتُمد {formatInstant(b.approved_at)}</> : <> — رُفع {formatInstant(b.created_at)}</>}
    </div>
  );
}
