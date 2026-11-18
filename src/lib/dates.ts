// Asia/Riyadh is UTC+03:00 all year (no daylight saving). All period boundaries are local days.
export const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;
export const TZ = 'Asia/Riyadh';

/** Local Riyadh midnight of a YYYY-MM-DD day, as epoch ms. */
export function riyadhDayStartMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - RIYADH_OFFSET_MS;
}

/** YYYY-MM-DD of the Riyadh local day containing the instant. */
export function riyadhDayOf(ms: number): string {
  return new Date(ms + RIYADH_OFFSET_MS).toISOString().slice(0, 10);
}

export function riyadhMonthOf(ms: number): string {
  return riyadhDayOf(ms).slice(0, 7);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function addMonths(day: string, n: number): string {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}

export function monthStart(period: string): string {
  return `${period.slice(0, 7)}-01`;
}

export function daysBetween(start: string, endExclusive: string): number {
  return Math.round((riyadhDayStartMs(endExclusive) - riyadhDayStartMs(start)) / 86_400_000);
}

export function todayRiyadh(now = Date.now()): string {
  return riyadhDayOf(now);
}

/** Every YYYY-MM between start (inclusive) and endExclusive. */
export function monthsInRange(start: string, endExclusive: string): string[] {
  const out: string[] = [];
  let cur = monthStart(start);
  while (cur < endExclusive) {
    out.push(cur.slice(0, 7));
    cur = addMonths(cur, 1);
  }
  return out;
}

export function daysInRange(start: string, endExclusive: string): string[] {
  const out: string[] = [];
  for (let d = start; d < endExclusive; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Parse "dd-mm-yyyy HH:MM" (hospital system export, local time) into ISO with +03:00. */
export function parseLocalDateTime(text: string): string | null {
  const m = /^\s*(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*$/.exec(text);
  if (!m) return null;
  const [, dd, mm, yyyy, hh = '0', mi = '0', ss = '0'] = m;
  const d = Number(dd), mo = Number(mm), y = Number(yyyy), h = Number(hh), mn = Number(mi), s = Number(ss);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mn > 59 || s > 59) return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mn)}:${p(s)}+03:00`;
}

const fmtDate = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' });
const fmtDateTime = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
  timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

export function formatDay(day: string): string {
  return fmtDate.format(new Date(riyadhDayStartMs(day) + 12 * 3600_000));
}

export function formatInstant(iso: string): string {
  return fmtDateTime.format(new Date(iso));
}

/** Human Arabic period: "يوليو 2026", "1 – 15 يوليو 2026", or full dates. */
export function formatPeriod(start: string, endExclusive: string): string {
  const lastDay = addDays(endExclusive, -1);
  const [ys, ms, ds] = start.split('-').map(Number);
  const [ye, me, de] = lastDay.split('-').map(Number);
  const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const isMonthStart = ds === 1;
  const isMonthEnd = addDays(lastDay, 1).endsWith('-01');
  if (isMonthStart && isMonthEnd) {
    if (ys === ye && ms === me) return `${months[ms - 1]} ${ys}`;
    if (ys === ye && ms === 1 && me === 12) return `عام ${ys}`;
    if (ys === ye) return `${months[ms - 1]} – ${months[me - 1]} ${ys}`;
    return `${months[ms - 1]} ${ys} – ${months[me - 1]} ${ye}`;
  }
  if (start === lastDay) return formatDay(start);
  if (ys === ye && ms === me) return `${ds} – ${de} ${months[ms - 1]} ${ys}`;
  return `${formatDay(start)} – ${formatDay(lastDay)}`;
}
