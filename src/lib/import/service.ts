// Import pipeline against Supabase: keep the original, stage typed rows, approve explicitly.
import { supabase } from '../supabase';
import type { DatasetColumn } from '../metrics/types';
import type { ParsedTable } from './table';

export interface BatchRecord {
  id: string;
  dataset_id: string;
  file_name: string;
  file_sha256: string;
  storage_path: string | null;
  status: 'staged' | 'approved' | 'rolled_back' | 'rejected';
  coverage_start: string | null;
  coverage_end_exclusive: string | null;
  as_of: string | null;
  quality: Record<string, unknown>;
  row_count: number;
  duplicate_in_file: number;
  created_at: string;
  approved_at: string | null;
}

export interface DatasetDraft {
  id?: string;
  name: string;
  unit_label: string;
  description?: string;
  mode: 'snapshot' | 'append';
  period_column: string | null;
  key_column: string | null;
  columns: DatasetColumn[];
  header_signature: string;
}

export async function listBatches(): Promise<BatchRecord[]> {
  const { data, error } = await supabase().from('dataset_batches').select('*').order('created_at', { ascending: false }).limit(80);
  if (error) throw error;
  return data as BatchRecord[];
}

export async function findLiveBatchByHash(datasetId: string, sha: string): Promise<BatchRecord | null> {
  const { data } = await supabase().from('dataset_batches').select('*').eq('dataset_id', datasetId).eq('file_sha256', sha).in('status', ['staged', 'approved']).maybeSingle();
  return (data as BatchRecord) ?? null;
}

export async function saveDataset(d: DatasetDraft): Promise<string> {
  const row = {
    name: d.name.trim(), unit_label: d.unit_label.trim() || 'سجل', description: d.description ?? null, mode: d.mode,
    period_column: d.period_column, key_column: d.key_column, header_signature: d.header_signature,
    columns: d.columns.map(({ key, label, type, role, source_header }) => ({ key, label, type, role, source_header })),
    updated_at: new Date().toISOString(),
  };
  if (d.id) {
    const { error } = await supabase().from('datasets').update(row).eq('id', d.id);
    if (error) throw error;
    return d.id;
  }
  const { data, error } = await supabase().from('datasets').insert(row).select('id').single();
  if (error) throw error;
  return data.id as string;
}

export interface StageProgress { done: number; total: number; phase: 'upload' | 'rows' | 'done' }

export async function stageImport(
  file: File, sha: string, datasetId: string, parsed: ParsedTable,
  window: { coverage_start: string | null; coverage_end_exclusive: string | null; as_of: string | null },
  onProgress: (p: StageProgress) => void, signal?: AbortSignal,
): Promise<BatchRecord> {
  const sb = supabase();
  const ext = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';
  const path = `originals/${datasetId}/${sha}.${ext}`;
  onProgress({ done: 0, total: parsed.rows.length, phase: 'upload' });
  const up = await sb.storage.from('private-files').upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (up.error) throw new Error(`upload_failed: ${up.error.message}`);
  const quality = {
    invalid: Object.fromEntries(parsed.columns.filter((c) => c.invalid > 0).map((c) => [c.label, c.invalid])),
    empty_rows: parsed.emptyRows,
    ignored_columns: parsed.columns.filter((c) => c.role === 'ignore' && c.source_header).map((c) => c.source_header),
  };
  const { data: batch, error } = await sb.from('dataset_batches').insert({
    dataset_id: datasetId, file_name: file.name, file_sha256: sha, storage_path: path, quality, ...window,
  }).select('*').single();
  if (error) throw new Error(error.code === '23505' ? 'duplicate_file' : error.message);
  const CHUNK = 1000;
  for (let i = 0; i < parsed.rows.length; i += CHUNK) {
    if (signal?.aborted) throw new Error('aborted');
    const res = await sb.rpc('ds_stage_rows', { p_batch: batch.id, p_rows: parsed.rows.slice(i, i + CHUNK) });
    if (res.error) throw new Error(`stage_failed: ${res.error.message}`);
    onProgress({ done: Math.min(parsed.rows.length, i + CHUNK), total: parsed.rows.length, phase: 'rows' });
  }
  const { data: fresh } = await sb.from('dataset_batches').select('*').eq('id', batch.id).single();
  onProgress({ done: parsed.rows.length, total: parsed.rows.length, phase: 'done' });
  return fresh as BatchRecord;
}

export async function approveBatch(id: string): Promise<number> {
  const { data, error } = await supabase().rpc('ds_approve', { p_batch: id });
  if (error) throw error;
  return data as number;
}

export async function closeBatch(id: string, status: 'rolled_back' | 'rejected'): Promise<number> {
  const { data, error } = await supabase().rpc('ds_close', { p_batch: id, p_status: status });
  if (error) throw error;
  return data as number;
}

export async function originalUrl(path: string): Promise<string | null> {
  const { data } = await supabase().storage.from('private-files').createSignedUrl(path, 120);
  return data?.signedUrl ?? null;
}
