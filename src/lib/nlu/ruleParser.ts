// Deterministic Arabic question parser over any dataset in the catalog.
// Used in demo mode and as a fallback when the free AI quota is exhausted or unreachable.
import { MONTHS_AR, defaultBins, keyLabel } from '../metrics/catalog';
import type { Catalog, DatasetColumn, DatasetInfo, Filter, GroupBy, Measure, StatRequest } from '../metrics/types';
import { addDays, addMonths, todayRiyadh } from '../dates';

export type ParseOutcome =
  | { kind: 'requests'; requests: StatRequest[]; interpretation: string; assumptions: string[] }
  | { kind: 'clarify'; question: string; options?: string[] }
  | { kind: 'unsupported'; reason: string };

export function normalizeArabic(s: string): string {
  return s
    .replace(/[ً-ْـ]/g, '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة(\s|$)/g, 'ه$1')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const MONTH_ALIASES: [RegExp, number][] = [
  [/يناير|كانون الثاني/, 1], [/فبراير|شباط/, 2], [/مارس|اذار/, 3], [/ابريل|نيسان/, 4], [/مايو|ايار/, 5], [/يونيو|يونيه|حزيران/, 6],
  [/يوليو|يوليه|تموز/, 7], [/اغسطس|اب /, 8], [/سبتمبر|ايلول/, 9], [/اكتوبر|تشرين الاول/, 10], [/نوفمبر|تشرين الثاني/, 11], [/ديسمبر|كانون الاول/, 12],
];

interface Period { start: string; end_exclusive: string; assumed?: string }

function findPeriods(q: string, today: string): Period[] {
  const thisMonth = `${today.slice(0, 7)}-01`;
  if (/الشهر (الماضي|السابق)/.test(q)) return [{ start: addMonths(thisMonth, -1), end_exclusive: thisMonth }];
  if (/هذا الشهر|الشهر الحالي/.test(q)) return [{ start: thisMonth, end_exclusive: addDays(today, 1) }];
  const qm = /الربع (الاول|الثاني|الثالث|الرابع)/.exec(q);
  if (qm) {
    const n = ['الاول', 'الثاني', 'الثالث', 'الرابع'].indexOf(qm[1]);
    const y = /(20\d{2})/.exec(q)?.[1] ?? today.slice(0, 4);
    const s = `${y}-${String(n * 3 + 1).padStart(2, '0')}-01`;
    return [{ start: s, end_exclusive: addMonths(s, 3), assumed: /(20\d{2})/.test(q) ? undefined : `افتُرضت سنة ${y}` }];
  }
  const found: { idx: number; p: Period }[] = [];
  for (const [re, m] of MONTH_ALIASES) {
    const g = new RegExp(re.source, 'g');
    let mt: RegExpExecArray | null;
    while ((mt = g.exec(q))) {
      const y = /(20\d{2})/.exec(q.slice(mt.index, mt.index + 30))?.[1];
      let year = y ? Number(y) : Number(today.slice(0, 4));
      if (!y && `${year}-${String(m).padStart(2, '0')}-01` > today) year -= 1;
      const start = `${year}-${String(m).padStart(2, '0')}-01`;
      found.push({ idx: mt.index, p: { start, end_exclusive: addMonths(start, 1), assumed: y ? undefined : `افتُرضت سنة ${year} لشهر ${MONTHS_AR[m - 1]}` } });
    }
  }
  if (found.length) return found.sort((a, b) => a.idx - b.idx).map((x) => x.p);
  const y = /(?:عام|سنه|سنة)\s*(20\d{2})/.exec(q)?.[1];
  if (y) return [{ start: `${y}-01-01`, end_exclusive: `${Number(y) + 1}-01-01` }];
  return [];
}

function colText(c: DatasetColumn) { return normalizeArabic(`${c.label} ${c.source_header ?? ''}`); }
function mentions(q: string, c: DatasetColumn) {
  const l = normalizeArabic(c.label).replace(/^ال/, '');
  return l.length >= 3 && q.includes(l);
}

function pickDataset(q: string, cat: Catalog, prev: StatRequest | null): DatasetInfo | null | 'ambiguous' {
  const list = cat.datasets.filter((d) => d.row_count > 0 || cat.datasets.length === 1);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  const scored = list.map((d) => {
    let s = 0;
    const unit = normalizeArabic(d.unit_label).replace(/ه$/, '');
    if (unit.length >= 3 && q.includes(unit)) s += 5;
    for (const w of normalizeArabic(d.name).split(' ')) if (w.length >= 4 && q.includes(w.replace(/^ال/, ''))) s += 3;
    if (/زيار|مراجع|مريض|مرضي/.test(q) && /زيار|مريض/.test(normalizeArabic(d.name + d.unit_label))) s += 4;
    if (/موظف|منسوب|كادر|طاقم|ممرض|اطباء/.test(q) && /موظف|منسوب|كادر/.test(normalizeArabic(d.name + d.unit_label))) s += 4;
    for (const c of d.columns) {
      if (mentions(q, c)) s += 1;
      for (const v of c.values ?? []) {
        const lab = normalizeArabic(keyLabel(c, undefined, v.value));
        if (lab.length >= 4 && q.includes(lab)) { s += 2; break; }
      }
    }
    if (prev && prev.dataset_id === d.id) s += 1;
    return { d, s };
  }).sort((a, b) => b.s - a.s);
  if (scored[0].s === 0 || scored[0].s === scored[1].s) return 'ambiguous';
  return scored[0].d;
}

function ageColumn(d: DatasetInfo) { return d.columns.find((c) => c.type === 'number' && /عمر|age/.test(colText(c))); }

function numericFilters(q: string, c: DatasetColumn): Filter[] {
  const out: Filter[] = [];
  const range = /من (\d{1,3}) (?:الي|حتي) (?:اقل من )?(\d{1,3})/.exec(q);
  if (range) {
    out.push({ column: c.key, op: 'gte', value: Number(range[1]) });
    out.push({ column: c.key, op: /اقل من/.test(range[0]) ? 'lt' : 'lte', value: Number(range[2]) });
    return out;
  }
  const atLeast = /(\d{1,3}) ?(?:سنه|عام)? ?(?:فاكثر|فما فوق|واكثر|فوق)/.exec(q);
  const older = /(?:اكبر|اكثر) من (\d{1,3})/.exec(q);
  const under = /(?:اقل|دون|تحت|اصغر) (?:من )?(\d{1,3})/.exec(q);
  if (atLeast) out.push({ column: c.key, op: 'gte', value: Number(atLeast[1]) });
  else if (older) out.push({ column: c.key, op: 'gt', value: Number(older[1]) });
  if (under) out.push({ column: c.key, op: 'lt', value: Number(under[1]) });
  return out;
}

export function parseQuestion(raw: string, cat: Catalog, previous?: StatRequest | null, today = todayRiyadh()): ParseOutcome {
  const q = normalizeArabic(raw);
  const followUp = !!previous && q.length < 40 && /^(و |وال|وفي |وكم |طيب|فقط|بس)/.test(q);
  const picked = followUp ? cat.datasets.find((d) => d.id === previous!.dataset_id) ?? null : pickDataset(q, cat, previous ?? null);
  if (picked === null) return { kind: 'unsupported', reason: 'لا توجد بيانات معتمدة بعد. ارفعي ملفًا من صفحة البيانات.' };
  if (picked === 'ambiguous') return { kind: 'clarify', question: 'من أي قاعدة بيانات؟', options: cat.datasets.map((d) => d.name).slice(0, 4) };
  const ds = picked;

  if (/ctas|سي ?تاس|الفرز/.test(q) && !ds.columns.some((c) => /ctas|فرز/.test(colText(c)))) {
    return { kind: 'unsupported', reason: `تصنيف CTAS غير موجود في «${ds.name}».` };
  }

  const req: StatRequest = followUp
    ? structuredClone(previous!)
    : { dataset_id: ds.id, measure: { op: 'count' }, filters: [], group_by: [], period: null };
  const assumptions: string[] = [];

  // Measure
  const numCols = ds.columns.filter((c) => c.type === 'number' && c.role !== 'ignore');
  const target = numCols.find((c) => mentions(q, c));
  let measure: Measure | null = null;
  if (/متوسط|معدل/.test(q) && target) measure = { op: 'avg', column: target.key };
  else if (/مجموع|اجمالي (?!عدد)/.test(q) && target) measure = { op: 'sum', column: target.key };
  else if (/(اعلي|اكبر|اقصي) (?!من)/.test(q) && target) measure = { op: 'max', column: target.key };
  else if (/(ادني|اصغر) (?!من)/.test(q) && target) measure = { op: 'min', column: target.key };
  else if (/مختلف|المرضي|عدد المرضي|كم مريض|بدون تكرار|مميز/.test(q)) {
    const id = ds.columns.find((c) => c.role === 'identifier' && /مريض|ملف|mrn|patient/.test(colText(c))) ?? ds.columns.find((c) => c.role === 'identifier' && /موظف|وظيف|emp/.test(colText(c)));
    if (id && !(id.key === ds.key_column && !/مريض|ملف/.test(colText(id)))) measure = { op: 'count_distinct', column: id.key };
  }
  if (measure) req.measure = measure;
  else if (!followUp) req.measure = { op: 'count' };

  // Categorical filters: any known value (or its Arabic label) mentioned in the question
  const filters: Filter[] = followUp ? [...req.filters] : [];
  const setFilter = (f: Filter) => { const i = filters.findIndex((x) => x.column === f.column && x.op !== 'gte' && x.op !== 'lt' && x.op !== 'gt' && x.op !== 'lte'); if (i >= 0) filters[i] = f; else filters.push(f); };
  for (const c of ds.columns.filter((x) => x.role === 'dimension')) {
    const vals = c.values ?? [];
    const genderCol = /جنس|gender|sex/.test(colText(c));
    if (genderCol) {
      const female = vals.find((v) => /^(f|female|انثي|اناث)$/i.test(normalizeArabic(v.value)));
      const male = vals.find((v) => /^(m|male|ذكر|ذكور)$/i.test(normalizeArabic(v.value)));
      if (/نساء|اناث|انثي|السيدات|الموظفات|ممرضات/.test(q) && female) { setFilter({ column: c.key, op: 'eq', value: female.value }); continue; }
      if (/رجال|ذكور|الذكر/.test(q) && male) { setFilter({ column: c.key, op: 'eq', value: male.value }); continue; }
    }
    if (/جنسي|nationality/.test(colText(c))) {
      const saudi = vals.find((v) => /saudi|سعود/i.test(v.value));
      if (saudi && /غير سعودي|غير السعوديين|وافد|غير المواطنين/.test(q)) { setFilter({ column: c.key, op: 'neq', value: saudi.value }); continue; }
      if (saudi && /سعودي|مواطن/.test(q)) { setFilter({ column: c.key, op: 'eq', value: saudi.value }); continue; }
    }
    const hits = vals.filter((v) => {
      const lab = normalizeArabic(keyLabel(c, undefined, v.value));
      const rawv = normalizeArabic(v.value);
      return (lab.length >= 3 && q.includes(lab.replace(/^ال/, ''))) || (rawv.length >= 4 && q.includes(rawv));
    });
    if (hits.length) setFilter(hits.length === 1 ? { column: c.key, op: 'eq', value: hits[0].value } : { column: c.key, op: 'in', value: hits.map((h) => h.value) });
  }
  const age = ageColumn(ds);
  if (age) {
    const nf = numericFilters(q, age);
    if (nf.length) { for (let i = filters.length - 1; i >= 0; i--) if (filters[i].column === age.key) filters.splice(i, 1); filters.push(...nf); }
  }
  req.filters = filters;

  // Grouping
  const by = q.split(/حسب|موزع|توزيع|وزعي|لكل|بحسب/).slice(1).join(' ') + (/شهري/.test(q) ? ' الشهر' : '') + (/يومي/.test(q) ? ' اليوم' : '');
  if (by.trim()) {
    const groups: GroupBy[] = [];
    const add = (g: GroupBy) => { if (groups.length < 2 && !groups.some((x) => x.column === g.column)) groups.push(g); };
    const dateCol = ds.columns.find((c) => c.key === ds.period_column) ?? ds.columns.find((c) => c.role === 'date');
    if (/الشهر|اشهر|شهري/.test(by) && dateCol) add({ column: dateCol.key, grain: 'month' });
    if (/اليوم|يومي|الايام/.test(by) && dateCol) add({ column: dateCol.key, grain: 'day' });
    if (/السنه|سنوي/.test(by) && dateCol) add({ column: dateCol.key, grain: 'year' });
    for (const c of ds.columns.filter((x) => x.role !== 'ignore' && x.role !== 'identifier')) {
      const l = normalizeArabic(c.label).replace(/^ال/, '');
      if (l.length >= 3 && by.includes(l)) add(c.type === 'number' ? { column: c.key, bins: defaultBins(c) } : c.type === 'date' || c.type === 'datetime' ? { column: c.key, grain: 'month' } : { column: c.key });
      else if (/العمر|الفئه العمريه|الاعمار/.test(by) && c === age) add({ column: c.key, bins: defaultBins(c) });
    }
    if (groups.length) req.group_by = groups;
  }

  // Period
  const periods = ds.period_column ? findPeriods(q, today) : [];
  if (periods.length) for (const p of periods) if (p.assumed) assumptions.push(p.assumed);
  if (periods.length && !ds.period_column) assumptions.push('هذه البيانات لقطة بلا فترة؛ لم تُطبق الفترة.');
  const compare = /قارن|مقارنه|مقابل/.test(q);
  if (compare && periods.length >= 2) {
    return done(periods.slice(0, 2).map((p) => ({ ...structuredClone(req), period: { start: p.start, end_exclusive: p.end_exclusive } })), assumptions);
  }
  if (compare && periods.length === 1) {
    const p = periods[0];
    return done([{ ...structuredClone(req), period: p }, { ...structuredClone(req), period: { start: addMonths(p.start, -1), end_exclusive: p.start } }].map((r) => ({ ...r, period: { start: r.period!.start, end_exclusive: r.period!.end_exclusive } })), assumptions);
  }
  if (periods.length) {
    const last = periods[periods.length - 1];
    req.period = { start: periods[0].start, end_exclusive: periods.length > 1 && /الي|حتي/.test(q) ? last.end_exclusive : periods[0].end_exclusive };
  } else if (!followUp && ds.period_column) {
    assumptions.push('لم تُحدد فترة؛ حُسبت كل البيانات المعتمدة.');
    req.period = null;
  }
  return done([req], assumptions);
}

function done(requests: StatRequest[], assumptions: string[]): ParseOutcome {
  return { kind: 'requests', requests, interpretation: '', assumptions };
}
