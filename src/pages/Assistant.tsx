import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { AnswerCard } from '../components/AnswerCard';
import { IconSend, IconSpinner, IconTrash } from '../components/Icons';
import { Notice } from '../components/ui';
import { askAssistant, type AssistantReply } from '../lib/metrics/engine';
import { useCatalog } from '../lib/catalogStore';
import type { Catalog, StatRequest } from '../lib/metrics/types';
import { USER_NAME } from '../lib/config';
import { addDays, addMonths } from '../lib/dates';
import { monthLabel, keyLabel } from '../lib/metrics/catalog';
import { fmtNum } from '../lib/format';
import { usePrefs } from '../lib/prefs';

interface Turn { id: string; question: string; reply: AssistantReply | null; context: StatRequest | null }

const HISTORY_KEY = 'salwa.chat.v2';
/** Suggestions built from the approved datasets, so they never point at missing data. */
function suggestions(cat: Catalog | null): string[] {
  const out: string[] = [];
  for (const d of cat?.datasets.filter((x) => x.row_count > 0) ?? []) {
    const unitPl = d.unit_label === 'زيارة' ? 'الزيارات' : d.unit_label === 'موظف' ? 'الموظفين' : d.name;
    const dim = d.columns.find((c) => c.role === 'dimension' && (c.values?.length ?? 0) >= 2 && (c.values?.length ?? 0) <= 12);
    const dim2 = d.columns.find((c) => c.role === 'dimension' && c !== dim && (c.values?.length ?? 0) >= 2 && (c.values?.length ?? 0) <= 12);
    let when = '';
    if (d.period_column && d.coverage.length) {
      const end = d.coverage[d.coverage.length - 1].end_exclusive;
      if (end) {
        const last = addDays(end, -1);
        const month = addDays(last, 1).endsWith('-01') ? last.slice(0, 7) : addMonths(`${last.slice(0, 7)}-01`, -1).slice(0, 7);
        when = ` في ${monthLabel(month)}`;
      }
    }
    out.push(`كم عدد ${unitPl}${when}؟`);
    if (dim) out.push(`وزعي ${unitPl} حسب ${dim.label}${when}`);
    if (dim2 && dim?.values?.[0]) out.push(`كم عدد ${unitPl} ${keyLabel(dim, undefined, dim.values[0].value)} حسب ${dim2.label}${when}`);
  }
  return out.slice(0, 5);
}

function loadHistory(): Turn[] {
  try {
    const t = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as Turn[];
    return t.filter((x) => x.reply && x.reply.kind !== 'error').slice(-20);
  } catch { return []; }
}

export function AssistantPage(_: { onOpenIndicators: () => void; onExport: () => void }) {
  const demo = usePrefs((p) => p.demoMode);
  const [turns, setTurns] = useState<Turn[]>(() => (demo ? [] : loadHistory()));
  const [text, setText] = useState('');
  const { catalog, state: catState } = useCatalog();
  const catalogError = catState === 'error';
  const pending = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);


  useEffect(() => { setTurns(demo ? [] : loadHistory()); }, [demo]);
  useEffect(() => {
    if (demo) return;
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(turns.filter((t) => t.reply).slice(-20))); } catch { /* ignore */ }
  }, [turns, demo]);
  useEffect(() => () => pending.current?.abort(), []);

  const lastContext = (() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const r = turns[i].reply;
      if (r?.kind === 'answer') return r.results[0].request as StatRequest;
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

  const ready = catalog?.datasets.filter((d) => d.row_count > 0) ?? [];
  const coverageLine = catalog
    ? ready.length
      ? `البيانات المعتمدة: ${ready.map((d) => `${d.name} (${fmtNum(d.row_count)} ${d.unit_label})`).join('، ')}`
      : 'لا توجد بيانات معتمدة بعد — ابدئي من صفحة البيانات'
    : catalogError ? 'تعذّر قراءة حالة البيانات' : '';

  return (
    <main className="page assistant">
      {turns.length === 0 ? (
        <section className="welcome">
          <h1>أهلًا {USER_NAME}،<br />ما الإحصائية التي تحتاجينها؟</h1>
          <p>اسألي بالعربية عن أي بيانات معتمدة — الزيارات، الموظفون، أو غيرها — وستصلك الإجابة بالرقم ووحدته وفترته ومصدره.</p>
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
  if (/dataset_has_no_period/.test(m)) return 'هذه البيانات لقطة بلا فترة زمنية.';
  if (/measure_needs_number/.test(m)) return 'المتوسط والمجموع يحتاجان عمودًا رقميًا.';
  if (/unsupported_/.test(m)) return 'الطلب يحتوي على حقل غير مدعوم.';
  if (/Failed to fetch|NetworkError/.test(m)) return 'تحققي من الاتصال بالإنترنت.';
  return '';
}
