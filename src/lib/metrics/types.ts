// Shared request/result contract. Identical shape for the SQL engine (metric_query) and the local demo engine.

export type MetricId = 'visits' | 'distinct_patients';

export type Dimension =
  | 'month'
  | 'day'
  | 'encounter_type'
  | 'department'
  | 'payor'
  | 'discharge_type'
  | 'gender'
  | 'nationality_group'
  | 'age_band';

export interface MetricFilters {
  encounter_type?: string[];
  department?: string[];
  payor?: string[];
  discharge_type?: string[];
  gender?: 'M' | 'F';
  is_saudi?: boolean;
  /** inclusive */
  age_min?: number;
  /** exclusive */
  age_max_exclusive?: number;
}

export interface MetricRequest {
  metric: MetricId;
  /** YYYY-MM-DD, local Asia/Riyadh day, inclusive */
  start: string;
  /** YYYY-MM-DD, local Asia/Riyadh day, exclusive */
  end_exclusive: string;
  filters: MetricFilters;
  group_by: Dimension[];
}

export type CoverageStatus = 'complete' | 'partial' | 'none';

export interface Coverage {
  status: CoverageStatus;
  covered_days: number;
  total_days: number;
  gaps: { start: string; end_exclusive: string }[];
  months: { period: string; status: CoverageStatus }[];
}

export interface ResultRow {
  d1?: string;
  d2?: string;
  value: number;
}

export interface SourceRef {
  id: string;
  file_name: string;
  coverage_start: string;
  coverage_end_exclusive: string;
}

export interface MetricResult {
  request: MetricRequest;
  /** null = not computable (no coverage). 0 = measured zero. */
  value: number | null;
  rows: ResultRow[];
  coverage: Coverage;
  excluded: Partial<Record<'unknown_age' | 'unknown_gender' | 'unknown_nationality' | 'unknown_patient', number>>;
  sources: SourceRef[];
  dataset_version: number;
  definition_version: number;
  extracted_at: string;
  /** true when computed from the clearly-labelled demo fixture */
  demo?: boolean;
}

export interface CatalogValue {
  value: string;
  n: number;
}

export interface DataCatalog {
  hospital_name: string;
  dataset_version: number;
  definition_version: number;
  first_visit: string | null;
  last_visit: string | null;
  total_visits: number;
  coverage: { start: string; end_exclusive: string; file_name: string }[];
  values: {
    encounter_type: CatalogValue[];
    department: CatalogValue[];
    payor: CatalogValue[];
    discharge_type: CatalogValue[];
  };
  storage_bytes?: number;
  database_bytes?: number;
}

/** Normalised visit row: the only patient-level fields the app keeps. */
export interface VisitRow {
  visit_id: string;
  /** pseudonymous key (HMAC of MRN in production; opaque id in demo) */
  patient_key: string | null;
  encounter_type: string | null;
  department: string | null;
  clinic: string | null;
  gender: 'M' | 'F' | null;
  age_years: number | null;
  nationality: string | null;
  is_saudi: boolean | null;
  payor: string | null;
  patient_type: string | null;
  /** ISO with +03:00 offset */
  visit_at: string;
  discharge_type: string | null;
  los: number | null;
}

export interface CoverageWindow {
  start: string;
  end_exclusive: string;
  file_name: string;
  id: string;
}

export class MetricError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}
