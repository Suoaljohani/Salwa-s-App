import { useEffect, useRef, useState, type FormEvent } from 'react';
import { RequestEditor, newRequest } from '../components/RequestEditor';
import { ResultTable } from '../components/AnswerCard';
import { IconDownload, IconSpinner } from '../components/Icons';
import { Empty, Notice, Pill } from '../components/ui';
import { askAssistant, queryStat } from '../lib/metrics/engine';
import type { StatRequest, StatResult } from '../lib/metrics/types';
import { coverageText, exclusionNotes, headline, periodText, requestTitle } from '../lib/metrics/describe';
import { buildReportWorkbook, downloadBuffer } from '../lib/excel/report';
import { setExportDraft, useApp } from '../lib/appState';
import { useCatalog } from '../lib/catalogStore';
import { cue } from '../lib/sound';

export function ExportPage() {
  const draft = useApp((s) => s.exportDraft);
  const { catalog } = useCatalog();
  const [req, setReq] = useState<StatRequest | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [understanding, setUnderstanding] = useState<string | null>(null);
  const [res, setRes] = useState<StatResult | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [building, setBuilding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const seq = useRef(0);
  const ds = catalog?.datasets.find((d) => d.id === req?.dataset_id);

  useEffect(() => { if (catalog && (!req || !catalog.datasets.some((d) => d.id === req.dataset_id))) setReq(newRequest(catalog)); }, [catalog, req]);
  useEffect(() => {
    if (draft) { setReq(draft); setTitle(''); setExportDraft(null); }
  }, [draft]);

  // Preview always reflects the latest request; older responses are dropped.
  useEffect(() => {
    if (!req) return;
    if (req.period && (!req.period.start || !req.period.end_exclusive || req.period.end_exclusive <= req.period.start)) return;
    const id = ++seq.current;
    setState('loading');
    const t = setTimeout(() => {
      queryStat(req).then((r) => { if (id === seq.current) { setRes(r); setState('idle'); } })
        .catch(() => { if (id === seq.current) setState('error'); });
    }, 200);
    return () => clearTimeout(t);
  }, [req, catalog?.version]);

  const describe = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setUnderstanding('جارٍ فهم الطلب…');
    const reply = await askAssistant(text, req).catch(() => null);
    if (reply?.kind === 'answer') {
      const r = reply.results[0].request;
      setReq(r);
      setUnderstanding(reply.interpretation || requestTitle(catalog?.datasets.find((d) => d.id === r.dataset_id), r));
      setTitle('');
    } else if (reply?.kind === 'clarify') setUnderstanding(reply.question);
    else if (reply?.kind === 'unsupported') setUnderstanding(reply.reason);
    else setUnderstanding('تعذّر فهم الطلب؛ حددي الأعمدة من الخيارات أدناه.');
  };

  const build = async () => {
    if (!res) return;
    setBuilding(true); setMsg(null);
    try {
      const buf = await buildReportWorkbook(res, ds, title);
      const name = `${(title.trim() || requestTitle(ds, res.request)).replace(/[\\/:*?"<>|]/g, '').slice(0, 80)}.xlsx`;
      cue('complete');
      const how = await downloadBuffer(buf, name);
      setMsg(how === 'cancelled' ? 'جُهز الملف؛ أُغلقت نافذة الحفظ دون اختيار مكان.' : 'جُهز الملف. لم يُرسل لأي جهة إلا بما تختارينه.');
    } catch {
      setMsg('تعذّر إنشاء الملف.');
    } finally { setBuilding(false); }
  };

  return (
    <main className="page">
      <header className="page-head">
        <h1>استخراج تقرير Excel</h1>
        <p>صفي التقرير أو اختاري أعمدته من أي قاعدة بيانات معتمدة، وراجعي المعاينة قبل الإنشاء. الأرقام من المحرك نفسه المستخدم في المحادثة.</p>
      </header>

      {catalog && !catalog.datasets.some((d) => d.row_count > 0) && <div className="reading card"><Empty title="لا توجد بيانات معتمدة بعد">ارفعي ملفًا من صفحة البيانات أولًا.</Empty></div>}

      <form className="composer glass" onSubmit={describe} style={{ marginBottom: 12 }}>
        <label htmlFor="exq" className="sr-only">وصف التقرير</label>
        <textarea id="exq" rows={1} dir="auto" placeholder="مثال: عدد الموظفين حسب القسم والجنس" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn--primary" type="submit" disabled={!text.trim()}>فهم</button>
      </form>
      {understanding && <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>{understanding}</p>}

      {req && (
        <section className="reading card">
          <h2>إعداد التقرير</h2>
          <label className="field" style={{ marginBottom: 12 }}><span>عنوان التقرير</span>
            <input className="input" value={title} placeholder={requestTitle(ds, req)} onChange={(e) => setTitle(e.target.value)} /></label>
          <RequestEditor value={req} onChange={setReq} catalog={catalog} />
        </section>
      )}

      <section className="reading card" aria-live="polite">
        <div className="row row--between">
          <h2 style={{ margin: 0 }}>معاينة</h2>
          {state === 'loading' && <Pill>يُحسب…</Pill>}
        </div>
        {state === 'error' && <Notice tone="danger">تعذّر حساب المعاينة. تحققي من المرشحات.</Notice>}
        {res && (
          <>
            <p style={{ margin: '8px 0 2px' }}><strong>{title.trim() || requestTitle(ds, res.request)}</strong></p>
            <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>{res.dataset.name} — {periodText(res)} — الإجمالي: <bdi className="num">{headline(res)}</bdi></p>
            <div className="row" style={{ margin: '8px 0' }}>
              <Pill tone={coverageText(res).tone === 'ok' ? 'ok' : coverageText(res).tone === 'warn' ? 'warn' : 'none'}>{coverageText(res).text}</Pill>
              {exclusionNotes(res).map((n) => <span key={n} className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{n}</span>)}
            </div>
            {res.value != null && <ResultTable res={res} ds={ds} />}
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
