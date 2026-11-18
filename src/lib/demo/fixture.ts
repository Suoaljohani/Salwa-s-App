// Synthetic demonstration datasets. Every value is generated; none are hospital figures.
// Shown only in demo mode, always with a visible "بيانات تجريبية" label.
import type { DatasetInfo, Row } from '../metrics/types';
import type { LocalDataset } from '../metrics/localEngine';

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(rnd: () => number, a: T[]) => a[Math.floor(rnd() * a.length)];
const pad = (n: number) => String(n).padStart(2, '0');

const VISITS_INFO: DatasetInfo = {
  id: 'demo-visits', name: 'زيارات المرضى (تجريبي)', unit_label: 'زيارة', mode: 'append', period_column: 'visit_at', key_column: 'visit_id', version: 1, row_count: 0, coverage: [],
  columns: [
    { key: 'visit_id', label: 'رقم الزيارة', type: 'text', role: 'identifier' },
    { key: 'mrn', label: 'رقم الملف الطبي', type: 'text', role: 'identifier' },
    { key: 'encounter', label: 'نوع الزيارة', type: 'text', role: 'dimension' },
    { key: 'department', label: 'القسم', type: 'text', role: 'dimension' },
    { key: 'gender', label: 'الجنس', type: 'text', role: 'dimension' },
    { key: 'age', label: 'العمر', type: 'number', role: 'measure' },
    { key: 'nationality', label: 'الجنسية', type: 'text', role: 'dimension' },
    { key: 'payor', label: 'جهة الدفع', type: 'text', role: 'dimension' },
    { key: 'visit_at', label: 'تاريخ ووقت الزيارة', type: 'datetime', role: 'date' },
  ],
};

const STAFF_INFO: DatasetInfo = {
  id: 'demo-staff', name: 'الموظفون (تجريبي)', unit_label: 'موظف', mode: 'snapshot', period_column: null, key_column: 'emp_id', version: 1, row_count: 0, coverage: [],
  columns: [
    { key: 'emp_id', label: 'الرقم الوظيفي', type: 'text', role: 'identifier' },
    { key: 'category', label: 'الفئة الوظيفية', type: 'text', role: 'dimension' },
    { key: 'department', label: 'القسم', type: 'text', role: 'dimension' },
    { key: 'gender', label: 'الجنس', type: 'text', role: 'dimension' },
    { key: 'nationality', label: 'الجنسية', type: 'text', role: 'dimension' },
    { key: 'age', label: 'العمر', type: 'number', role: 'measure' },
    { key: 'years_service', label: 'سنوات الخدمة', type: 'number', role: 'measure' },
    { key: 'hire_date', label: 'تاريخ التعيين', type: 'date', role: 'date' },
  ],
};

let cached: LocalDataset[] | null = null;
export function demoDatasets(): LocalDataset[] {
  if (cached) return cached;
  const rnd = mulberry32(20261118);
  const visits: Row[] = [];
  const patients = Array.from({ length: 2600 }, (_, i) => ({ mrn: `D${i}`, g: rnd() < 0.56 ? 'Male' : 'Female', age: Math.floor(rnd() ** 1.4 * 88), saudi: rnd() < 0.9 }));
  const op = ['Diabetes Screening Clinic', 'Physical Therapy', 'Obstetrics & Gynecology', 'Pediatrics', 'Internal Medicine'];
  let seq = 1;
  for (let m = 0; m < 10; m++) {
    const days = new Date(Date.UTC(2026, m + 1, 0)).getUTCDate();
    for (let d = 1; d <= days; d++) {
      const er = Math.round((26 + rnd() * 10) * (1 + 0.18 * Math.sin((m / 12) * Math.PI * 2)));
      const opn = new Date(Date.UTC(2026, m, d)).getUTCDay() === 5 ? 0 : Math.round(7 + rnd() * 6);
      for (let k = 0; k < er + opn; k++) {
        const p = patients[Math.floor(rnd() ** 1.2 * patients.length)];
        const isEr = k < er;
        visits.push({
          visit_id: `V${seq++}`, mrn: p.mrn, encounter: isEr ? 'Emergency' : 'Outpatient',
          department: isEr ? 'Emergency Medicine' : pick(rnd, op), gender: p.g, age: rnd() < 0.003 ? null : p.age,
          nationality: p.saudi ? 'SAUDI ARABIA' : pick(rnd, ['EGYPT', 'JORDAN', 'SUDAN', 'PAKISTAN']),
          payor: rnd() < 0.7 ? 'Saudi Government' : 'Selfpay',
          visit_at: `2026-${pad(m + 1)}-${pad(d)}T${pad(isEr ? Math.floor(rnd() * 24) : 8 + Math.floor(rnd() * 8))}:${pad(Math.floor(rnd() * 60))}:00+03:00`,
        });
      }
    }
  }
  const staff: Row[] = [];
  const cats: [string, number][] = [['تمريض', 0.42], ['أطباء', 0.16], ['فنيون', 0.18], ['صيدلة', 0.05], ['إداريون', 0.19]];
  const depts = ['الطوارئ', 'التنويم', 'العيادات', 'المختبر', 'الأشعة', 'الصيدلية', 'الإدارة'];
  for (let i = 0; i < 640; i++) {
    let r = rnd(), cat = cats[0][0];
    for (const [c, w] of cats) { if (r < w) { cat = c; break; } r -= w; }
    const years = Math.floor(rnd() ** 1.6 * 28);
    staff.push({
      emp_id: `E${1000 + i}`, category: cat, department: pick(rnd, depts), gender: rnd() < (cat === 'تمريض' ? 0.75 : 0.4) ? 'Female' : 'Male',
      nationality: rnd() < 0.68 ? 'SAUDI ARABIA' : pick(rnd, ['INDIA', 'PHILIPPINES', 'EGYPT', 'PAKISTAN']),
      age: 23 + years + Math.floor(rnd() * 12), years_service: years, hire_date: `${2026 - years}-${pad(1 + Math.floor(rnd() * 12))}-${pad(1 + Math.floor(rnd() * 28))}`,
    });
  }
  cached = [
    { info: { ...VISITS_INFO, row_count: visits.length }, rows: visits, windows: [{ id: 'dv', file_name: 'بيانات تجريبية', start: '2026-01-01', end_exclusive: '2026-11-01' }], demo: true },
    { info: { ...STAFF_INFO, row_count: staff.length }, rows: staff, windows: [{ id: 'ds', file_name: 'بيانات تجريبية', start: null, end_exclusive: null, as_of: '2026-11-01' }], demo: true },
  ];
  return cached;
}
