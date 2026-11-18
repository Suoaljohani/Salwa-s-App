// Synthetic demonstration dataset. Every value is generated; none are hospital figures.
// Shown only when demo mode is on, always with a visible "بيانات تجريبية" label.
import type { CoverageWindow, VisitRow } from '../metrics/types';
import type { LocalDataset } from '../metrics/localEngine';

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEPTS_OP = ['عيادة فحص السكري', 'العلاج الطبيعي', 'النساء والولادة', 'طب الأطفال', 'الطب الباطني'];

let cached: LocalDataset | null = null;
export function demoDataset(): LocalDataset {
  if (cached) return cached;
  const rnd = mulberry32(20261118);
  const rows: VisitRow[] = [];
  const patients = Array.from({ length: 2600 }, (_, i) => ({
    key: `demo-${i}`,
    gender: (rnd() < 0.56 ? 'M' : 'F') as 'M' | 'F',
    birthAge: Math.floor(rnd() ** 1.4 * 88),
    saudi: rnd() < 0.9,
  }));
  let seq = 1;
  // Jan–Oct 2026 covered; November not yet imported (demonstrates a coverage gap).
  for (let m = 0; m < 10; m++) {
    const days = new Date(Date.UTC(2026, m + 1, 0)).getUTCDate();
    for (let d = 1; d <= days; d++) {
      const season = 1 + 0.18 * Math.sin((m / 12) * Math.PI * 2);
      const er = Math.round((26 + rnd() * 10) * season);
      const op = new Date(Date.UTC(2026, m, d)).getUTCDay() === 5 ? 0 : Math.round(7 + rnd() * 6);
      for (let k = 0; k < er + op; k++) {
        const p = patients[Math.floor(rnd() ** 1.2 * patients.length)];
        const isEr = k < er;
        const h = isEr ? Math.floor(rnd() * 24) : 8 + Math.floor(rnd() * 8);
        const mi = Math.floor(rnd() * 60);
        const pad = (n: number) => String(n).padStart(2, '0');
        rows.push({
          visit_id: `DEMO${seq++}`,
          patient_key: p.key,
          encounter_type: isEr ? 'Emergency' : 'Outpatient',
          department: isEr ? 'طب الطوارئ' : DEPTS_OP[Math.floor(rnd() * DEPTS_OP.length)],
          clinic: null,
          gender: p.gender,
          age_years: rnd() < 0.003 ? null : Math.min(99, p.birthAge + Math.floor(m / 12)),
          nationality: p.saudi ? 'SAUDI ARABIA' : 'OTHER',
          is_saudi: p.saudi,
          payor: rnd() < 0.7 ? 'Saudi Government' : 'Selfpay',
          patient_type: null,
          visit_at: `2026-${pad(m + 1)}-${pad(d)}T${pad(h)}:${pad(mi)}:00+03:00`,
          discharge_type: isEr ? null : rnd() < 0.95 ? 'Discharged' : 'Referred to Another Hospital',
          los: null,
        });
      }
    }
  }
  const windows: CoverageWindow[] = [{ id: 'demo', start: '2026-01-01', end_exclusive: '2026-11-01', file_name: 'بيانات تجريبية' }];
  cached = { rows, windows, datasetVersion: 0, demo: true };
  return cached;
}
