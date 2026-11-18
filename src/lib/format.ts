import { prefsStore } from './prefs';

const fmts = {
  latn: new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }),
  arab: new Intl.NumberFormat('ar-SA-u-nu-arab', { maximumFractionDigits: 1 }),
};

/** Exact grouped number in the preferred digit style. Never abbreviates. */
export function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return fmts[prefsStore.get().digits].format(n);
}

export function fmtPct(part: number, whole: number): string {
  if (!whole) return '—';
  return `${fmtNum(Math.round((part / whole) * 1000) / 10)}٪`;
}

export function fmtBytes(b: number): string {
  if (b < 1024) return `${fmtNum(b)} بايت`;
  if (b < 1024 ** 2) return `${fmtNum(Math.round(b / 102.4) / 10)} ك.ب`;
  if (b < 1024 ** 3) return `${fmtNum(Math.round(b / 1024 ** 2 * 10) / 10)} م.ب`;
  return `${fmtNum(Math.round(b / 1024 ** 3 * 100) / 100)} ج.ب`;
}

/** Arabic count noun agreement for the common units used here. */
export function countNoun(n: number, unit: 'visit' | 'patient'): string {
  const forms = unit === 'visit'
    ? { one: 'زيارة', two: 'زيارتان', few: 'زيارات', many: 'زيارة' }
    : { one: 'مريض', two: 'مريضان', few: 'مرضى', many: 'مريضًا' };
  const mod100 = n % 100;
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  if (mod100 >= 3 && mod100 <= 10) return forms.few;
  if (n === 0) return unit === 'visit' ? 'زيارة' : 'مريض';
  return forms.many;
}
