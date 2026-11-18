import { useEffect, useRef, useState, type FormEvent } from 'react';
import { RequestEditor } from '../components/RequestEditor';
import { ResultTable } from '../components/AnswerCard';
import { IconDownload, IconSpinner } from '../components/Icons';
import { Count, Notice, Pill } from '../components/ui';
import { askAssistant, getCatalog, queryMetric } from '../lib/metrics/engine';
import type { DataCatalog, MetricRequest, MetricResult } from '../lib/metrics/types';
import { countParts, coverageText, exclusionNotes, headline, periodText, requestTitle } from '../lib/metrics/describe';
import { buildReportWorkbook, downloadBuffer } from '../lib/excel/report';
import { addMonths, todayRiyadh } from '../lib/dates';
import { setExportDraft, useApp } from '../lib/appState';
import { usePrefs } from '../lib/prefs';
import { cue } from '../lib/sound';

function defaultRequest(cat: DataCatalog | null): MetricRequest {
  const end = cat?.coverage.length ? cat.coverage[cat.coverage.length - 1].end_exclusive : `${todayRiyadh().slice(0, 7)}-01`;
  const monthStart = `${end.slice(0, 7)}-01` === end ? addMonths(end, -1) : `${end.slice(0, 7)}-01`;
  return { metric: 'visits', start: monthStart, end_exclusive: addMonths(monthStart, 1), filters: { encounter_type: ['Emergency'] }, group_by: ['age_band', 'gender'] };
}

export function ExportPage() {
  const demo = usePrefs((p) => p.demoMode);
  const draft = useApp((s) => s.exportDraft);
  const tick = useApp((s) => s.datasetTick);
  const [cat, setCat] = useState<DataCatalog | null>(null);
  const [req, setReq] = useState<MetricRequest | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [understanding, setUnderstanding] = useState<string | null>(null);
  const [res, setRes] = useState<MetricResult | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [building, setBuilding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => { getCatalog().then(setCat).catch(() => setCat(null)); }, [demo, tick]);
  useEffect(() => { if (!req && cat) setReq(defaultRequest(cat)); }, [cat, req]);
  useEffect(() => {
    if (draft) { setReq({ ...draft, group_by: draft.group_by.length ? draft.group_by : ['encounter_type'] }); setTitle(''); setExportDraft(null); }
  }, [draft]);

  // Preview always reflects the latest request; older responses are dropped.
  useEffect(() => {
    if (!req || !req.start || !req.end_exclusive || req.end_exclusive <= req.start) return;
    const id = ++seq.current;
    setState('loading');
    const t = setTimeout(() => {
      queryMetric(req).then((r) => { if (id === seq.current) { setRes(r); setState('idle'); } })
        .catch(() => { if (id === seq.current) setState('error'); });
    }, 200);
    return () => clearTimeout(t);
  }, [req, tick]);

  const describe = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setUnderstanding('جارٍ فهم الطلب…');
    const reply = await askAssistant(text, req).catch(() => null);
    if (reply?.kind === 'answer') {
      const r = reply.results[0].request;
      setReq({ ...r, group_by: r.group_by.length ? r.group_by : req?.group_by ?? [] });
      setUnderstanding(reply.interpretation || requestTitle(r));
      setTitle('');
    } else if (reply?.kind === 'clarify') setUnderstanding(reply.question);
    else if (reply?.kind === 'unsupported') setUnderstanding(reply.reason);
    else setUnderstanding('تعذّر فهم الطلب؛ حددي الأعمدة من الخيارات أدناه.');
  };

  const build = async () => {
    if (!res) return;
    setBuilding(true); setMsg(null);
    try {
      const buf = await buildReportWorkbook(res, title);
      const name = `${(title.trim() || requestTitle(res.request)).replace(/[\\/:*?"<>|]/g, '').slice(0, 80)} - ${res.request.start}.xlsx`;
      downloadBuffer(buf, name);
      cue('complete');
      setMsg('جُهز الملف ونُزّل على جهازك. لم يُرسل لأي جهة.');
    } catch {
      setMsg('تعذّر إنشاء الملف.');
    } finally { setBuilding(false); }
  };

  return (
    <main className="page">
      <header className="page-head">
        <h1>استخراج تقرير Excel</h1>
        <p>صفي التقرير أو اختاري أعمدته، وراجعي المعاينة قبل الإنشاء. الأرقام من محرك المؤشرات نفسه المستخدم في المحادثة.</p>
      </header>

      <form className="composer glass" onSubmit={describe} style={{ marginBottom: 12 }}>
        <label htmlFor="exq" className="sr-only">وصف التقرير</label>
        <textarea id="exq" rows={1} dir="auto" placeholder="مثال: زيارات الطوارئ في يوليو 2026 لمن أعمارهم 18 فأكثر حسب الجنس" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn--primary" type="submit" disabled={!text.trim()}>فهم</button>
      </form>
      {understanding && <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>{understanding}</p>}

      {req && (
        <section className="reading card">
          <h2>إعداد التقرير</h2>
          <label className="field" style={{ marginBottom: 12 }}><span>عنوان التقرير</span>
            <input className="input" value={title} placeholder={requestTitle(req)} onChange={(e) => setTitle(e.target.value)} /></label>
          <RequestEditor value={req} onChange={setReq} catalog={cat} />
        </section>
      )}

      <section className="reading card" aria-live="polite">
        <div className="row row--between">
          <h2 style={{ margin: 0 }}>معاينة</h2>
          {state === 'loading' && <Pill>يُحسب…</Pill>}
        </div>
        {state === 'error' && <Notice tone="danger">تعذّر حساب المعاينة.</Notice>}
        {res && (
          <>
            <p style={{ margin: '8px 0 2px' }}><strong>{title.trim() || requestTitle(res.request)}</strong></p>
            <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>{periodText(res.request)} — الإجمالي: {countParts(res) ? <Count {...countParts(res)!} /> : headline(res)}</p>
            <div className="row" style={{ margin: '8px 0' }}>
              <Pill tone={coverageText(res).tone === 'ok' ? 'ok' : coverageText(res).tone === 'warn' ? 'warn' : 'none'}>{coverageText(res).text}</Pill>
              {exclusionNotes(res).map((n) => <span key={n} className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{n}</span>)}
            </div>
            {res.value != null && <ResultTable res={res} />}
            <div className="row" style={{ marginTop: 14 }}>
              <button type="button" className="btn btn--primary" disabled={building || res.value == null || state === 'loading'} onClick={build}>
                {building ? <IconSpinner aria-hidden className="spin" /> : <IconDownload aria-hidden />}إنشاء ملف Excel
              </button>
            </div>
            {msg && <p className="muted" role="status" style={{ fontSize: 'var(--fs-sm)' }}>{msg}</p>}
          </>
        )}
      </section>
    </main>
  );
}
