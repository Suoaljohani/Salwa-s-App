// Synthetic fixtures shared by the TS engine tests and the SQL check. No real people.
import type { DatasetInfo, Row } from '../../src/lib/metrics/types';
import type { LocalDataset } from '../../src/lib/metrics/localEngine';

export const visitsInfo: DatasetInfo = {
  id: 'v', name: 'زيارات', unit_label: 'زيارة', mode: 'append', period_column: 'at', key_column: 'vid', version: 1, row_count: 0, coverage: [],
  columns: [
    { key: 'vid', label: 'رقم الزيارة', type: 'text', role: 'identifier' },
    { key: 'mrn', label: 'رقم الملف الطبي', type: 'text', role: 'identifier' },
    { key: 'enc', label: 'نوع الزيارة', type: 'text', role: 'dimension' },
    { key: 'gender', label: 'الجنس', type: 'text', role: 'dimension' },
    { key: 'nat', label: 'الجنسية', type: 'text', role: 'dimension' },
    { key: 'age', label: 'العمر', type: 'number', role: 'measure' },
    { key: 'at', label: 'تاريخ الزيارة', type: 'datetime', role: 'date' },
  ],
};
const v = (vid: string, mrn: string | null, enc: string, gender: string | null, age: number | null, at: string, nat = 'SAUDI ARABIA'): Row =>
  ({ vid, mrn, enc, gender, age, at, nat });

/** July 2026 */
export const batchA: Row[] = [
  v('A1', 'P1', 'Emergency', 'Male', 30, '2026-07-01T00:00:00+03:00'),
  v('A2', 'P1', 'Emergency', 'Male', 30, '2026-07-05T10:00:00+03:00'),
  v('A3', 'P1', 'Emergency', 'Male', 30, '2026-07-20T22:00:00+03:00'),
  v('A4', 'P2', 'Emergency', 'Female', 18, '2026-07-10T09:00:00+03:00'),
  v('A5', 'P3', 'Emergency', 'Male', 17, '2026-07-11T09:00:00+03:00'),
  v('A6', 'P4', 'Emergency', null, null, '2026-07-12T09:00:00+03:00'),
  v('A7', 'P5', 'Outpatient', 'Female', 40, '2026-07-15T09:00:00+03:00', 'EGYPT'),
  v('A8', 'P6', 'Outpatient', 'Female', 8, '2026-07-31T23:59:00+03:00'),
  v('A9', null, 'Emergency', 'Male', 50, '2026-07-16T09:00:00+03:00'),
];
/** 1–15 August */
export const batchD: Row[] = [
  v('D1', 'P1', 'Emergency', 'Male', 30, '2026-08-01T00:00:00+03:00'),
  v('D2', 'P8', 'Emergency', 'Female', 22, '2026-08-10T12:00:00+03:00'),
];

export const staffInfo: DatasetInfo = {
  id: 's', name: 'الموظفون', unit_label: 'موظف', mode: 'snapshot', period_column: null, key_column: 'emp', version: 1, row_count: 0, coverage: [],
  columns: [
    { key: 'emp', label: 'الرقم الوظيفي', type: 'text', role: 'identifier' },
    { key: 'cat', label: 'الفئة الوظيفية', type: 'text', role: 'dimension' },
    { key: 'gender', label: 'الجنس', type: 'text', role: 'dimension' },
    { key: 'years', label: 'سنوات الخدمة', type: 'number', role: 'measure' },
    { key: 'hired', label: 'تاريخ التعيين', type: 'date', role: 'date' },
  ],
};
export const staffRows: Row[] = [
  { emp: 'E1', cat: 'تمريض', gender: 'Female', years: 5, hired: '2021-03-01' },
  { emp: 'E2', cat: 'تمريض', gender: 'Female', years: 12, hired: '2014-09-15' },
  { emp: 'E3', cat: 'أطباء', gender: 'Male', years: 3, hired: '2023-01-10' },
  { emp: 'E4', cat: 'إداريون', gender: 'Male', years: null, hired: null },
  { emp: 'E5', cat: 'تمريض', gender: 'Male', years: 0, hired: '2026-06-01' },
];

export const visitsDs = (rows: Row[], windows: { start: string; end_exclusive: string }[]): LocalDataset =>
  ({ info: visitsInfo, rows, windows: windows.map((w, i) => ({ ...w, id: String(i), file_name: `f${i}` })), demo: false });
export const staffDs: LocalDataset = { info: staffInfo, rows: staffRows, windows: [{ id: 's1', file_name: 'staff.xlsx', start: null, end_exclusive: null, as_of: '2026-11-01' }], demo: false };
