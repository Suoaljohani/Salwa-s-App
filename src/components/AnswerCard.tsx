import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { DatasetInfo, StatResult } from '../lib/metrics/types';
import { MEASURE_LABEL, colOf, keyLabel, sortKeys } from '../lib/metrics/catalog';
import { copyText, coverageText, exclusionNotes, filterPhrase, fmtValue, headline, measurePhrase, periodText, requestTitle, sourceText, valueUnit } from '../lib/metrics/describe';
import { formatInstant } from '../lib/dates';
import { fmtNum } from '../lib/format';
import { usePrefs, useReducedMotionPref } from '../lib/prefs';
import { pinIndicator, setExportDraft } from '../lib/appState';
import { useDataset } from '../lib/catalogStore';
import { IconBookmark, IconCheck, IconCopy, IconExport, IconInfo } from './Icons';
import { Pill } from './ui';

export function ResultTable({ res, ds }: { res: StatResult; ds: DatasetInfo | undefined }) {
  const g = res.request.group_by;
  if (!g.length || !res.rows.length) return null;
  const additive = res.request.measure.op === 'count' || res.request.measure.op === 'sum';
  const c1 = colOf(ds, g[0].column), c2 = g[1] ? colOf(ds, g[1].column) : undefined;
  const head = res.request.measure.op === 'count' ? res.dataset.unit_label : MEASURE_LABEL[res.request.measure.op];
  if (g.length === 1) {
    const total = additive ? res.rows.reduce((a, r) => a + r.value, 0) : null;
    const keys = sortKeys(c1, g[0], res.rows.map((r) => r.d1!));
    return (
      <div className="table-scroll">
        <table className="data">
          <thead><tr><th scope="col">{c1?.label}</th><th scope="col" className="n">{head}</th>{total != null && res.request.measure.op === 'count' && <th scope="col" className="n">النسبة</th>}</tr></thead>
          <tbody>
            {keys.map((k) => { const r = res.rows.find((x) => x.d1 === k)!; return (
              <tr key={k}><td>{keyLabel(c1, g[0], k)}</td><td className="n"><bdi className="num">{fmtValue(res, r.value)}</bdi></td>
                {total != null && res.request.measure.op === 'count' && <td className="n"><bdi className="num">{total ? `${fmtNum(Math.round((r.value / total) * 1000) / 10)}٪` : '—'}</bdi></td>}</tr>
            ); })}
          </tbody>
          {total != null && <tfoot><tr><td>الإجمالي</td><td className="n"><bdi className="num">{fmtValue(res, total)}</bdi></td>{res.request.measure.op === 'count' && <td />}</tr></tfoot>}
        </table>
        {!additive && <p className="faint" style={{ fontSize: 'var(--fs-xs)', margin: '6px 0 0' }}>{res.request.measure.op === 'count_distinct' ? 'لا تُجمع الأعداد المميزة بين الفئات؛ قد يظهر العنصر نفسه في أكثر من فئة.' : 'القيم لكل فئة على حدة.'}</p>}
      </div>
    );
  }
  const cols = sortKeys(c2, g[1], [...new Set(res.rows.map((r) => r.d2!))]);
  const rows = sortKeys(c1, g[0], [...new Set(res.rows.map((r) => r.d1!))]);
  const get = (a: string, b: string) => res.rows.find((r) => r.d1 === a && r.d2 === b)?.value ?? (additive ? 0 : null);
  return (
    <div className="table-scroll">
      <table className="data">
        <thead><tr><th scope="col">{c1?.label}</th>{cols.map((c) => <th key={c} scope="col" className="n">{keyLabel(c2, g[1], c)}</th>)}</tr></thead>
        <tbody>{rows.map((k) => <tr key={k}><td>{keyLabel(c1, g[0], k)}</td>{cols.map((c) => <td key={c} className="n"><bdi className="num">{fmtValue(res, get(k, c))}</bdi></td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Value({ res }: { res: StatResult }) {
  const reduced = useReducedMotionPref();
  const text = headline(res);
  const unit = valueUnit(res);
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.p key={text} className={`answer__value${res.value == null ? ' answer__value--na' : ''}`}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
        transition={{ duration: reduced ? 0.1 : 0.18, ease: [0.23, 1, 0.32, 1] }}>
        {res.value == null ? text : <span><bdi className="num">{fmtValue(res, res.value)}</bdi>{unit ? ` ${unit}` : ''}</span>}
      </motion.p>
    </AnimatePresence>
  );
}

export function AnswerCard({ results, assumptions = [], note, interpretation }: { results: StatResult[]; assumptions?: string[]; note?: string; interpretation?: string }) {
  const showSources = usePrefs((p) => p.showSources);
  const detailed = usePrefs((p) => p.answerDetail === 'detailed');
  const [open, setOpen] = useState(detailed);
  const [copied, setCopied] = useState(false);
  const [pinned, setPinned] = useState(false);
  const main = results[0];
  const ds = useDataset(main.dataset.id);
  const cov = coverageText(main);
  const notes = [...exclusionNotes(main), ...assumptions];
  const compare = results.length === 2 ? results : null;
  const tone = (t: string) => (t === 'ok' ? 'ok' : t === 'warn' ? 'warn' : 'none') as 'ok' | 'warn' | 'none';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(results.map((r) => copyText(ds, r)).join('\n\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked */ }
  };

  return (
    <article className="answer reading" aria-live="polite">
      <p className="answer__title">{requestTitle(ds, main.request)}</p>
      {compare ? (
        <div className="answer__compare">
          {compare.map((r, i) => (
            <div key={i}>
              <div className="answer__period">{periodText(r)}</div>
              <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, lineHeight: 1.25 }}>
                {r.value == null ? <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>غير متاح</span> : <span><bdi className="num">{fmtValue(r, r.value)}</bdi> {valueUnit(r)}</span>}
              </div>
              <div style={{ marginTop: 4 }}><Pill tone={tone(coverageText(r).tone)}>{coverageText(r).tone === 'ok' ? 'مكتملة' : coverageText(r).tone === 'warn' ? 'جزئية' : 'غير مغطاة'}</Pill></div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <Value res={main} />
          <div className="answer__period">{periodText(main)}</div>
        </>
      )}
      {compare && compare[0].value != null && compare[1].value != null && (
        <p className="answer__delta">
          الفرق: <bdi className="num">{fmtValue(main, compare[0].value - compare[1].value)}</bdi>
          {compare[1].value !== 0 && <> (<bdi className="num">{fmtNum(Math.round(((compare[0].value - compare[1].value) / compare[1].value) * 1000) / 10)}٪</bdi>)</>}
          {(compare[0].coverage?.status === 'partial' || compare[1].coverage?.status === 'partial') && <span className="muted"> — المقارنة جزئية لعدم اكتمال إحدى الفترتين.</span>}
        </p>
      )}
      {!compare && main.value != null && <div style={{ marginTop: 10 }}><ResultTable res={main} ds={ds} /></div>}

      {showSources && (
        <div className="answer__meta">
          <Pill tone={tone(cov.tone)}>{cov.text}</Pill>
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
          <dt>قاعدة البيانات</dt><dd>{main.dataset.name} — كل سجل = {main.dataset.unit_label}</dd>
          <dt>الحساب</dt><dd>{measurePhrase(ds, main.request)}</dd>
          {main.request.period && <><dt>الفترة</dt><dd>من بداية {main.request.period.start} حتى ما قبل {main.request.period.end_exclusive} بتوقيت الرياض</dd></>}
          <dt>المرشحات</dt><dd>{main.request.filters.map((f) => filterPhrase(ds, f)).join('، ') || 'بلا مرشحات'}</dd>
          <dt>المصادر</dt><dd>{main.sources.map((s) => s.file_name).join('، ') || '—'}</dd>
          <dt>الإصدار</dt><dd><bdi className="num">{fmtNum(main.dataset_version)}</bdi> — إجمالي السجلات <bdi className="num">{fmtNum(main.total_rows)}</bdi></dd>
          <dt>وقت الحساب</dt><dd>{formatInstant(main.extracted_at)}</dd>
        </dl>
      )}

      <div className="answer__actions">
        <button type="button" className="btn btn--sm btn--quiet" onClick={copy}>{copied ? <IconCheck aria-hidden /> : <IconCopy aria-hidden />}{copied ? 'نُسخ' : 'نسخ'}</button>
        <button type="button" className="btn btn--sm btn--quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)}><IconInfo aria-hidden />{open ? 'إخفاء الطريقة' : 'طريقة الحساب'}</button>
        <button type="button" className="btn btn--sm btn--quiet" disabled={pinned} onClick={() => { pinIndicator({ id: crypto.randomUUID(), title: requestTitle(ds, main.request), request: main.request }); setPinned(true); }}>
          <IconBookmark aria-hidden />{pinned ? 'أُضيف للمؤشرات' : 'إضافة للمؤشرات'}
        </button>
        <button type="button" className="btn btn--sm btn--quiet" onClick={() => setExportDraft(main.request)}><IconExport aria-hidden />استخراج Excel</button>
      </div>
    </article>
  );
}
