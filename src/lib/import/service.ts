// Import pipeline against Supabase: keep the original, stage normalised rows, approve explicitly.
import { supabase } from '../supabase';
import type { ParseResult } from './visitReport';

export interface BatchRecord {
  id: string;
  file_name: string;
  file_sha256: string;
  storage_path: string | null;
  coverage_start: string;
  coverage_end_exclusive: string;
  declared_start: string | null;
  declared_end_inclusive: string | null;
  status: 'staged' | 'approved' | 'rolled_back' | 'rejected';
  row_count: number;
  rejected_count: number;
  duplicate_in_file: number;
  quality: Record<string, unknown>;
  created_at: string;
  approved_at: string | null;
}

export async function listBatches(): Promise<BatchRecord[]> {
  const { data, error } = await supabase().from('import_batches').select('*').order('created_at', { ascending: false }).limit(60);
  if (error) throw error;
  return data as BatchRecord[];
}

export async function findLiveBatchByHash(sha: string): Promise<BatchRecord | null> {
  const { data } = await supabase().from('import_batches').select('*').eq('file_sha256', sha).in('status', ['staged', 'approved']).maybeSingle();
  return (data as BatchRecord) ?? null;
}

export function overlapping(batches: BatchRecord[], start: string, endExclusive: string): BatchRecord[] {
  return batches.filter((b) => b.status === 'approved' && b.coverage_start < endExclusive && b.coverage_end_exclusive > start);
}

export interface StageProgress { done: number; total: number; phase: 'upload' | 'rows' | 'done' }

export async function stageImport(
  file: File, sha: string, parsed: ParseResult, coverage: { start: string; end_exclusive: string },
  onProgress: (p: StageProgress) => void, signal?: AbortSignal,
): Promise<BatchRecord> {
  const sb = supabase();
  const ext = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';
  const path = `originals/${sha}.${ext}`;
  onProgress({ done: 0, total: parsed.rows.length, phase: 'upload' });
  const up = await sb.storage.from('private-files').upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (up.error) throw new Error(`upload_failed: ${up.error.message}`);

  const quality = {
    issues: parsed.issues.slice(0, 200).map((i) => ({ row_no: i.row_no, code: i.code })),
    issue_counts: parsed.issues.reduce<Record<string, number>>((a, i) => { a[i.code] = (a[i.code] ?? 0) + 1; return a; }, {}),
    observed_first: parsed.observed.first,
    observed_last: parsed.observed.last,
    coverage_note: parsed.proposedCoverage?.note ?? null,
    ignored_personal_columns: parsed.columns.filter((c) => c.personal).map((c) => c.header),
  };
  const { data: batch, error } = await sb.from('import_batches').insert({
    file_name: file.name,
    file_sha256: sha,
    storage_path: path,
    declared_start: parsed.declared.start,
    declared_end_inclusive: parsed.declared.endInclusive,
    coverage_start: coverage.start,
    coverage_end_exclusive: coverage.end_exclusive,
    mapping: parsed.mapping,
    quality,
    rejected_count: parsed.totals.rejected,
  }).select('*').single();
  if (error) throw new Error(error.code === '23505' ? 'duplicate_file' : error.message);

  const CHUNK = 1000;
  for (let i = 0; i < parsed.rows.length; i += CHUNK) {
    if (signal?.aborted) throw new Error('aborted');
    const chunk = parsed.rows.slice(i, i + CHUNK).map((r) => ({
      row_no: r.row_no, visit_id: r.visit_id, mrn: r.mrn, encounter_type: r.encounter_type, department: r.department,
      clinic: r.clinic, gender: r.gender, age_years: r.age_years, nationality: r.nationality, is_saudi: r.is_saudi,
      payor: r.payor, patient_type: r.patient_type, visit_at: r.visit_at, discharge_type: r.discharge_type, los: r.los,
    }));
    const res = await sb.rpc('stage_rows', { p_batch: batch.id, p_rows: chunk });
    if (res.error) throw new Error(`stage_failed: ${res.error.message}`);
    onProgress({ done: Math.min(parsed.rows.length, i + CHUNK), total: parsed.rows.length, phase: 'rows' });
  }
  const { data: fresh } = await sb.from('import_batches').select('*').eq('id', batch.id).single();
  onProgress({ done: parsed.rows.length, total: parsed.rows.length, phase: 'done' });
  return fresh as BatchRecord;
}

export async function approveBatch(id: string): Promise<number> {
  const { data, error } = await supabase().rpc('approve_batch', { p_batch: id });
  if (error) throw error;
  return data as number;
}

export async function closeBatch(id: string, status: 'rolled_back' | 'rejected'): Promise<number> {
  const { data, error } = await supabase().rpc('close_batch', { p_batch: id, p_status: status });
  if (error) throw error;
  return data as number;
}

export async function originalUrl(path: string): Promise<string | null> {
  const { data } = await supabase().storage.from('private-files').createSignedUrl(path, 120);
  return data?.signedUrl ?? null;
}
