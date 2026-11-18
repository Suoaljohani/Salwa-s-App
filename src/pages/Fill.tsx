import { useEffect, useMemo, useState } from 'react';
import { FileDrop } from '../components/FileDrop';
import { RequestEditor } from '../components/RequestEditor';
import { IconCheck, IconDownload, IconSpinner } from '../components/Icons';
import { Notice, Pill } from '../components/ui';
import { getCatalog, queryMetric } from '../lib/metrics/engine';
import type { DataCatalog, MetricRequest } from '../lib/metrics/types';
import { requestTitle } from '../lib/metrics/describe';
import { fillTemplate, proposeMappings, scanTemplate, type CellMapping, type FillResult, type TemplateScan } from '../lib/excel/template';
import { downloadBuffer } from '../lib/excel/report';
import { addMonths, formatPeriod, monthsInRange } from '../lib/dates';
import { fmtNum } from '../lib/format';
import { useApp } from '../lib/appState';
import { usePrefs } from '../lib/prefs';
import { cue } from '../lib/sound';
import { supabase } from '../lib/supabase';

interface Loaded { file: File; buf: ArrayBuffer; scan: TemplateScan }
type Computed = Record<string, { value: number | null; coverage: string } | 'error'>;

const STATUS_LABEL = { mapped: 'مؤكدة', needs_review: 'تحتاج مراجعة', unavailable: 'غير متاحة في المصدر', skipped: 'تُترك كما هي' } as const;

export function FillPage() {
  const demo = usePrefs((p) => p.demoMode);
  const tick = useApp((s) => s.datasetTick);
  const [cat, setCat] = useState<DataCatalog | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reading, setReading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [periodId, setPeriodId] = useState<string>('');
  const [maps, setMaps] = useState<CellMapping[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [computed, setComputed] = useState<Computed>({});
  const [result, setResult] = useState<FillResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  useEffect(() => { getCatalog().then(setCat).catch(() => setCat(null)); }, [demo, tick]);
  const months = useMemo(() => {
    if (!cat?.coverage.length) return [];
    return monthsInRange(cat.coverage[0].start, cat.coverage[cat.coverage.length - 1].end_exclusive).reverse();
  }, [cat]);
  useEffect(() => { if (!periodId && months.length) setPeriodId(months[0]); }, [months, periodId]);
  const period = periodId ? { start: `${periodId}-01`, end_exclusive: addMonths(`${periodId}-01`, 1), label: formatPeriod(`${periodId}-01`, addMonths(`${periodId}-01`, 1)) } : null;

  const onFile = async (file: File) => {
    setErr(null); setResult(null); setComputed({}); setSavedNote(null);
    if (!/\.xlsx$/i.test(file.name)) { setErr(/\.xlsm$/i.test(file.name) ? 'الملفات التي تحتوي ماكرو (xlsm) غير مدعومة للتعبئة الآمنة.' : 'ارفعي نموذجًا بصيغة XLSX.'); return; }
    if (file.size > 20 * 1024 * 1024) { setErr('حجم النموذج أكبر من 20 م.ب.'); return; }
    setReading(true);
    try {
      const buf = await file.arrayBuffer();
      const { scan } = await scanTemplate(buf);
      setLoaded({ file, buf, scan });
      let proposals = period ? proposeMappings(scan.targets, period) : [];
      // Reuse a confirmed mapping when the template structure matches exactly.
      if (!demo) {
        const { data } = await supabase().from('saved_items').select('payload').eq('kind', 'template_mapping').eq('structure_hash', scan.structureHash).order('created_at', { ascending: false }).limit(1).maybeSingle();
        const saved = (data?.payload as { maps?: CellMapping[] } | undefined)?.maps;
        if (saved && period) {
          proposals = proposals.map((p) => {
            const s = saved.find((x) => x.target.sheet === p.target.sheet && x.target.address === p.target.address);
            return s ? { ...s, target: p.target, request: s.request ? { ...s.request, start: period.start, end_exclusive: period.end_exclusive } : null } : p;
          });
          setSavedNote('طُبق الربط المحفوظ لهذا النموذج لأن بنيته مطابقة. راجعيه قبل التعبئة.');
        }
      }
      setMaps(proposals);
    } catch {
      setErr('تعذّر فتح النموذج. قد يكون محميًا بكلمة مرور أو تالفًا.');
    } finally { setReading(false); }
  };

  // Keep every mapped request on the selected period.
  useEffect(() => {
    if (!period) return;
    setMaps((m) => m.map((x) => (x.request ? { ...x, request: { ...x.request, start: period.start, end_exclusive: period.end_exclusive } } : x)));
    setComputed({}); setResult(null);
  }, [periodId]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (key: string, patch: Partial<CellMapping>) => {
    setMaps((m) => m.map((x) => (`${x.target.sheet}!${x.target.address}` === key ? { ...x, ...patch } : x)));
    setComputed((c) => { const n = { ...c }; delete n[key]; return n; });
    setResult(null);
  };

  const confirmed = maps.filter((m) => m.status === 'mapped' && m.request);
  const blocked = loaded?.scan.unsupported.length ? loaded.scan.unsupported : null;

  const compute = async () => {
    setBusy(true);
    const out: Computed = {};
    await Promise.all(confirmed.map(async (m) => {
      const key = `${m.target.sheet}!${m.target.address}`;
      try {
        const r = await queryMetric({ ...m.request!, group_by: [] });
        out[key] = { value: r.value, coverage: r.coverage.status };
      } catch { out[key] = 'error'; }
    }));
    setComputed(out);
    setBusy(false);
  };

  const fill = async () => {
    if (!loaded) return;
    setBusy(true);
    const values = confirmed.flatMap((m) => {
      const c = computed[`${m.target.sheet}!${m.target.address}`];
      return c && c !== 'error' && c.value != null ? [{ sheet: m.target.sheet, address: m.target.address, value: c.value }] : [];
    });
    try {
      const r = await fillTemplate(loaded.buf, values);
      setResult(r);
      if (r.verification.ok) cue('complete'); else cue('notice');
      if (!demo) {
        await supabase().from('saved_items').insert({ kind: 'template_mapping', title: loaded.file.name, structure_hash: loaded.scan.structureHash, payload: { maps } });
      }
    } catch { setErr('تعذّر إنشاء النسخة المعبأة.'); } finally { setBusy(false); }
  };

  const allComputed = confirmed.length > 0 && confirmed.every((m) => computed[`${m.target.sheet}!${m.target.address}`]);
  const missingValues = confirmed.filter((m) => { const c = computed[`${m.target.sheet}!${m.target.address}`]; return c === 'error' || (c && c.value == null); });

  return (
    <main className="page">
      <header className="page-head">
        <h1>تعبئة نموذج Excel</h1>
        <p>ارفعي النموذج الوارد كما هو. يُعرض ما فهمه التطبيق من كل خانة لتأكيده، ثم تُعبأ نسخة منه فقط، ويبقى الأصل دون تغيير.</p>
      </header>

      {!loaded && (
        <div className="reading card">
          <FileDrop accept=".xlsx" busy={reading} onFile={onFile} title="ارفعي النموذج" hint="XLSX حتى 20 م.ب" />
          {err && <div style={{ marginTop: 12 }}><Notice tone="danger">{err}</Notice></div>}
        </div>
      )}

      {loaded && (
        <section className="stack">
          <div className="reading card">
            <div className="row row--between">
              <h2 style={{ margin: 0 }}><bdi>{loaded.file.name}</bdi></h2>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setLoaded(null); setMaps([]); setResult(null); }}>نموذج آخر</button>
            </div>
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>الأوراق</dt><dd>{loaded.scan.sheets.map((s) => s.name).join('، ')}</dd>
              <dt>خلايا الصيغ</dt><dd><bdi className="num">{fmtNum(loaded.scan.formulaCells)}</bdi> — تُحفظ كما هي ويعيد Excel حسابها عند الفتح</dd>
              <dt>خانات مرشحة للتعبئة</dt><dd><bdi className="num">{fmtNum(loaded.scan.targets.length)}</bdi></dd>
            </dl>
            {blocked && <div style={{ marginTop: 10 }}><Notice tone="danger">يحتوي النموذج على: {blocked.join('، ')}. طريقة الحفظ الحالية لا تحافظ عليها بدقة، لذلك أُوقفت التعبئة حتى لا يتغير شكل النموذج الرسمي. يمكن استخراج الأرقام في تقرير جديد من صفحة «استخراج».</Notice></div>}
            {loaded.scan.features.images > 0 && !blocked && <div style={{ marginTop: 10 }}><Notice tone="warn">يحتوي النموذج على صور؛ افحصي موضعها في النسخة المعبأة قبل الإرسال.</Notice></div>}
            {savedNote && <div style={{ marginTop: 10 }}><Notice>{savedNote}</Notice></div>}
            <label className="field" style={{ marginTop: 12 }}><span>فترة النموذج</span>
              <select className="select" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
                {months.map((m) => <option key={m} value={m}>{formatPeriod(`${m}-01`, addMonths(`${m}-01`, 1))}</option>)}
              </select></label>
          </div>

          {!blocked && (
            <div className="reading card">
              <div className="row row--between">
                <h2 style={{ margin: 0 }}>الخانات</h2>
                <button type="button" className="btn btn--sm" disabled={!maps.some((m) => m.request && m.status === 'needs_review')}
                  onClick={() => setMaps((m) => m.map((x) => (x.request && x.status === 'needs_review' ? { ...x, status: 'mapped' } : x)))}>
                  <IconCheck aria-hidden />تأكيد كل المقترحات المفهومة
                </button>
              </div>
              {maps.length === 0 && <p className="muted">لم يُعثر على خانات فارغة لها عنوان صف وعنوان عمود. قد يحتاج هذا النموذج ربطًا يدويًا غير مدعوم بعد.</p>}
              <ul className="list">
                {maps.map((m) => {
                  const key = `${m.target.sheet}!${m.target.address}`;
                  const c = computed[key];
                  return (
                    <li key={key}>
                      <div className="row row--between">
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 'var(--fs-sm)' }}><bdi>{m.target.rowLabel}</bdi> × <bdi>{m.target.colLabel}</bdi></div>
                          <div className="faint" style={{ fontSize: 'var(--fs-xs)' }}><bdi dir="ltr">{key}</bdi> — {m.request ? requestTitle(m.request) : m.note ?? 'غير محددة'}</div>
                        </div>
                        <div className="row">
                          {c && c !== 'error' && <strong>{c.value == null ? 'غير متاح' : <bdi className="num">{fmtNum(c.value)}</bdi>}</strong>}
                          {c === 'error' && <Pill tone="danger">خطأ</Pill>}
                          <Pill tone={m.status === 'mapped' ? 'ok' : m.status === 'needs_review' ? 'warn' : 'neutral'}>{STATUS_LABEL[m.status]}</Pill>
                        </div>
                      </div>
                      <div className="row" style={{ marginTop: 6 }}>
                        <button type="button" className="btn btn--sm btn--quiet" aria-expanded={editing === key} onClick={() => setEditing(editing === key ? null : key)}>تعديل</button>
                        {m.status !== 'mapped' && m.request && <button type="button" className="btn btn--sm btn--quiet" onClick={() => update(key, { status: 'mapped' })}>تأكيد</button>}
                        {m.status !== 'skipped' && <button type="button" className="btn btn--sm btn--ghost" onClick={() => update(key, { status: 'skipped' })}>ترك الخانة</button>}
                      </div>
                      {editing === key && period && (
                        <div style={{ marginTop: 8, padding: 12, borderRadius: 14, background: 'var(--sunken)' }}>
                          <RequestEditor catalog={cat} showGroups={false} showPeriod={false}
                            value={m.request ?? ({ metric: 'visits', start: period.start, end_exclusive: period.end_exclusive, filters: {}, group_by: [] } as MetricRequest)}
                            onChange={(r) => update(key, { request: { ...r, group_by: [] }, status: 'mapped' })} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="row" style={{ marginTop: 12 }}>
                <button type="button" className="btn" disabled={busy || confirmed.length === 0} onClick={compute}>
                  {busy && !allComputed ? <IconSpinner aria-hidden className="spin" /> : null}احسبي {fmtNum(confirmed.length)} خانة
                </button>
                <button type="button" className="btn btn--primary" disabled={busy || !allComputed} onClick={fill}>تعبئة نسخة من النموذج</button>
              </div>
              {missingValues.length > 0 && <div style={{ marginTop: 10 }}><Notice tone="warn">{fmtNum(missingValues.length)} خانة بلا بيانات معتمدة لهذه الفترة؛ ستُترك فارغة ولن تُكتب صفرًا.</Notice></div>}
            </div>
          )}

          {result && (
            <div className="reading card" aria-live="polite">
              <h2>فحص النسخة المعبأة</h2>
              <ul className="list">
                {result.verification.checks.map((c) => (
                  <li key={c.label} className="row row--between"><span>{c.label}</span><Pill tone={c.ok ? 'ok' : 'danger'}>{c.ok ? 'سليم' : 'يحتاج مراجعة'}</Pill></li>
                ))}
              </ul>
              <p className="faint" style={{ fontSize: 'var(--fs-xs)' }}>كُتبت <bdi className="num">{fmtNum(result.written.length)}</bdi> خانة. نتائج الصيغ يعيد Excel حسابها عند فتح الملف؛ افتحيه وراجعي المجاميع قبل الإرسال.</p>
              <button type="button" className="btn btn--primary" onClick={() => downloadBuffer(result.buffer, loaded.file.name.replace(/\.xlsx$/i, ' - معبأ.xlsx'))}>
                <IconDownload aria-hidden />تنزيل النسخة المعبأة
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
