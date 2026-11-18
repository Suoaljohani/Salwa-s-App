// Single entry point for every surface (chat, indicators, Excel fill, export).
import { supabase } from '../supabase';
import { prefsStore } from '../prefs';
import { demoDataset } from '../demo/fixture';
import { runLocalQuery } from './localEngine';
import type { DataCatalog, MetricRequest, MetricResult } from './types';
import { MetricError } from './types';
import { parseQuestion, type ParseOutcome } from '../nlu/ruleParser';
import { todayRiyadh } from '../dates';

const cache = new Map<string, MetricResult>();
let cacheVersion = -1;

function canonical(req: MetricRequest): string {
  const f = Object.fromEntries(Object.entries(req.filters ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify([req.metric, req.start, req.end_exclusive, f, req.group_by ?? []]);
}

export function isDemo(): boolean {
  return prefsStore.get().demoMode;
}

/** Drop cached results when a new dataset version is approved. */
export function noteDatasetVersion(v: number) {
  if (v !== cacheVersion) { cache.clear(); cacheVersion = v; }
}

export async function queryMetric(req: MetricRequest, opts: { signal?: AbortSignal } = {}): Promise<MetricResult> {
  if (isDemo()) return runLocalQuery(demoDataset(), req);
  const key = canonical(req);
  const hit = cache.get(key);
  if (hit && hit.dataset_version === cacheVersion) return hit;
  let q = supabase().rpc('metric_query', { p_req: req });
  if (opts.signal) q = q.abortSignal(opts.signal);
  const { data, error } = await q;
  if (error) throw new MetricError(error.message.split(' ')[0] || 'query_failed', error.message);
  const res = data as MetricResult;
  noteDatasetVersion(res.dataset_version);
  cache.set(key, res);
  return res;
}

export async function getCatalog(): Promise<DataCatalog> {
  if (isDemo()) {
    const ds = demoDataset();
    const count = (k: 'encounter_type' | 'department' | 'payor' | 'discharge_type') => {
      const m = new Map<string, number>();
      for (const r of ds.rows) if (r[k]) m.set(r[k]!, (m.get(r[k]!) ?? 0) + 1);
      return [...m].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n);
    };
    return {
      hospital_name: 'بيانات تجريبية', dataset_version: 0, definition_version: 1,
      first_visit: ds.rows[0]?.visit_at ?? null, last_visit: ds.rows[ds.rows.length - 1]?.visit_at ?? null,
      total_visits: ds.rows.length,
      coverage: ds.windows.map((w) => ({ start: w.start, end_exclusive: w.end_exclusive, file_name: w.file_name })),
      values: { encounter_type: count('encounter_type'), department: count('department'), payor: count('payor'), discharge_type: count('discharge_type') },
    };
  }
  const { data, error } = await supabase().rpc('data_catalog');
  if (error) throw new MetricError('catalog_failed', error.message);
  const cat = data as DataCatalog;
  noteDatasetVersion(cat.dataset_version);
  return cat;
}

export type AssistantReply =
  | { kind: 'answer'; interpretation: string; assumptions: string[]; results: MetricResult[]; via: 'ai' | 'rules'; cached?: boolean; note?: string }
  | { kind: 'clarify'; question: string; options: string[] }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'rate_limited'; retryAfter: number }
  | { kind: 'error'; message: string };

async function viaRules(question: string, context: MetricRequest | null, note?: string): Promise<AssistantReply> {
  const out: ParseOutcome = parseQuestion(question, context);
  if (out.kind === 'clarify') return { kind: 'clarify', question: out.question, options: out.options ?? [] };
  if (out.kind === 'unsupported') return out;
  const results = await Promise.all(out.requests.map((r) => queryMetric(r)));
  return { kind: 'answer', interpretation: out.interpretation, assumptions: out.assumptions, results, via: 'rules', note };
}

export async function askAssistant(question: string, context: MetricRequest | null, signal?: AbortSignal): Promise<AssistantReply> {
  if (isDemo()) return viaRules(question, context);
  const { data, error } = await supabase().functions.invoke('assistant', {
    body: { question, context, today: todayRiyadh() },
    signal,
  } as Parameters<ReturnType<typeof supabase>['functions']['invoke']>[1]);
  if (error) {
    if (signal?.aborted) throw error;
    // Network or function failure: fall back to the local rule parser, against the same engine.
    return viaRules(question, context, 'تعذّر الوصول إلى خدمة الفهم الذكي؛ فُهم السؤال بالقواعد المحلية.');
  }
  const d = data as Record<string, unknown>;
  switch (d.kind) {
    case 'answer':
      (d.results as MetricResult[]).forEach((r) => noteDatasetVersion(r.dataset_version));
      return { kind: 'answer', interpretation: String(d.interpretation ?? ''), assumptions: (d.assumptions as string[]) ?? [], results: d.results as MetricResult[], via: 'ai', cached: !!d.cached };
    case 'clarify':
      return { kind: 'clarify', question: String(d.question), options: (d.options as string[]) ?? [] };
    case 'unsupported':
      return { kind: 'unsupported', reason: String(d.reason) };
    case 'rate_limited': {
      // Free-plan limit: answer with the local parser if it can, and say so.
      const local = await viaRules(question, context, 'بلغت خدمة الفهم الذكي حد الاستخدام المجاني مؤقتًا؛ فُهم السؤال بالقواعد المحلية.').catch(() => null);
      if (local && local.kind === 'answer') return local;
      return { kind: 'rate_limited', retryAfter: Number(d.retry_after) || 30 };
    }
    case 'ai_unavailable':
      return viaRules(question, context, 'خدمة الفهم الذكي غير متاحة الآن؛ فُهم السؤال بالقواعد المحلية.');
    default:
      return { kind: 'error', message: String(d.message ?? d.error ?? 'خطأ غير معروف') };
  }
}
