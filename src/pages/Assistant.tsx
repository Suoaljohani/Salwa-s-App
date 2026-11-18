import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { AnswerCard } from '../components/AnswerCard';
import { IconSend, IconSpinner, IconTrash } from '../components/Icons';
import { Notice } from '../components/ui';
import { askAssistant, getCatalog, type AssistantReply } from '../lib/metrics/engine';
import type { DataCatalog, MetricRequest } from '../lib/metrics/types';
import { USER_NAME } from '../lib/config';
import { addDays, addMonths, formatPeriod } from '../lib/dates';
import { monthLabel } from '../lib/metrics/catalog';
import { fmtNum } from '../lib/format';
import { useApp } from '../lib/appState';
import { usePrefs } from '../lib/prefs';

interface Turn { id: string; question: string; reply: AssistantReply | null; context: MetricRequest | null }

const HISTORY_KEY = 'salwa.chat.v1';
/** Suggestions point at the latest fully covered month, so they never land on an empty period. */
function suggestions(cat: DataCatalog | null): string[] {
  const end = cat?.coverage.length ? cat.coverage[cat.coverage.length - 1].end_exclusive : null;
  const last = end ? addDays(end, -1) : null;
  const month = last ? (addDays(last, 1).endsWith('-01') ? last.slice(0, 7) : addMonths(`${last.slice(0, 7)}-01`, -1).slice(0, 7)) : null;
  const m = month ? monthLabel(month) : 'الشهر الماضي';
  return [
    `كم عدد زيارات الطوارئ في ${m} لمن أعمارهم 18 سنة فأكثر؟`,
    `وزعي زيارات الطوارئ حسب الجنس في ${m}`,
    `كم عدد المرضى المختلفين الذين راجعوا الطوارئ في ${m}؟`,
    `وزعي زيارات العيادات حسب القسم في ${m}`,
  ];
}

function loadHistory(): Turn[] {
  try {
    const t = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as Turn[];
    return t.filter((x) => x.reply && x.reply.kind !== 'error').slice(-20);
  } catch { return []; }
}

export function AssistantPage(_: { onOpenIndicators: () => void; onExport: () => void }) {
  const demo = usePrefs((p) => p.demoMode);
  const tick = useApp((s) => s.datasetTick);
  const [turns, setTurns] = useState<Turn[]>(() => (demo ? [] : loadHistory()));
  const [text, setText] = useState('');
  const [catalog, setCatalog] = useState<DataCatalog | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    setCatalogError(false);
    getCatalog().then((c) => alive && setCatalog(c)).catch(() => alive && setCatalogError(true));
    return () => { alive = false; };
  }, [demo, tick]);

  useEffect(() => { setTurns(demo ? [] : loadHistory()); }, [demo]);
  useEffect(() => {
    if (demo) return;
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(turns.filter((t) => t.reply).slice(-20))); } catch { /* ignore */ }
  }, [turns, demo]);
  useEffect(() => () => pending.current?.abort(), []);

  const lastContext = (() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const r = turns[i].reply;
      if (r?.kind === 'answer') return r.results[0].request;
    }
    return null;
  })();

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question) return;
    pending.current?.abort();
    const ctrl = new AbortController();
    pending.current = ctrl;
    const id = crypto.randomUUID();
    const context = lastContext;
    setTurns((t) => [...t, { id, question, reply: null, context }]);
    setText('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end' }));
    let reply: AssistantReply;
    try {
      reply = await askAssistant(question, context, ctrl.signal);
    } catch (e) {
      if (ctrl.signal.aborted) {
        setTurns((t) => t.filter((x) => x.id !== id));
        return;
      }
      reply = { kind: 'error', message: (e as Error).message };
    }
    if (ctrl.signal.aborted) return;
    setTurns((t) => t.map((x) => (x.id === id ? { ...x, reply } : x)));
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }));
  };

  const onSubmit = (e: FormEvent) => { e.preventDefault(); void ask(text); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(text); }
  };
  const busy = turns.some((t) => !t.reply);

  const coverageLine = catalog
    ? catalog.coverage.length
      ? `آخر تحديث معتمد: ${formatPeriod(catalog.coverage[0].start, catalog.coverage[catalog.coverage.length - 1].end_exclusive)} — ${fmtNum(catalog.total_visits)} زيارة`
      : 'لا توجد بيانات معتمدة بعد — ابدئي من صفحة البيانات'
    : catalogError ? 'تعذّر قراءة حالة البيانات' : '';

  return (
    <main className="page assistant">
      {turns.length === 0 ? (
        <section className="welcome">
          <h1>أهلًا {USER_NAME}،<br />ما الإحصائية التي تحتاجينها؟</h1>
          <p>اسألي بالعربية، وستصلك الإجابة بالرقم ووحدته وفترته ومصدره.</p>
        </section>
      ) : (
        <section className="thread" aria-label="المحادثة">
          <div className="row row--between">
            <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>المحادثة الحالية</span>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => { pending.current?.abort(); setTurns([]); }}><IconTrash aria-hidden />محادثة جديدة</button>
          </div>
          {turns.map((t) => (
            <div key={t.id} className="stack">
              <p className="msg-user">{t.question}</p>
              <Reply turn={t} onPick={(o) => ask(`${t.question} — ${o}`)} />
            </div>
          ))}
          <div ref={endRef} />
        </section>
      )}

      <div className="composer-wrap">
        {turns.length === 0 && (
          <div className="suggestions" role="group" aria-label="أسئلة مقترحة">
            {suggestions(catalog).map((s) => <button key={s} type="button" className="chip" onClick={() => ask(s)}>{s}</button>)}
          </div>
        )}
        <form className="composer glass" onSubmit={onSubmit}>
          <label htmlFor="q" className="sr-only">سؤالك</label>
          <textarea
            id="q" ref={inputRef} rows={1} value={text} placeholder="اكتبي سؤالك…" dir="auto" enterKeyHint="send"
            onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`; }}
            onKeyDown={onKey}
          />
          <button type="submit" className="btn btn--primary" aria-label="إرسال" disabled={!text.trim()}>
            {busy ? <IconSpinner aria-hidden className="spin" /> : <IconSend aria-hidden />}
          </button>
        </form>
        {turns.length === 0 && <p className="coverage-line">{coverageLine}</p>}
      </div>
    </main>
  );
}

function Reply({ turn, onPick }: { turn: Turn; onPick: (o: string) => void }) {
  const r = turn.reply;
  if (!r) {
    return (
      <div className="answer reading" aria-busy="true" aria-label="جارٍ الحساب">
        <div className="skeleton" style={{ height: 14, width: '55%' }} />
        <div className="skeleton" style={{ height: 40, width: '35%', marginTop: 12 }} />
        <div className="skeleton" style={{ height: 12, width: '45%', marginTop: 12 }} />
      </div>
    );
  }
  switch (r.kind) {
    case 'answer':
      return <AnswerCard results={r.results} assumptions={r.assumptions} note={r.note} interpretation={r.interpretation} />;
    case 'clarify':
      return (
        <div className="answer reading">
          <p style={{ margin: 0 }}>{r.question}</p>
          {r.options.length > 0 && <div className="chips" style={{ marginTop: 10 }}>{r.options.map((o) => <button key={o} type="button" className="chip" onClick={() => onPick(o)}>{o}</button>)}</div>}
        </div>
      );
    case 'unsupported':
      return <Notice tone="warn">{r.reason}</Notice>;
    case 'rate_limited':
      return <Notice tone="warn">بلغت خدمة الفهم الذكي حد الاستخدام المجاني مؤقتًا. أعيدي المحاولة بعد <bdi className="num">{fmtNum(r.retryAfter)}</bdi> ثانية تقريبًا.</Notice>;
    case 'error':
      return <Notice tone="danger">تعذّر حساب الإجابة. {friendlyError(r.message)}</Notice>;
  }
}

function friendlyError(m: string): string {
  if (/forbidden/.test(m)) return 'الحساب غير مصرح له.';
  if (/bad_dates/.test(m)) return 'الفترة غير صالحة.';
  if (/unsupported_/.test(m)) return 'الطلب يحتوي على حقل غير مدعوم.';
  if (/Failed to fetch|NetworkError/.test(m)) return 'تحققي من الاتصال بالإنترنت.';
  return '';
}
