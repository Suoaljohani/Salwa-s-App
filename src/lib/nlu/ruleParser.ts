// Deterministic Arabic question parser. Used in demo mode and as a fallback when the free AI quota
// is exhausted or the service is unreachable. It handles the common question shapes only and says so.
import { MONTHS_AR } from '../metrics/catalog';
import type { Dimension, MetricRequest } from '../metrics/types';
import { addDays, addMonths, todayRiyadh } from '../dates';

export type ParseOutcome =
  | { kind: 'requests'; requests: MetricRequest[]; interpretation: string; assumptions: string[] }
  | { kind: 'clarify'; question: string; options?: string[] }
  | { kind: 'unsupported'; reason: string };

const MONTH_ALIASES: [RegExp, number][] = [
  [/يناير|كانون الثاني/, 1], [/فبراير|شباط/, 2], [/مارس|آذار|اذار/, 3], [/أبريل|ابريل|إبريل|نيسان/, 4],
  [/مايو|أيار|ايار/, 5], [/يونيو|يونيه|حزيران/, 6], [/يوليو|يوليه|تموز/, 7], [/أغسطس|اغسطس|آب/, 8],
  [/سبتمبر|أيلول|ايلول/, 9], [/أكتوبر|اكتوبر|تشرين الأول/, 10], [/نوفمبر|تشرين الثاني/, 11], [/ديسمبر|كانون الأول/, 12],
];

export function normalizeArabic(s: string): string {
  return s
    .replace(/[ً-ْـ]/g, '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

interface Period { start: string; end_exclusive: string; label: string; assumed?: string }

function findMonths(q: string, today: string): Period[] {
  const out: { idx: number; p: Period }[] = [];
  for (const [re, m] of MONTH_ALIASES) {
    const g = new RegExp(re.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = g.exec(q))) {
      const after = q.slice(match.index, match.index + 30);
      const y = /(20\d{2})/.exec(after)?.[1];
      let year = y ? Number(y) : Number(today.slice(0, 4));
      let assumed: string | undefined;
      if (!y) {
        const candidate = `${year}-${String(m).padStart(2, '0')}-01`;
        if (candidate > today) year -= 1;
        assumed = `افتُرضت سنة ${year}`;
      }
      const start = `${year}-${String(m).padStart(2, '0')}-01`;
      out.push({ idx: match.index, p: { start, end_exclusive: addMonths(start, 1), label: `${MONTHS_AR[m - 1]} ${year}`, assumed } });
    }
  }
  return out.sort((a, b) => a.idx - b.idx).map((x) => x.p);
}

function findPeriods(q: string, today: string): Period[] {
  const thisMonth = `${today.slice(0, 7)}-01`;
  if (/الشهر (الماضي|السابق)/.test(q)) {
    const s = addMonths(thisMonth, -1);
    return [{ start: s, end_exclusive: thisMonth, label: 'الشهر الماضي' }];
  }
  if (/هذا الشهر|الشهر الحالي/.test(q)) return [{ start: thisMonth, end_exclusive: addDays(today, 1), label: 'الشهر الحالي حتى اليوم' }];
  const qm = /الربع (الأول|الثاني|الثالث|الرابع)/.exec(q);
  if (qm) {
    const n = ['الأول', 'الثاني', 'الثالث', 'الرابع'].indexOf(qm[1]);
    const y = /(20\d{2})/.exec(q)?.[1] ?? today.slice(0, 4);
    const s = `${y}-${String(n * 3 + 1).padStart(2, '0')}-01`;
    return [{ start: s, end_exclusive: addMonths(s, 3), label: `الربع ${qm[1]} ${y}`, assumed: /(20\d{2})/.test(q) ? undefined : `افتُرضت سنة ${y}` }];
  }
  const months = findMonths(q, today);
  if (months.length) return months;
  const y = /(?:عام|سنة)\s*(20\d{2})/.exec(q)?.[1];
  if (y) return [{ start: `${y}-01-01`, end_exclusive: `${Number(y) + 1}-01-01`, label: `عام ${y}` }];
  return [];
}

export function parseQuestion(raw: string, previous?: MetricRequest | null, today = todayRiyadh()): ParseOutcome {
  const q = normalizeArabic(raw);
  if (/ctas|سي ?تاس|الفرز|التصنيف الإسعافي/i.test(q)) return { kind: 'unsupported', reason: 'تصنيف CTAS غير موجود في تقرير الزيارات المعتمد حاليًا.' };
  if (/تشخيص|سرير|أسرة|اسرة|تنويم/.test(q)) return { kind: 'unsupported', reason: 'هذا الحقل غير متاح في المصدر المعتمد حاليًا.' };

  const isFollowUp = !!previous && q.length < 40 && /^(و|طيب|وال|فقط|بس)/.test(q);
  const base: MetricRequest = isFollowUp
    ? structuredClone(previous!)
    : { metric: 'visits', start: '', end_exclusive: '', filters: {}, group_by: [] };
  const assumptions: string[] = [];

  if (/مرضى مختلف|المرضى المختلف|عدد المرضى|كم مريض|مراجعين مختلف|أشخاص|اشخاص/.test(q)) base.metric = 'distinct_patients';
  else if (/زيار|مراجع/.test(q) && !isFollowUp) base.metric = 'visits';

  if (/طوارئ|الطوارى|اسعاف|إسعاف/.test(q)) base.filters.encounter_type = ['Emergency'];
  else if (/عياد|خارجي/.test(q)) base.filters.encounter_type = ['Outpatient'];

  if (/النساء|إناث|اناث|السيدات|نساء/.test(q)) base.filters.gender = 'F';
  else if (/ذكور|الرجال|رجال/.test(q)) base.filters.gender = 'M';
  if (/غير سعودي|غير السعوديين|وافد|غير المواطنين/.test(q)) base.filters.is_saudi = false;
  else if (/سعودي|مواطن/.test(q)) base.filters.is_saudi = true;

  const range = /من (\d{1,3}) (?:إلى|الى|حتى) (?:أقل من |اقل من )?(\d{1,3})/.exec(q);
  const atLeast = /(\d{1,3}) ?(?:سنة|سنه|عام)? ?(?:فأكثر|فما فوق|فاكثر|وأكثر|واكثر|فوق)/.exec(q);
  const olderThan = /(?:أكبر|اكبر|أكثر|اكثر) من (\d{1,3})/.exec(q);
  const under = /(?:أقل|اقل|دون|تحت) (?:من )?(\d{1,3})/.exec(q);
  if (range) { base.filters.age_min = Number(range[1]); base.filters.age_max_exclusive = Number(range[2]) + (/أقل من|اقل من/.test(range[0]) ? 0 : 1); }
  else {
    if (atLeast) base.filters.age_min = Number(atLeast[1]);
    else if (olderThan) base.filters.age_min = Number(olderThan[1]) + 1;
    if (under) base.filters.age_max_exclusive = Number(under[1]);
  }
  if (/أطفال|اطفال/.test(q) && base.filters.age_max_exclusive === undefined && base.filters.age_min === undefined) {
    return { kind: 'clarify', question: 'ما الحد العمري للأطفال في هذا السؤال؟', options: ['أقل من 14', 'أقل من 18'] };
  }

  const groups: Dimension[] = [];
  const by = q.split(/حسب|موزع|توزيع|وزعي|لكل/).slice(1).join(' ');
  if (by || /شهري/.test(q)) {
    const t = by + (/شهري/.test(q) ? ' الشهر' : '');
    const add = (d: Dimension) => { if (!groups.includes(d) && groups.length < 2) groups.push(d); };
    if (/الشهر|شهري|أشهر/.test(t)) add('month');
    if (/الجنس|ذكور|إناث/.test(t)) add('gender');
    if (/العمر|الفئ|الأعمار/.test(t)) add('age_band');
    if (/القسم|الأقسام|العيادة|العيادات/.test(t)) add('department');
    if (/نوع الزيارة|الطوارئ والعيادات/.test(t)) add('encounter_type');
    if (/الجنسية|سعودي/.test(t)) add('nationality_group');
    if (/الدفع|الدافع|التأمين/.test(t)) add('payor');
    if (/اليوم|يومي|الأيام/.test(t)) add('day');
    if (/الخروج/.test(t)) add('discharge_type');
  }
  if (groups.length) base.group_by = groups;

  const periods = findPeriods(q, today);
  if (!periods.length) {
    if (isFollowUp && base.start) return finish([base], q, assumptions, isFollowUp);
    if (/قارن|مقارنة/.test(q) && previous) {
      const prevStart = addMonths(previous.start, -1);
      return finish([previous, { ...structuredClone(previous), start: prevStart, end_exclusive: previous.start }], q, assumptions, false);
    }
    return { kind: 'clarify', question: 'ما الفترة المطلوبة؟ مثل «أكتوبر 2026» أو «الربع الأول 2026».' };
  }
  for (const p of periods) if (p.assumed) assumptions.push(p.assumed);

  if (/قارن|مقارنة|مقابل|بين/.test(q) && periods.length >= 2) {
    const reqs = periods.slice(0, 2).map((p) => ({ ...structuredClone(base), start: p.start, end_exclusive: p.end_exclusive }));
    return finish(reqs, q, assumptions, false);
  }
  if (/قارن|بالشهر السابق|بالشهر الماضي/.test(q) && periods.length === 1) {
    const p = periods[0];
    const prevStart = addMonths(p.start, -1);
    return finish([
      { ...structuredClone(base), start: p.start, end_exclusive: p.end_exclusive },
      { ...structuredClone(base), start: prevStart, end_exclusive: p.start },
    ], q, assumptions, false);
  }
  if (periods.length >= 2 && /إلى|الى|حتى/.test(q)) {
    base.start = periods[0].start;
    base.end_exclusive = periods[periods.length - 1].end_exclusive;
  } else {
    base.start = periods[0].start;
    base.end_exclusive = periods[0].end_exclusive;
  }
  return finish([base], q, assumptions, isFollowUp);
}

function finish(requests: MetricRequest[], _q: string, assumptions: string[], followUp: boolean): ParseOutcome {
  return {
    kind: 'requests',
    requests,
    interpretation: followUp ? 'تعديل على السؤال السابق' : '',
    assumptions,
  };
}
