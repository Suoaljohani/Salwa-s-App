import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart, cssVar } from '../components/EChart';
import { ResultTable } from '../components/AnswerCard';
import { IconBookmark, IconLine as IconChart, IconClose, IconTable } from '../components/Icons';
import { Empty, Notice, Pill, Seg } from '../components/ui';
import { getCatalog, queryMetric } from '../lib/metrics/engine';
import { AGE_BANDS, AGE_SHORT, METRICS, valueLabel } from '../lib/metrics/catalog';
import type { DataCatalog, MetricId, MetricRequest, MetricResult } from '../lib/metrics/types';
import { coverageText, headline, requestTitle, sourceText } from '../lib/metrics/describe';
import { timeSeries } from '../lib/metrics/series';
import { addMonths, daysBetween, formatPeriod, monthsInRange } from '../lib/dates';
import { countNoun, fmtNum } from '../lib/format';
import { usePrefs, useReducedMotionPref } from '../lib/prefs';
import { unpinIndicator, useApp } from '../lib/appState';

type Enc = 'all' | 'Emergency' | 'Outpatient';
interface Period { id: string; start: string; end_exclusive: string; label: string }

const EASE = [0.23, 1, 0.32, 1] as const;
const INTRO_KEY = 'salwa.indicators.introPlayed';

function periodOptions(cat: DataCatalog | null): Period[] {
  if (!cat?.coverage.length) return [];
  const start = cat.coverage[0].start;
  const end = cat.coverage[cat.coverage.length - 1].end_exclusive;
  const months = monthsInRange(start, end).reverse();
  const out: Period[] = months.map((m) => ({ id: m, start: `${m}-01`, end_exclusive: addMonths(`${m}-01`, 1), label: formatPeriod(`${m}-01`, addMonths(`${m}-01`, 1)) }));
  if (months.length > 1) out.push({ id: 'all', start: `${months[months.length - 1]}-01`, end_exclusive: addMonths(`${months[0]}-01`, 1), label: 'كل الفترة المغطاة' });
  return out;
}

/** Default: latest month whose coverage is complete; otherwise the latest month. */
function defaultPeriod(opts: Period[], cat: DataCatalog | null): string | null {
  if (!opts.length || !cat) return null;
  const covEnd = cat.coverage[cat.coverage.length - 1].end_exclusive;
  return (opts.find((o) => o.id !== 'all' && o.end_exclusive <= covEnd) ?? opts[0]).id;
}

const ENC_COLOR: Record<string, string> = { Emergency: '--s1', Outpatient: '--s2' };
const GENDER_COLOR: Record<string, string> = { M: '--s3', F: '--s4', __unknown: '--s5' };

interface Bundle {
  trend: MetricResult;
  other: MetricResult;
  ageGender: MetricResult;
  dept: MetricResult;
}

export function IndicatorsPage({ active }: { active: boolean }) {
  const demo = usePrefs((p) => p.demoMode);
  const theme = usePrefs((p) => p.theme);
  const tick = useApp((s) => s.datasetTick);
  const pins = useApp((s) => s.pins);
  const reduced = useReducedMotionPref();
  const [cat, setCat] = useState<DataCatalog | null>(null);
  const [catState, setCatState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [enc, setEnc] = useState<Enc>('all');
  const [metric, setMetric] = useState<MetricId>('visits');
  const [data, setData] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tables, setTables] = useState<Record<string, boolean>>({});
  const reqId = useRef(0);
  // First visit in this session plays the composed entrance once; later visits do not replay it.
  const [intro] = useState(() => { try { return !sessionStorage.getItem(INTRO_KEY); } catch { return true; } });
  const [introDone, setIntroDone] = useState(false);
  const [themeKey, setThemeKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setCatState('loading');
    getCatalog()
      .then((c) => { if (!alive) return; setCat(c); setCatState('ready'); })
      .catch(() => alive && setCatState('error'));
    return () => { alive = false; };
  }, [demo, tick]);

  const periods = useMemo(() => periodOptions(cat), [cat]);
  useEffect(() => {
    if (!periods.length) return;
    if (!periodId || !periods.some((p) => p.id === periodId)) setPeriodId(defaultPeriod(periods, cat));
  }, [periods, periodId, cat]);
  const period = periods.find((p) => p.id === periodId) ?? null;

  // Re-read CSS colors when the theme flips (system or manual).
  useEffect(() => {
    const id = requestAnimationFrame(() => setThemeKey((k) => k + 1));
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setThemeKey((k) => k + 1);
    mq.addEventListener('change', on);
    return () => { cancelAnimationFrame(id); mq.removeEventListener('change', on); };
  }, [theme]);

  useEffect(() => {
    if (!period) return;
    const id = ++reqId.current;
    const ctrl = new AbortController();
    const filters = enc === 'all' ? {} : { encounter_type: [enc] };
    const grain = daysBetween(period.start, period.end_exclusive) <= 62 ? 'day' : 'month';
    const base = { start: period.start, end_exclusive: period.end_exclusive, filters };
    const reqs: Record<keyof Bundle, MetricRequest> = {
      trend: { ...base, metric, group_by: [grain, 'encounter_type'] },
      other: { ...base, metric: metric === 'visits' ? 'distinct_patients' : 'visits', group_by: [] },
      ageGender: { ...base, metric, group_by: ['age_band', 'gender'] },
      dept: { ...base, metric, group_by: ['department'] },
    };
    setLoading(true);
    setError(null);
    Promise.all((Object.keys(reqs) as (keyof Bundle)[]).map((k) => queryMetric(reqs[k], { signal: ctrl.signal }).then((r) => [k, r] as const)))
      .then((entries) => {
        if (id !== reqId.current) return; // a newer filter won
        setData(Object.fromEntries(entries) as unknown as Bundle);
        setLoading(false);
      })
      .catch((e) => {
        if (id !== reqId.current || ctrl.signal.aborted) return;
        setError((e as Error).message);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [period?.start, period?.end_exclusive, enc, metric, demo, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (data && intro && !introDone && active) {
      const t = setTimeout(() => { setIntroDone(true); try { sessionStorage.setItem(INTRO_KEY, '1'); } catch { /* ignore */ } }, 700);
      return () => clearTimeout(t);
    }
  }, [data, intro, introDone, active]);

  const playIntro = intro && !introDone && !reduced;
  const unit = METRICS[metric];

  if (catState === 'error') return <main className="page"><Notice tone="danger">تعذّر تحميل حالة البيانات. تحققي من الاتصال ثم أعيدي فتح الصفحة.</Notice></main>;
  if (catState === 'ready' && !periods.length) {
    return (
      <main className="page">
        <Head label="لا توجد فترة معتمدة" />
        <div className="reading card"><Empty title="لا توجد بيانات معتمدة بعد">ارفعي تقرير الزيارات من صفحة البيانات واعتمديه، وستظهر المؤشرات هنا.</Empty></div>
      </main>
    );
  }

  const kpis = data ? buildKpis(data, metric) : null;

  return (
    <main className="page">
      <Head label={period?.label ?? '…'} animate={playIntro} />
      <div className="filterbar" role="group" aria-label="المرشحات">
        <label className="sr-only" htmlFor="period">الفترة</label>
        <select id="period" className="select" style={{ width: 'auto', minWidth: 150 }} value={periodId ?? ''} onChange={(e) => setPeriodId(e.target.value)}>
          {periods.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <Seg label="نوع الزيارة" value={enc} onChange={setEnc} options={[{ value: 'all', label: 'الكل' }, { value: 'Emergency', label: 'الطوارئ' }, { value: 'Outpatient', label: 'العيادات' }]} />
        <Seg label="وحدة العد" value={metric} onChange={setMetric} options={[{ value: 'visits', label: 'زيارات' }, { value: 'distinct_patients', label: 'مرضى' }]} />
        {loading && data && <Pill>يُحدَّث…</Pill>}
      </div>

      {error && <Notice tone="danger">تعذّر حساب المؤشرات. أعيدي المحاولة بعد قليل.</Notice>}

      <section className="kpis" aria-label="الأرقام الأساسية">
        {(kpis ?? [null, null, null]).map((k, i) => (
          <motion.div
            key={i}
            className="kpi reading"
            initial={playIntro ? { opacity: 0, y: 6 } : false}
            animate={data ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.22, ease: EASE, delay: playIntro ? [0.04, 0.085, 0.12][i] : 0 }}
          >
            {k ? (
              <>
                <span className="kpi__label">{k.label}</span>
                <span className="kpi__value">{k.value == null ? <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>غير متاح</span> : <bdi className="num">{k.text}</bdi>}</span>
                <span className="kpi__sub">{k.sub}</span>
              </>
            ) : (
              <><div className="skeleton" style={{ height: 12, width: '70%' }} /><div className="skeleton" style={{ height: 26, width: '55%', marginTop: 'auto' }} /></>
            )}
          </motion.div>
        ))}
      </section>

      {data && (
        <>
          <ChartPanel
            id="trend" title={`${unit.label} ${daysBetween(period!.start, period!.end_exclusive) <= 62 ? 'يوميًا' : 'شهريًا'}`} res={data.trend}
            table={!!tables.trend} onTable={() => setTables((t) => ({ ...t, trend: !t.trend }))}
            option={trendOption(data.trend, playIntro, reduced, themeKey)}
            legend={legendFor(data.trend, 'encounter_type')}
            fade={playIntro}
          />
          <div className="grid-2">
            <ChartPanel
              id="age" title={`${unit.label} حسب الفئة العمرية والجنس`} res={data.ageGender}
              table={!!tables.age} onTable={() => setTables((t) => ({ ...t, age: !t.age }))}
              option={ageOption(data.ageGender, playIntro, reduced, themeKey)}
              legend={legendFor(data.ageGender, 'gender')}
              fade={playIntro}
            />
            <ChartPanel
              id="dept" title={`${unit.label} حسب القسم`} res={data.dept}
              table={!!tables.dept} onTable={() => setTables((t) => ({ ...t, dept: !t.dept }))}
              option={deptOption(data.dept, playIntro, reduced, themeKey)}
              fade={playIntro}
            />
          </div>
        </>
      )}

      {pins.length > 0 && <Pinned />}
    </main>
  );
}

function Head({ label, animate }: { label: string; animate?: boolean }) {
  return (
    <motion.header
      className="ind-head"
      initial={animate ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: EASE }}
    >
      <div>
        <div className="period">{label}</div>
        <h1>المؤشرات</h1>
      </div>
    </motion.header>
  );
}

function ChartPanel({ id, title, res, option, legend, table, onTable, fade }: {
  id: string; title: string; res: MetricResult; option: EChartsCoreOption; legend?: { label: string; color: string }[];
  table: boolean; onTable: () => void; fade?: boolean;
}) {
  const cov = coverageText(res);
  const empty = res.value === 0;
  return (
    <section className="chart-panel reading" aria-labelledby={`h-${id}`}>
      <div className="chart-panel__head">
        <h2 id={`h-${id}`}>{title}</h2>
        <button type="button" className="btn btn--sm btn--quiet" aria-pressed={table} onClick={onTable}>
          {table ? <IconChart aria-hidden /> : <IconTable aria-hidden />}{table ? 'رسم' : 'جدول'}
        </button>
      </div>
      {legend && legend.length > 1 && !table && (
        <div className="legend">{legend.map((l) => <span key={l.label}><i style={{ background: l.color }} />{l.label}</span>)}</div>
      )}
      {res.value == null ? (
        <Empty title="الفترة غير مغطاة ببيانات معتمدة" />
      ) : empty ? (
        <Empty title="لا توجد سجلات مطابقة">العدد صفر في فترة مغطاة بالبيانات.</Empty>
      ) : table ? (
        <div style={{ padding: '0 6px' }}><ResultTable res={res} /></div>
      ) : (
        <EChart option={option} label={`${title}: ${headline(res)}. استخدمي زر الجدول لقراءة القيم.`} />
      )}
      <motion.div className="chart-foot" initial={fade ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.16, delay: fade ? 0.1 : 0 }}>
        <span>{sourceText(res)}</span>
        <Pill tone={cov.tone === 'ok' ? 'ok' : cov.tone === 'warn' ? 'warn' : 'none'}>{cov.text}</Pill>
      </motion.div>
    </section>
  );
}

function buildKpis(d: Bundle, metric: MetricId) {
  const visits = metric === 'visits' ? d.trend.value : d.other.value;
  const patients = metric === 'visits' ? d.other.value : d.trend.value;
  const days = d.trend.coverage.covered_days;
  const unitV = (n: number) => countNoun(n, 'visit');
  const unitP = (n: number) => countNoun(n, 'patient');
  return [
    { label: metric === 'visits' ? 'إجمالي الزيارات' : 'المرضى المختلفون', value: d.trend.value, text: fmtNum(d.trend.value), sub: d.trend.value == null ? '' : metric === 'visits' ? unitV(d.trend.value) : unitP(d.trend.value) },
    { label: metric === 'visits' ? 'المرضى المختلفون' : 'إجمالي الزيارات', value: d.other.value, text: fmtNum(d.other.value), sub: d.other.value == null ? '' : metric === 'visits' ? unitP(d.other.value) : unitV(d.other.value) },
    metric === 'visits'
      ? { label: 'المتوسط اليومي', value: visits == null || !days ? null : visits / days, text: fmtNum(visits == null || !days ? null : Math.round((visits / days) * 10) / 10), sub: `على ${fmtNum(days)} يومًا مغطى` }
      : { label: 'زيارات لكل مريض', value: visits == null || !patients ? null : visits / patients, text: fmtNum(visits == null || !patients ? null : Math.round((visits / patients) * 100) / 100), sub: 'الزيارات ÷ المرضى المختلفين' },
  ];
}

function legendFor(res: MetricResult, dim: 'encounter_type' | 'gender') {
  const idx = res.request.group_by.indexOf(dim);
  const keys = [...new Set(res.rows.map((r) => (idx === 0 ? r.d1 : r.d2)!))];
  const colors = dim === 'encounter_type' ? ENC_COLOR : GENDER_COLOR;
  return keys.map((k, i) => ({ label: valueLabel(dim, k), color: cssVar(colors[k] ?? `--s${Math.min(5, i + 3)}`) }));
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
      trigger: 'axis', confine: true, axisPointer: { type: 'line', lineStyle: { color: axis, opacity: 0.4 } },
      backgroundColor: cssVar('--reading'), borderColor: cssVar('--line-strong'), textStyle: { color: cssVar('--text'), fontFamily: 'Janna LT, system-ui' },
      extraCssText: 'direction: rtl; text-align: right; border-radius: 12px; box-shadow: none;',
    },
    aria: { enabled: true },
  };
}

function valueAxis() {
  return {
    type: 'value', min: 0, minInterval: 1,
    axisLabel: { color: cssVar('--chart-axis'), fontSize: 11 },
    splitLine: { lineStyle: { color: cssVar('--chart-grid') } },
  };
}

function trendOption(res: MetricResult, first: boolean, reduced: boolean, _k: number): EChartsCoreOption {
  const grain = res.request.group_by[0] as 'day' | 'month';
  const { periods, series } = timeSeries(res, grain);
  const labels = periods.map((p) => (grain === 'day' ? String(Number(p.slice(8))) : valueLabel('month', p)));
  return {
    ...baseOption(first, reduced),
    xAxis: { type: 'category', data: labels, boundaryGap: false, axisLine: { lineStyle: { color: cssVar('--line-strong') } }, axisTick: { show: false }, axisLabel: { color: cssVar('--chart-axis'), fontSize: 11, hideOverlap: true } },
    yAxis: valueAxis(),
    series: series.map((s) => ({
      id: `trend-${s.id}`, name: valueLabel('encounter_type', s.id), type: 'line', data: s.data, connectNulls: false,
      showSymbol: false, symbolSize: 8, smooth: 0.2, lineStyle: { width: 2 }, emphasis: { focus: 'series' },
      color: cssVar(ENC_COLOR[s.id] ?? '--s3'),
      areaStyle: series.length === 1 ? { opacity: 0.08 } : undefined,
    })),
  };
}

function ageOption(res: MetricResult, first: boolean, reduced: boolean, _k: number): EChartsCoreOption {
  const bands = [...AGE_BANDS.map((b) => b.id), '__unknown'].filter((b) => res.rows.some((r) => r.d1 === b));
  const genders = ['M', 'F', '__unknown'].filter((g) => res.rows.some((r) => r.d2 === g));
  return {
    ...baseOption(first, reduced),
    tooltip: { ...baseOption(first, reduced).tooltip, axisPointer: { type: 'shadow', shadowStyle: { opacity: 0.06 } } },
    xAxis: { type: 'category', data: bands.map((b) => AGE_SHORT[b] ?? b), axisTick: { show: false }, axisLine: { lineStyle: { color: cssVar('--line-strong') } }, axisLabel: { color: cssVar('--chart-axis'), fontSize: 11, interval: 0 } },
    yAxis: valueAxis(),
    series: genders.map((g) => ({
      id: `age-${g}`, name: valueLabel('gender', g), type: 'bar', barMaxWidth: 18, barGap: '12%',
      itemStyle: { borderRadius: [4, 4, 0, 0], color: cssVar(GENDER_COLOR[g]) },
      data: bands.map((b) => res.rows.find((r) => r.d1 === b && r.d2 === g)?.value ?? 0),
    })),
  };
}

function deptOption(res: MetricResult, first: boolean, reduced: boolean, _k: number): EChartsCoreOption {
  const rows = [...res.rows].sort((a, b) => a.value - b.value).slice(-8);
  return {
    ...baseOption(first, reduced),
    tooltip: { ...baseOption(first, reduced).tooltip, axisPointer: { type: 'shadow', shadowStyle: { opacity: 0.06 } } },
    grid: { left: 8, right: 16, top: 8, bottom: 4, containLabel: true },
    xAxis: valueAxis(),
    yAxis: { type: 'category', data: rows.map((r) => valueLabel('department', r.d1)), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: cssVar('--text-2'), fontSize: 12, width: 120, overflow: 'truncate' } },
    series: [{ id: 'dept', name: 'العدد', type: 'bar', barMaxWidth: 16, itemStyle: { borderRadius: [0, 4, 4, 0], color: cssVar('--s1') }, data: rows.map((r) => r.value) }],
  };
}

function Pinned() {
  const pins = useApp((s) => s.pins);
  const demo = usePrefs((p) => p.demoMode);
  const tick = useApp((s) => s.datasetTick);
  const [vals, setVals] = useState<Record<string, MetricResult | 'error'>>({});
  useEffect(() => {
    let alive = true;
    pins.forEach((p) => queryMetric({ ...p.request, group_by: [] })
      .then((r) => alive && setVals((v) => ({ ...v, [p.id]: r })))
      .catch(() => alive && setVals((v) => ({ ...v, [p.id]: 'error' }))));
    return () => { alive = false; };
  }, [pins, demo, tick]);
  return (
    <section className="reading card" style={{ marginTop: 12 }} aria-labelledby="pins-h">
      <h2 id="pins-h"><IconBookmark aria-hidden style={{ width: 16, height: 16, verticalAlign: -2, marginInlineEnd: 6 }} />مؤشرات محفوظة من المحادثة</h2>
      <ul className="list">
        {pins.map((p) => {
          const v = vals[p.id];
          return (
            <li key={p.id} className="row row--between">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 'var(--fs-sm)' }}>{requestTitle(p.request)}</div>
                <div className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{formatPeriod(p.request.start, p.request.end_exclusive)}</div>
              </div>
              <div className="row">
                <strong>{v === 'error' ? '—' : v ? (v.value == null ? 'غير متاح' : <bdi className="num">{fmtNum(v.value)}</bdi>) : '…'}</strong>
                <button type="button" className="icon-btn" aria-label="إزالة المؤشر" onClick={() => unpinIndicator(p.id)}><IconClose aria-hidden /></button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}


