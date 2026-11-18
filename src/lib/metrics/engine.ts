// Single entry point for every surface (chat, indicators, Excel fill, export).
import { supabase } from '../supabase';
import { prefsStore } from '../prefs';
import { demoDatasets } from '../demo/fixture';
import { localCatalogInfo, runLocalQuery } from './localEngine';
import type { Catalog, StatRequest, StatResult } from './types';
import { MetricError } from './types';
import { parseQuestion, type ParseOutcome } from '../nlu/ruleParser';
import { todayRiyadh } from '../dates';

const cache = new Map<string, StatResult>();
let catalogCache: { at: number; demo: boolean; cat: Catalog } | null = null;

export function isDemo(): boolean { return prefsStore.get().demoMode; }

export function invalidate() { cache.clear(); catalogCache = null; }

export async function getCatalog(force = false): Promise<Catalog> {
  const demo = isDemo();
  if (!force && catalogCache && catalogCache.demo === demo && Date.now() - catalogCache.at < 60_000) return catalogCache.cat;
  let cat: Catalog;
  if (demo) {
    cat = { datasets: demoDatasets().map(localCatalogInfo), version: 1, hospital_name: 'بيانات تجريبية' };
  } else {
    const { data, error } = await supabase().rpc('ds_catalog');
    if (error) throw new MetricError('catalog_failed', error.message);
    cat = data as Catalog;
  }
  catalogCache = { at: Date.now(), demo, cat };
  return cat;
}

export async function queryStat(req: StatRequest, opts: { signal?: AbortSignal } = {}): Promise<StatResult> {
  if (isDemo()) {
    const ds = demoDatasets().find((d) => d.info.id === req.dataset_id);
    if (!ds) throw new MetricError('unknown_dataset');
    return runLocalQuery(ds, req);
  }
  const cat = await getCatalog();
  const v = cat.datasets.find((d) => d.id === req.dataset_id)?.version ?? -1;
  const key = `${v}|${JSON.stringify(req)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let q = supabase().rpc('dataset_query', { p_req: req });
  if (opts.signal) q = q.abortSignal(opts.signal);
  const { data, error } = await q;
  if (error) throw new MetricError(error.message.split(' ')[0] || 'query_failed', error.message);
  const res = data as StatResult;
  cache.set(key, res);
  return res;
}

export type AssistantReply =
  | { kind: 'answer'; interpretation: string; assumptions: string[]; results: StatResult[]; via: 'ai' | 'rules'; cached?: boolean; note?: string }
  | { kind: 'clarify'; question: string; options: string[] }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'rate_limited'; retryAfter: number }
  | { kind: 'error'; message: string };

async function viaRules(question: string, context: StatRequest | null, note?: string): Promise<AssistantReply> {
  const cat = await getCatalog();
  const out: ParseOutcome = parseQuestion(question, cat, context);
  if (out.kind === 'clarify') return { kind: 'clarify', question: out.question, options: out.options ?? [] };
  if (out.kind === 'unsupported') return out;
  const results = await Promise.all(out.requests.map((r) => queryStat(r)));
  return { kind: 'answer', interpretation: out.interpretation, assumptions: out.assumptions, results, via: 'rules', note };
}

export async function askAssistant(question: string, context: StatRequest | null, signal?: AbortSignal): Promise<AssistantReply> {
  if (isDemo()) return viaRules(question, context);
  const { data, error } = await supabase().functions.invoke('assistant', {
    body: { question, context, today: todayRiyadh() },
    signal,
  } as Parameters<ReturnType<typeof supabase>['functions']['invoke']>[1]);
  if (error) {
    if (signal?.aborted) throw error;
    return viaRules(question, context, 'تعذّر الوصول إلى خدمة الفهم الذكي؛ فُهم السؤال بالقواعد المحلية.');
  }
  const d = data as Record<string, unknown>;
  switch (d.kind) {
    case 'answer':
      return { kind: 'answer', interpretation: String(d.interpretation ?? ''), assumptions: (d.assumptions as string[]) ?? [], results: d.results as StatResult[], via: 'ai', cached: !!d.cached };
    case 'clarify':
      return { kind: 'clarify', question: String(d.question), options: (d.options as string[]) ?? [] };
    case 'unsupported':
      return { kind: 'unsupported', reason: String(d.reason) };
    case 'rate_limited': {
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
