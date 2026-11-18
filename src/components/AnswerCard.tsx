import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { MetricResult } from '../lib/metrics/types';
import { DIMENSIONS, METRICS, sortKeys, valueLabel } from '../lib/metrics/catalog';
import { copyText, countParts, coverageText, exclusionNotes, filterPhrases, headline, periodText, requestTitle, sourceText } from '../lib/metrics/describe';
import { formatInstant } from '../lib/dates';
import { fmtNum, fmtPct } from '../lib/format';
import { usePrefs, useReducedMotionPref } from '../lib/prefs';
import { pinIndicator, setExportDraft } from '../lib/appState';
import { IconBookmark, IconCheck, IconCopy, IconExport, IconInfo } from './Icons';
import { Count, Pill } from './ui';

export function ResultTable({ res }: { res: MetricResult }) {
  const g = res.request.group_by;
  if (!g.length || !res.rows.length) return null;
  const unit = METRICS[res.request.metric].unitPlural;
  if (g.length === 1) {
    const total = res.request.metric === 'visits' ? res.rows.reduce((a, r) => a + r.value, 0) : null;
    return (
      <div className="table-scroll">
        <table className="data">
          <thead><tr><th scope="col">{DIMENSIONS[g[0]]}</th><th scope="col" className="n">{unit}</th>{total != null && <th scope="col" className="n">النسبة</th>}</tr></thead>
          <tbody>
            {sortKeys(g[0], res.rows.map((r) => r.d1!)).map((k) => res.rows.find((r) => r.d1 === k)!).map((r) => (
              <tr key={r.d1}><td>{valueLabel(g[0], r.d1)}</td><td className="n"><bdi className="num">{fmtNum(r.value)}</bdi></td>{total != null && <td className="n"><bdi className="num">{fmtPct(r.value, total)}</bdi></td>}</tr>
            ))}
          </tbody>
          {total != null && <tfoot><tr><td>الإجمالي</td><td className="n"><bdi className="num">{fmtNum(total)}</bdi></td><td className="n" /></tr></tfoot>}
        </table>
        {res.request.metric === 'distinct_patients' && <p className="faint" style={{ fontSize: 'var(--fs-xs)', margin: '6px 0 0' }}>لا تُجمع أعداد المرضى بين الفئات؛ قد يظهر المريض في أكثر من فئة.</p>}
      </div>
    );
  }
  const cols = sortKeys(g[1], [...new Set(res.rows.map((r) => r.d2!))]);
  const rowsKeys = sortKeys(g[0], [...new Set(res.rows.map((r) => r.d1!))]);
  const get = (a: string, b: string) => res.rows.find((r) => r.d1 === a && r.d2 === b)?.value ?? 0;
  return (
    <div className="table-scroll">
      <table className="data">
        <thead><tr><th scope="col">{DIMENSIONS[g[0]]}</th>{cols.map((c) => <th key={c} scope="col" className="n">{valueLabel(g[1], c)}</th>)}</tr></thead>
        <tbody>{rowsKeys.map((k) => <tr key={k}><td>{valueLabel(g[0], k)}</td>{cols.map((c) => <td key={c} className="n"><bdi className="num">{fmtNum(get(k, c))}</bdi></td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Value({ res }: { res: MetricResult }) {
  const reduced = useReducedMotionPref();
  const text = headline(res);
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.p
        key={text}
        className={`answer__value${res.value == null ? ' answer__value--na' : ''}`}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduced ? 0.1 : 0.18, ease: [0.23, 1, 0.32, 1] }}
      >
        {countParts(res) ? <Count {...countParts(res)!} /> : text}
      </motion.p>
    </AnimatePresence>
  );
}

export function AnswerCard({ results, assumptions = [], note, interpretation }: { results: MetricResult[]; assumptions?: string[]; note?: string; interpretation?: string }) {
  const showSources = usePrefs((p) => p.showSources);
  const detailed = usePrefs((p) => p.answerDetail === 'detailed');
  const [open, setOpen] = useState(detailed);
  const [copied, setCopied] = useState(false);
  const [pinned, setPinned] = useState(false);
  const main = results[0];
  const cov = coverageText(main);
  const notes = [...exclusionNotes(main), ...assumptions];
  const compare = results.length === 2 ? results : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(results.map(copyText).join('\n\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked */ }
  };

  return (
    <article className="answer reading" aria-live="polite">
      <p className="answer__title">{requestTitle(main.request)}</p>
      {compare ? (
        <div className="answer__compare">
          {compare.map((r) => (
            <div key={r.request.start}>
              <div className="answer__period">{periodText(r.request)}</div>
              <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, lineHeight: 1.25 }}>{countParts(r) ? <Count {...countParts(r)!} /> : <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>غير متاح</span>}</div>
              <div style={{ marginTop: 4 }}><Pill tone={coverageText(r).tone === 'ok' ? 'ok' : coverageText(r).tone === 'warn' ? 'warn' : 'none'}>{coverageText(r).tone === 'ok' ? 'مكتملة' : coverageText(r).tone === 'warn' ? 'جزئية' : 'غير مغطاة'}</Pill></div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <Value res={main} />
          <div className="answer__period">{periodText(main.request)}</div>
        </>
      )}
      {compare && compare[0].value != null && compare[1].value != null && (
        <p className="answer__delta">
          الفرق: <bdi className="num">{fmtNum(compare[0].value - compare[1].value)}</bdi>
          {compare[1].value !== 0 && <> (<bdi className="num">{fmtNum(Math.round(((compare[0].value - compare[1].value) / compare[1].value) * 1000) / 10)}٪</bdi>)</>}
          {(compare[0].coverage.status !== 'complete' || compare[1].coverage.status !== 'complete') && <span className="muted"> — المقارنة جزئية لعدم اكتمال إحدى الفترتين.</span>}
        </p>
      )}
      {!compare && main.value != null && <div style={{ marginTop: 10 }}><ResultTable res={main} /></div>}

      {showSources && (
        <div className="answer__meta">
          <Pill tone={cov.tone === 'ok' ? 'ok' : cov.tone === 'warn' ? 'warn' : 'none'}>{cov.text}</Pill>
          <span>{sourceText(main)}</span>
        </div>
      )}
      {(notes.length > 0 || note) && (
        <ul className="answer__meta" style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 2 }}>
          {notes.map((n) => <li key={n}>{n}</li>)}
          {note && <li>{note}</li>}
        </ul>
      )}

      {open && (
        <dl className="answer__details">
          {interpretation && <><dt>ما فُهم من السؤال</dt><dd>{interpretation}</dd></>}
          <dt>وحدة العد</dt><dd>{METRICS[main.request.metric].definition}</dd>
          <dt>الفترة</dt><dd>من بداية {main.request.start} حتى ما قبل {main.request.end_exclusive} بتوقيت الرياض</dd>
          <dt>المرشحات</dt><dd>{filterPhrases(main.request.filters).join('، ') || 'بلا مرشحات'}</dd>
          <dt>المصادر</dt><dd>{main.sources.map((s) => s.file_name).join('، ') || '—'}</dd>
          <dt>الإصدارات</dt><dd>بيانات <bdi className="num">{fmtNum(main.dataset_version)}</bdi> — تعريف المؤشر <bdi className="num">{fmtNum(main.definition_version)}</bdi></dd>
          <dt>وقت الحساب</dt><dd>{formatInstant(main.extracted_at)}</dd>
        </dl>
      )}

      <div className="answer__actions">
        <button type="button" className="btn btn--sm btn--quiet" onClick={copy}>{copied ? <IconCheck aria-hidden /> : <IconCopy aria-hidden />}{copied ? 'نُسخ' : 'نسخ'}</button>
        <button type="button" className="btn btn--sm btn--quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)}><IconInfo aria-hidden />{open ? 'إخفاء الطريقة' : 'طريقة الحساب'}</button>
        <button type="button" className="btn btn--sm btn--quiet" disabled={pinned} onClick={() => { pinIndicator({ id: crypto.randomUUID(), title: requestTitle(main.request), request: main.request }); setPinned(true); }}>
          <IconBookmark aria-hidden />{pinned ? 'أُضيف للمؤشرات' : 'إضافة للمؤشرات'}
        </button>
        <button type="button" className="btn btn--sm btn--quiet" onClick={() => setExportDraft(main.request)}><IconExport aria-hidden />استخراج Excel</button>
      </div>
    </article>
  );
}
