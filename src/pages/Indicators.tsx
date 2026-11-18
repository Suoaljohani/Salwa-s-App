import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart, cssVar } from '../components/EChart';
import { ResultTable } from '../components/AnswerCard';
import { IconBookmark, IconLine as IconChart, IconClose, IconTable } from '../components/Icons';
import { Empty, Notice, Pill } from '../components/ui';
import { queryStat } from '../lib/metrics/engine';
import { colOf, defaultBins, keyLabel, shortKey, sortKeys } from '../lib/metrics/catalog';
import type { DatasetColumn, DatasetInfo, GroupBy, StatRequest, StatResult } from '../lib/metrics/types';
import { coverageText, fmtValue, headline, periodText, requestTitle, sourceText } from '../lib/metrics/describe';
import { addMonths, daysBetween, daysInRange, formatPeriod, monthsInRange } from '../lib/dates';
import { fmtNum } from '../lib/format';
import { usePrefs, useReducedMotionPref } from '../lib/prefs';
import { unpinIndicator, useApp } from '../lib/appState';
import { useCatalog } from '../lib/catalogStore';

const EASE = [0.23, 1, 0.32, 1] as const;
const INTRO_KEY = 'salwa.indicators.introPlayed';
const PALETTE = ['--s1', '--s2', '--s3', '--s4', '--s5'];

interface Period { id: string; start: string; end_exclusive: string; label: string }

function periodOptions(ds: DatasetInfo | undefined): Period[] {
  if (!ds?.period_column) return [];
  const cov = ds.coverage.filter((c) => c.start && c.end_exclusive);
  if (!cov.length) return [];
  const start = cov.map((c) => c.start!).sort()[0];
  const end = cov.map((c) => c.end_exclusive!).sort().at(-1)!;
  const months = monthsInRange(start, end).reverse();
  const out: Period[] = months.map((m) => ({ id: m, start: `${m}-01`, end_exclusive: addMonths(`${m}-01`, 1), label: formatPeriod(`${m}-01`, addMonths(`${m}-01`, 1)) }));
  if (months.length > 1) out.push({ id: 'all', start: `${months.at(-1)}-01`, end_exclusive: addMonths(`${months[0]}-01`, 1), label: 'كل الفترة المغطاة' });
  return out;
}
function defaultPeriod(ds: DatasetInfo, opts: Period[]): string | null {
  if (!opts.length) return null;
  const end = ds.coverage.map((c) => c.end_exclusive).filter(Boolean).sort().at(-1)!;
  return (opts.find((o) => o.id !== 'all' && o.end_exclusive <= end) ?? opts[0]).id;
}

/** Choose what to chart for any dataset from its column shapes. */
function plan(ds: DatasetInfo) {
  const dims = ds.columns.filter((c) => c.role === 'dimension' && (c.values?.length ?? 0) >= 2);
  const low = dims.filter((c) => (c.distinct ?? c.values!.length) <= 6);
  const high = dims.filter((c) => (c.distinct ?? c.values!.length) > 6 && (c.distinct ?? 99) <= 300);
  const nums = ds.columns.filter((c) => c.type === 'number' && c.role === 'measure');
  const binned = nums.find((c) => defaultBins(c)) ;
  const ident = ds.columns.find((c) => c.role === 'identifier' && c.key !== ds.key_column) ?? null;
  const date = ds.columns.find((c) => c.key === ds.period_column) ?? null;
  return { low, high, nums, binned, ident, date };
}

export function IndicatorsPage({ active }: { active: boolean }) {
  const theme = usePrefs((p) => p.theme);
  const pins = useApp((s) => s.pins);
  const reduced = useReducedMotionPref();
  const { catalog, state: catState } = useCatalog();
  const datasets = useMemo(() => catalog?.datasets.filter((d) => d.row_count > 0) ?? [], [catalog]);
  const [dsId, setDsId] = useState<string | null>(null);
  const ds = datasets.find((d) => d.id === dsId) ?? datasets[0];
  const periods = useMemo(() => periodOptions(ds), [ds]);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [slice, setSlice] = useState<{ column: string; value: string } | null>(null);
  const [loaded, setLoaded] = useState<{ dsId: string; results: Record<string, StatResult> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tables, setTables] = useState<Record<string, boolean>>({});
  const reqId = useRef(0);
  const [intro] = useState(() => { try { return !sessionStorage.getItem(INTRO_KEY); } catch { return true; } });
  const [introDone, setIntroDone] = useState(false);
  const [themeKey, setThemeKey] = useState(0);

  useEffect(() => { if (ds && (!periodId || !periods.some((p) => p.id === periodId))) setPeriodId(defaultPeriod(ds, periods)); }, [ds, periods, periodId]);
  useEffect(() => { setSlice(null); }, [ds?.id]);
  const period = periods.find((p) => p.id === periodId) ?? null;
  const shape = useMemo(() => (ds ? plan(ds) : null), [ds]);

  const themeMounted = useRef(false);
  useEffect(() => {
    let id = 0;
    if (themeMounted.current) id = requestAnimationFrame(() => setThemeKey((k) => k + 1));
    themeMounted.current = true;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => requestAnimationFrame(() => setThemeKey((k) => k + 1));
    mq.addEventListener('change', on);
    return () => { cancelAnimationFrame(id); mq.removeEventListener('change', on); };
  }, [theme]);

  useEffect(() => {
    if (!ds || !shape || (ds.period_column && periods.length && !period)) return;
    const id = ++reqId.current;
    const ctrl = new AbortController();
    const filters = slice ? [{ column: slice.column, op: 'eq' as const, value: slice.value }] : [];
    const p = period ? { start: period.start, end_exclusive: period.end_exclusive } : null;
    const base = { dataset_id: ds.id, filters, period: p };
    const series = shape.low.find((c) => c.key !== slice?.column);
    const reqs: Record<string, StatRequest> = { total: { ...base, measure: { op: 'count' }, group_by: [] } };
    if (shape.ident) reqs.distinct = { ...base, measure: { op: 'count_distinct', column: shape.ident.key }, group_by: [] };
    if (shape.nums[0]) reqs.avg = { ...base, measure: { op: 'avg', column: (shape.binned ?? shape.nums[0]).key }, group_by: [] };
    if (shape.date && p) {
      const grain = daysBetween(p.start, p.end_exclusive) <= 62 ? 'day' : 'month';
      reqs.trend = { ...base, measure: { op: 'count' }, group_by: [{ column: shape.date.key, grain }, ...(series ? [{ column: series.key }] : [])] };
    } else if (series) {
      reqs.trend = { ...base, measure: { op: 'count' }, group_by: [{ column: series.key }] };
    }
    const second = shape.low.find((c) => c.key !== series?.key && c.key !== slice?.column) ?? series;
    if (shape.binned) reqs.bins = { ...base, measure: { op: 'count' }, group_by: [{ column: shape.binned.key, bins: defaultBins(shape.binned) }, ...(second && second.key !== slice?.column ? [{ column: second.key }] : [])] };
    else if (second && second !== series) reqs.bins = { ...base, measure: { op: 'count' }, group_by: [{ column: second.key }] };
    const big = shape.high.find((c) => c.key !== slice?.column);
    if (big) reqs.top = { ...base, measure: { op: 'count' }, group_by: [{ column: big.key }] };
    setLoading(true);
    setError(null);
    Promise.all(Object.entries(reqs).map(([k, r]) => queryStat(r, { signal: ctrl.signal }).then((x) => [k, x] as const)))
      .then((entries) => { if (id === reqId.current) { setLoaded({ dsId: ds.id, results: Object.fromEntries(entries) }); setLoading(false); } })
      .catch((e) => { if (id === reqId.current && !ctrl.signal.aborted) { setError((e as Error).message); setLoading(false); } });
    return () => ctrl.abort();
  }, [ds?.id, ds?.version, period?.start, period?.end_exclusive, slice?.column, slice?.value, shape]); // eslint-disable-line react-hooks/exhaustive-deps

  // Results are only shown for the dataset they were computed from.
  const data = loaded && ds && loaded.dsId === ds.id ? loaded.results : null;

  useEffect(() => {
    if (data && intro && !introDone && active) {
      const t = setTimeout(() => { setIntroDone(true); try { sessionStorage.setItem(INTRO_KEY, '1'); } catch { /* ignore */ } }, 700);
      return () => clearTimeout(t);
    }
  }, [data, intro, introDone, active]);
  const playIntro = intro && !introDone && !reduced;

  const kpis = useMemo(() => {
    if (!data || !ds) return null;
    const out: { label: string; value: number | null; text: string; sub: string }[] = [];
    const t = data.total;
    out.push({ label: `إجمالي ${ds.unit_label === 'زيارة' ? 'الزيارات' : ds.unit_label === 'موظف' ? 'الموظفين' : 'السجلات'}`, value: t.value, text: fmtValue(t, t.value), sub: t.value == null ? '' : ds.unit_label });
    if (data.distinct && shape?.ident) out.push({ label: `${shape.ident.label} المختلفة`, value: data.distinct.value, text: fmtValue(data.distinct, data.distinct.value), sub: 'بدون تكرار' });
    if (data.avg) out.push({ label: `متوسط ${colOf(ds, data.avg.request.measure.column)?.label ?? ''}`, value: data.avg.value, text: fmtValue(data.avg, data.avg.value), sub: data.avg.excluded.length ? `دون ${fmtNum(data.avg.excluded[0].n)} بلا قيمة` : '' });
    if (out.length < 3 && t.coverage && t.value != null && t.coverage.covered_days) out.push({ label: 'المتوسط اليومي', value: t.value / t.coverage.covered_days, text: fmtNum(Math.round((t.value / t.coverage.covered_days) * 10) / 10), sub: `على ${fmtNum(t.coverage.covered_days)} يومًا مغطى` });
    return out.slice(0, 3);
  }, [data, ds, shape]);

  const options = useMemo(() => data && ds && {
    trend: data.trend ? (data.trend.request.group_by[0].grain ? trendOption(ds, data.trend, playIntro, reduced, themeKey) : barOption(ds, data.trend, playIntro, reduced, themeKey)) : null,
    bins: data.bins ? barOption(ds, data.bins, playIntro, reduced, themeKey) : null,
    top: data.top ? hbarOption(ds, data.top, playIntro, reduced, themeKey) : null,
  }, [data, ds, playIntro, reduced, themeKey]);

  if (catState === 'error') return <main className="page"><Notice tone="danger">تعذّر تحميل حالة البيانات. تحققي من الاتصال ثم أعيدي فتح الصفحة.</Notice></main>;
  if (catState === 'ready' && !datasets.length) {
    return (
      <main className="page">
        <Head label="لا توجد بيانات معتمدة" />
        <div className="reading card"><Empty title="لا توجد بيانات معتمدة بعد">ارفعي ملفًا من صفحة البيانات واعتمديه، وستظهر المؤشرات هنا.</Empty></div>
      </main>
    );
  }
  const sliceCol = slice ? colOf(ds, slice.column) : undefined;
  const sliceable = shape ? [...shape.low, ...shape.high].filter((c) => (c.values?.length ?? 0) <= 40) : [];

  return (
    <main className="page">
      <Head label={period?.label ?? (ds ? (ds.mode === 'snapshot' ? 'آخر نسخة معتمدة' : 'كل الفترة') : '…')} animate={playIntro} />
      <div className="filterbar" role="group" aria-label="المرشحات">
        {datasets.length > 1 && (
          <select className="select" aria-label="قاعدة البيانات" style={{ width: 'auto', minWidth: 160 }} value={ds?.id ?? ''} onChange={(e) => { setDsId(e.target.value); setPeriodId(null); }}>
            {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        {periods.length > 0 && (
          <select className="select" aria-label="الفترة" style={{ width: 'auto', minWidth: 140 }} value={periodId ?? ''} onChange={(e) => setPeriodId(e.target.value)}>
            {periods.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        )}
        {sliceable.length > 0 && (
          <select className="select" aria-label="تصفية" style={{ width: 'auto', minWidth: 140 }} value={slice ? `${slice.column}\u0000${slice.value}` : ''}
            onChange={(e) => { const [column, value] = e.target.value.split('\u0000'); setSlice(e.target.value ? { column, value } : null); }}>
            <option value="">بلا تصفية</option>
            {sliceable.map((c) => (
              <optgroup key={c.key} label={c.label}>
                {(c.values ?? []).map((v) => <option key={v.value} value={`${c.key}\u0000${v.value}`}>{keyLabel(c, undefined, v.value)}</option>)}
              </optgroup>
            ))}
          </select>
        )}
        {slice && <Pill>{sliceCol?.label}: {keyLabel(sliceCol, undefined, slice.value)}</Pill>}
        {loading && data && <Pill>يُحدَّث…</Pill>}
      </div>

      {error && <Notice tone="danger">تعذّر حساب المؤشرات. أعيدي المحاولة بعد قليل.</Notice>}

      <section className="kpis" aria-label="الأرقام الأساسية">
        {(kpis ?? [null, null, null]).map((k, i) => (
          <motion.div key={i} className="kpi reading"
            initial={playIntro ? { opacity: 0, y: 6 } : false} animate={data ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.22, ease: EASE, delay: playIntro ? [0.04, 0.085, 0.12][i] : 0 }}>
            {k ? (
              <>
                <span className="kpi__label">{k.label}</span>
                <span className="kpi__value">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span key={k.text} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: EASE }}>
                      {k.value == null ? <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>غير متاح</span> : <bdi className="num">{k.text}</bdi>}
                    </motion.span>
                  </AnimatePresence>
                </span>
                <span className="kpi__sub">{k.sub}</span>
              </>
            ) : (
              <><div className="skeleton" style={{ height: 12, width: '70%' }} /><div className="skeleton" style={{ height: 26, width: '55%', marginTop: 'auto' }} /></>
            )}
          </motion.div>
        ))}
      </section>

      {data && ds && options && (
        <>
          {data.trend && options.trend && (
            <ChartPanel id="trend" ds={ds} res={data.trend} option={options.trend} fade={playIntro}
              title={data.trend.request.group_by[0].grain ? `${ds.unit_label === 'زيارة' ? 'الزيارات' : 'العدد'} ${data.trend.request.group_by[0].grain === 'day' ? 'يوميًا' : 'شهريًا'}` : `حسب ${colOf(ds, data.trend.request.group_by[0].column)?.label}`}
              table={!!tables.trend} onTable={() => setTables((t) => ({ ...t, trend: !t.trend }))} />
          )}
          <div className="grid-2">
            {data.bins && options.bins && (
              <ChartPanel id="bins" ds={ds} res={data.bins} option={options.bins} fade={playIntro}
                title={`حسب ${data.bins.request.group_by.map((g) => colOf(ds, g.column)?.label).join(' و')}`}
                table={!!tables.bins} onTable={() => setTables((t) => ({ ...t, bins: !t.bins }))} />
            )}
            {data.top && options.top && (
              <ChartPanel id="top" ds={ds} res={data.top} option={options.top} fade={playIntro}
                title={`حسب ${colOf(ds, data.top.request.group_by[0].column)?.label}`}
                table={!!tables.top} onTable={() => setTables((t) => ({ ...t, top: !t.top }))} />
            )}
          </div>
        </>
      )}

      {pins.length > 0 && <Pinned />}
    </main>
  );
}

function Head({ label, animate }: { label: string; animate?: boolean }) {
  return (
    <motion.header className="ind-head" initial={animate ? { opacity: 0, y: 8 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: EASE }}>
      <div><div className="period">{label}</div><h1>المؤشرات</h1></div>
    </motion.header>
  );
}

function seriesKeys(ds: DatasetInfo, res: StatResult, idx: number) {
  const g = res.request.group_by[idx];
  const col = colOf(ds, g?.column);
  return { g, col, keys: sortKeys(col, g, [...new Set(res.rows.map((r) => (idx === 0 ? r.d1 : r.d2)!))]) };
}

function ChartPanel({ id, ds, title, res, option, table, onTable, fade }: {
  id: string; ds: DatasetInfo; title: string; res: StatResult; option: EChartsCoreOption; table: boolean; onTable: () => void; fade?: boolean;
}) {
  const cov = coverageText(res);
  const legend = res.request.group_by.length === 2 ? (() => { const s = seriesKeys(ds, res, 1); return s.keys.map((k, i) => ({ label: keyLabel(s.col, s.g, k), color: cssVar(PALETTE[i % PALETTE.length]) })); })() : null;
  return (
    <section className="chart-panel reading" aria-labelledby={`h-${id}`}>
      <div className="chart-panel__head">
        <h2 id={`h-${id}`}>{title}</h2>
        <button type="button" className="btn btn--sm btn--quiet" aria-pressed={table} onClick={onTable}>
          {table ? <IconChart aria-hidden /> : <IconTable aria-hidden />}{table ? 'رسم' : 'جدول'}
        </button>
      </div>
      {legend && legend.length > 1 && !table && <div className="legend">{legend.map((l) => <span key={l.label}><i style={{ background: l.color }} />{l.label}</span>)}</div>}
      {res.value == null ? <Empty title="الفترة غير مغطاة ببيانات معتمدة" />
        : res.value === 0 ? <Empty title="لا توجد سجلات مطابقة">العدد صفر في بيانات معتمدة.</Empty>
        : table ? <div style={{ padding: '0 6px' }}><ResultTable res={res} ds={ds} /></div>
        : <EChart option={option} label={`${title}: ${headline(res)}. استخدمي زر الجدول لقراءة القيم.`} />}
      <motion.div className="chart-foot" initial={fade ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.16, delay: fade ? 0.1 : 0 }}>
        <span>{sourceText(res)}</span>
        <Pill tone={cov.tone === 'ok' ? 'ok' : cov.tone === 'warn' ? 'warn' : 'none'}>{cov.text}</Pill>
      </motion.div>
    </section>
  );
}

function baseOption(first: boolean, reduced: boolean) {
  const axis = cssVar('--chart-axis');
  return {
    animation: !reduced,
    animationDuration: first ? 500 : 0,
    animationDelay: first ? 120 : 0,
    animationEasing: 'cubicOut' as const,
    animationDurationUpdate: reduced ? 0 : 240,
    animationEasingUpdate: 'cubicOut' as const,
    textStyle: { fontFamily: 'Janna LT, system-ui, sans-serif', color: axis },
    grid: { left: 8, right: 12, top: 16, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis', confine: true, axisPointer: { type: 'shadow', shadowStyle: { opacity: 0.06 } },
      backgroundColor: cssVar('--reading'), borderColor: cssVar('--line-strong'), textStyle: { color: cssVar('--text'), fontFamily: 'Janna LT, system-ui' },
      extraCssText: 'direction: rtl; text-align: right; border-radius: 12px; box-shadow: none;',
    },
    aria: { enabled: true },
  };
}
const valueAxis = () => ({ type: 'value', min: 0, minInterval: 1, axisLabel: { color: cssVar('--chart-axis'), fontSize: 11 }, splitLine: { lineStyle: { color: cssVar('--chart-grid') } } });
const catAxis = (data: string[]) => ({ type: 'category', data, axisTick: { show: false }, axisLine: { lineStyle: { color: cssVar('--line-strong') } }, axisLabel: { color: cssVar('--chart-axis'), fontSize: 11, hideOverlap: true } });

function trendOption(ds: DatasetInfo, res: StatResult, first: boolean, reduced: boolean, _k: number): EChartsCoreOption {
  const g0 = res.request.group_by[0];
  const p = res.request.period!;
  const periods = g0.grain === 'day' ? daysInRange(p.start, p.end_exclusive) : monthsInRange(p.start, p.end_exclusive);
  const s = res.request.group_by[1] ? seriesKeys(ds, res, 1) : { keys: ['__all'], col: undefined as DatasetColumn | undefined, g: undefined as GroupBy | undefined };
  const cov = res.coverage;
  const covered = (per: string) => !cov || (g0.grain === 'month' ? cov.months.find((m) => m.period === per)?.status !== 'none' : !cov.gaps.some((x) => x.start <= per && per < x.end_exclusive));
  const map = new Map(res.rows.map((r) => [`${r.d2 ?? '__all'}|${r.d1}`, r.value]));
  return {
    ...baseOption(first, reduced),
    tooltip: { ...baseOption(first, reduced).tooltip, axisPointer: { type: 'line', lineStyle: { color: cssVar('--chart-axis'), opacity: 0.4 } } },
    xAxis: { ...catAxis(periods.map((x) => (g0.grain === 'day' ? String(Number(x.slice(8))) : keyLabel(undefined, g0, x)))), boundaryGap: false },
    yAxis: valueAxis(),
    series: s.keys.map((k, i) => ({
      id: `trend-${k}`, name: k === '__all' ? ds.unit_label : keyLabel(s.col, s.g, k), type: 'line', connectNulls: false,
      data: periods.map((x) => (covered(x) ? map.get(`${k}|${x}`) ?? 0 : null)),
      showSymbol: false, symbolSize: 8, lineStyle: { width: 2 }, emphasis: { focus: 'series' }, color: cssVar(PALETTE[i % PALETTE.length]),
      areaStyle: s.keys.length === 1 ? { opacity: 0.08 } : undefined,
    })),
  };
}

function barOption(ds: DatasetInfo, res: StatResult, first: boolean, reduced: boolean, _k: number): EChartsCoreOption {
  const x = seriesKeys(ds, res, 0);
  const s = res.request.group_by[1] ? seriesKeys(ds, res, 1) : null;
  const get = (a: string, b?: string) => res.rows.find((r) => r.d1 === a && (b === undefined || r.d2 === b))?.value ?? 0;
  return {
    ...baseOption(first, reduced),
    xAxis: { ...catAxis(x.keys.map((k) => shortKey(x.col, x.g, k))), axisLabel: { color: cssVar('--chart-axis'), fontSize: 11, interval: 0, hideOverlap: false, width: 70, overflow: 'truncate' } },
    yAxis: valueAxis(),
    series: (s ? s.keys : ['__all']).map((k, i) => ({
      id: `bar-${k}`, name: k === '__all' ? ds.unit_label : keyLabel(s!.col, s!.g, k), type: 'bar', barMaxWidth: 18, barGap: '12%',
      itemStyle: { borderRadius: [4, 4, 0, 0], color: cssVar(PALETTE[i % PALETTE.length]) },
      data: x.keys.map((xk) => (k === '__all' ? get(xk) : get(xk, k))),
    })),
  };
}

function hbarOption(ds: DatasetInfo, res: StatResult, first: boolean, reduced: boolean, _k: number): EChartsCoreOption {
  const g = res.request.group_by[0];
  const col = colOf(ds, g.column);
  const rows = [...res.rows].sort((a, b) => a.value - b.value).slice(-8);
  return {
    ...baseOption(first, reduced),
    grid: { left: 8, right: 16, top: 8, bottom: 4, containLabel: true },
    xAxis: valueAxis(),
    yAxis: { type: 'category', data: rows.map((r) => keyLabel(col, g, r.d1)), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: cssVar('--text-2'), fontSize: 12, width: 120, overflow: 'truncate' } },
    series: [{ id: 'top', name: ds.unit_label, type: 'bar', barMaxWidth: 16, itemStyle: { borderRadius: [0, 4, 4, 0], color: cssVar('--s1') }, data: rows.map((r) => r.value) }],
  };
}

function Pinned() {
  const pins = useApp((s) => s.pins);
  const { catalog } = useCatalog();
  const [vals, setVals] = useState<Record<string, StatResult | 'error'>>({});
  useEffect(() => {
    let alive = true;
    pins.forEach((p) => queryStat({ ...p.request, group_by: [] })
      .then((r) => alive && setVals((v) => ({ ...v, [p.id]: r })))
      .catch(() => alive && setVals((v) => ({ ...v, [p.id]: 'error' }))));
    return () => { alive = false; };
  }, [pins, catalog?.version]);
  return (
    <section className="reading card" style={{ marginTop: 12 }} aria-labelledby="pins-h">
      <h2 id="pins-h"><IconBookmark aria-hidden style={{ width: 16, height: 16, verticalAlign: -2, marginInlineEnd: 6 }} />مؤشرات محفوظة من المحادثة</h2>
      <ul className="list">
        {pins.map((p) => {
          const v = vals[p.id];
          const ds = catalog?.datasets.find((d) => d.id === p.request.dataset_id);
          return (
            <li key={p.id} className="row row--between">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 'var(--fs-sm)' }}>{requestTitle(ds, p.request)}</div>
                <div className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{v && v !== 'error' ? periodText(v) : ds?.name ?? ''}</div>
              </div>
              <div className="row">
                <strong>{v === 'error' ? '—' : v ? (v.value == null ? 'غير متاح' : <bdi className="num">{fmtValue(v, v.value)}</bdi>) : '…'}</strong>
                <button type="button" className="icon-btn" aria-label="إزالة المؤشر" onClick={() => unpinIndicator(p.id)}><IconClose aria-hidden /></button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
