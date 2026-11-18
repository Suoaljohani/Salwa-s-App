// General statistics contract. Identical for the SQL engine (dataset_query) and the local engine (demo / preview).

export type ColType = 'text' | 'number' | 'date' | 'datetime' | 'boolean';
/** dimension = category; measure = numeric value; date = time column; identifier = hashed id (count distinct only); ignore = personal, never stored */
export type ColRole = 'dimension' | 'measure' | 'date' | 'identifier' | 'ignore';

export interface DatasetColumn {
  key: string;
  label: string;
  type: ColType;
  role: ColRole;
  source_header?: string;
  // catalog statistics (filled by ds_catalog / local engine)
  values?: { value: string; n: number }[];
  distinct?: number;
  min?: number | string | null;
  max?: number | string | null;
  nulls?: number;
}

export interface DatasetInfo {
  id: string;
  name: string;
  unit_label: string;
  description?: string | null;
  mode: 'snapshot' | 'append';
  period_column: string | null;
  key_column: string | null;
  header_signature?: string | null;
  version: number;
  columns: DatasetColumn[];
  row_count: number;
  coverage: { start: string | null; end_exclusive: string | null; file_name: string; as_of: string | null }[];
}

export interface Catalog {
  datasets: DatasetInfo[];
  version: number;
  hospital_name?: string;
  storage_bytes?: number;
  database_bytes?: number;
}

export type FilterOp = 'eq' | 'neq' | 'in' | 'not_in' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'is_null' | 'not_null';
export interface Filter { column: string; op: FilterOp; value?: string | number | boolean | (string | number)[] }

export type MeasureOp = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max';
export interface Measure { op: MeasureOp; column?: string }

export interface GroupBy { column: string; grain?: 'day' | 'month' | 'year'; bins?: number[] }

export interface StatRequest {
  dataset_id: string;
  measure: Measure;
  filters: Filter[];
  group_by: GroupBy[];
  /** local Riyadh days on the dataset's period column: [start, end_exclusive) */
  period?: { start: string; end_exclusive: string } | null;
}

export type CoverageStatus = 'complete' | 'partial' | 'none';
export interface Coverage {
  status: CoverageStatus;
  covered_days: number;
  total_days: number;
  gaps: { start: string; end_exclusive: string }[];
  months: { period: string; status: CoverageStatus }[];
}

export interface ResultRow { d1?: string; d2?: string; value: number }

export interface SourceRef { id: string; file_name: string; coverage_start: string | null; coverage_end_exclusive: string | null; as_of: string | null }

export interface StatResult {
  request: StatRequest;
  dataset: { id: string; name: string; unit_label: string; mode: 'snapshot' | 'append'; period_column: string | null };
  /** null = not computable (no coverage, or no values for avg/min/max). 0 = measured zero. */
  value: number | null;
  rows: ResultRow[];
  coverage: Coverage | null;
  excluded: { column: string; label: string; n: number; measure?: boolean }[];
  total_rows: number;
  sources: SourceRef[];
  dataset_version: number;
  extracted_at: string;
  demo?: boolean;
}

export type Row = Record<string, string | number | boolean | null>;

export class MetricError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}
