// Assistant: turns an Arabic question into a validated statistics request over any approved dataset
// (Groq tool call), then computes it with public.dataset_query under the caller's own session.
// The model never produces the numbers that are shown. Only the question, column names and
// low-cardinality category values are sent — never rows, identifiers or personal fields.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = Deno.env.get('GROQ_MODEL') ?? 'openai/gpt-oss-120b';
const PROMPT_VERSION = 6;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

interface Col { key: string; label: string; type: string; role: string; values?: { value: string; n: number }[]; distinct?: number; min?: unknown; max?: unknown }
interface Ds { id: string; name: string; description?: string | null; unit_label: string; mode: string; period_column: string | null; key_column: string | null; version: number; columns: Col[]; row_count: number; coverage: { start: string | null; end_exclusive: string | null; as_of: string | null }[] }
interface Catalog { datasets: Ds[]; version: number }

const FILTER_OPS = ['eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'contains', 'is_null', 'not_null'];
const MEASURE_OPS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'];

const requestSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    dataset_id: { type: 'string', description: 'id of the dataset from the catalog' },
    measure: {
      type: 'object', additionalProperties: false,
      properties: { op: { type: 'string', enum: MEASURE_OPS }, column: { type: 'string', description: 'column key; required unless op=count' } },
      required: ['op'],
    },
    filters: {
      type: 'array', maxItems: 12,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          column: { type: 'string' }, op: { type: 'string', enum: FILTER_OPS },
          value: { description: 'string, number, boolean, or array for in/not_in. Dates as YYYY-MM-DD.' },
        },
        required: ['column', 'op'],
      },
    },
    group_by: {
      type: 'array', maxItems: 2,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          column: { type: 'string' },
          grain: { type: 'string', enum: ['day', 'month', 'year'], description: 'for date columns' },
          bins: { type: 'array', items: { type: 'number' }, description: 'for number columns, ascending lower bounds e.g. age [14,18,45,65]' },
        },
        required: ['column'],
      },
    },
    period: {
      type: 'object', additionalProperties: false,
      description: 'only for datasets that have a period column; Riyadh local days',
      properties: { start: { type: 'string', description: 'YYYY-MM-DD inclusive' }, end_exclusive: { type: 'string', description: 'YYYY-MM-DD, day after the last day' } },
      required: ['start', 'end_exclusive'],
    },
  },
  required: ['dataset_id', 'measure', 'filters', 'group_by'],
};

const tools = [
  { type: 'function', function: { name: 'statistics', description: 'Compute one statistic, or two for a comparison.', parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      requests: { type: 'array', items: requestSchema, minItems: 1, maxItems: 2 },
      interpretation: { type: 'string', description: 'One short Arabic sentence of exactly what is counted.' },
      assumptions: { type: 'array', items: { type: 'string' }, description: 'Short Arabic notes for defaults applied.' },
    },
    required: ['requests', 'interpretation'] } } },
  { type: 'function', function: { name: 'clarify', description: 'Ask one short Arabic question when the answer would change materially.', parameters: {
    type: 'object', additionalProperties: false,
    properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' }, maxItems: 4 } }, required: ['question'] } } },
  { type: 'function', function: { name: 'unsupported', description: 'No dataset contains what is asked.', parameters: {
    type: 'object', additionalProperties: false, properties: { reason: { type: 'string' } }, required: ['reason'] } } },
];

const TYPE_AR: Record<string, string> = { text: 'نص', number: 'رقم', date: 'تاريخ', datetime: 'تاريخ ووقت', boolean: 'نعم/لا' };

const normAr = (t: string) => t.toLowerCase().replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');

/** Rank datasets by overlap with the question so only the relevant ones are described in detail. */
function rankDatasets(cat: Catalog, question: string, contextId: string | null): Ds[] {
  const q = normAr(question);
  const words = q.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3).map((w) => w.replace(/^(ال|وال|بال|لل)/, ''));
  const hit = (text: string) => { const t = normAr(text); return words.filter((w) => w.length >= 3 && t.includes(w)).length; };
  const scored = cat.datasets.filter((d) => d.row_count > 0).map((d) => {
    let s = hit(`${d.name} ${d.unit_label}`) * 4 + hit(d.description ?? '') * 2;
    for (const c of d.columns) {
      if (c.role === 'ignore') continue;
      s += hit(c.label);
      for (const v of (c.values ?? []).slice(0, 25)) if (v.value.length >= 3 && q.includes(normAr(v.value))) s += 2;
    }
    if (/ctas|فرز/.test(q) && /ctas/i.test(d.name)) s += 6;
    if (d.id === contextId) s += 3;
    return { d, s: s + Math.min(2, Math.log10(Math.max(1, d.row_count)) / 3) };
  }).sort((a, b) => b.s - a.s);
  return scored.map((x) => x.d);
}

function describeDataset(d: Ds): string {
  const cov = d.mode === 'append' && d.period_column
    ? `عمود الفترة ${d.period_column}، مغطى: ${d.coverage.map((c) => `${c.start}..${c.end_exclusive}`).join(', ') || '—'}`
    : `بلا عمود فترة (أرقام مجمعة أو قائمة)${d.coverage.at(-1)?.as_of ? `، حتى ${d.coverage.at(-1)!.as_of}` : ''}`;
  const cols = d.columns.filter((c) => c.role !== 'ignore').slice(0, 24).map((c) => {
    let extra = '';
    if (c.role === 'identifier') extra = 'معرّف (للعد المميز فقط)';
    else if (c.type === 'text' && c.values && (c.distinct ?? c.values.length) <= 40) extra = c.values.slice(0, 20).map((v) => v.value.slice(0, 40)).join(' | ');
    else if (c.type === 'text') extra = `${c.distinct ?? '?'} قيمة مختلفة، أكثرها: ${(c.values ?? []).slice(0, 5).map((v) => v.value.slice(0, 40)).join(' | ')}`;
    else if (c.min != null) extra = `${c.min}..${c.max}`;
    return `  - ${c.key} (${c.label}، ${TYPE_AR[c.type] ?? c.type}): ${extra}`;
  }).join('\n');
  return `[${d.id}] ${d.name} — الوحدة: ${d.unit_label} — ${d.description ?? ''} — ${cov} — ${d.row_count} سجل\n${cols}`;
}

function systemPrompt(cat: Catalog, today: string, question: string, contextId: string | null): string {
  const ranked = rankDatasets(cat, question, contextId);
  const detailed = ranked.slice(0, 4);
  const others = ranked.slice(4);
  return [
    'أنت محلل يحوّل أسئلة رئيسة قسم الإحصاء الطبي إلى طلب إحصائي منظم عبر الأدوات فقط. لا تكتب أرقامًا ولا نتائج.',
    `اليوم بتوقيت الرياض: ${today}.`,
    'قواعد:',
    '- اختر قاعدة البيانات المناسبة من الفهرس المفصل. إن احتمل السؤال أكثر من قاعدة وتغير الجواب فاسأل بـ clarify.',
    '- إن كانت القاعدة المناسبة في «قواعد أخرى» فقط فاستخدم clarify واقترح اسمها لتعيد المستخدمة صياغة السؤال باسمها.',
    '- العد: measure.op=count. «مختلفين/بدون تكرار» = count_distinct على عمود المعرّف المناسب (رقم الملف للمرضى).',
    '- متوسط/مجموع/أعلى/أدنى على أعمدة الأرقام فقط. في القواعد المجمعة (بلا فترة) الأرقام جاهزة: استخدم sum على عمود العدد المناسب لا count.',
    '- المرشحات بالقيم كما تظهر في الفهرس حرفيًا. «18 فأكثر» = gte 18، «أكبر من 18» = gt 18، «أقل من 18» = lt 18.',
    '- «حسب X» = group_by. أعمدة التاريخ تحتاج grain (month افتراضيًا). أعمدة الأرقام مثل العمر تحتاج bins (العمر: [14,18,45,65]).',
    '- period فقط للقواعد ذات عمود فترة. «الشهر الماضي» = الشهر التقويمي السابق. end_exclusive = اليوم التالي لآخر يوم.',
    '- الشهر بلا سنة: أحدث سنة لا تتجاوز اليوم، واذكر ذلك في assumptions. لا ترفض لأن الفترة غير مغطاة.',
    '- المقارنة بين فترتين: requests بعنصرين. المتابعة مثل «والنساء فقط؟» تعدّل الطلب السابق المرفق.',
    '- إن لم يوجد عمود يجيب عن السؤال فاستخدم unsupported.',
    '- خاطب المستخدمة بصيغة المؤنث وباختصار.',
    'الفهرس المفصل:',
    detailed.map(describeDataset).join('\n\n'),
    others.length ? `قواعد أخرى: ${others.map((d) => `${d.name} (${d.unit_label})`).join('، ')}` : '',
  ].join('\n');
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function sanitize(r: Record<string, unknown>, cat: Catalog) {
  const ds = cat.datasets.find((d) => d.id === r.dataset_id);
  if (!ds) throw new Error('unknown_dataset');
  const col = (k: unknown) => {
    const c = ds.columns.find((x) => x.key === k && x.role !== 'ignore');
    if (!c) throw new Error(`unknown_column:${k}`);
    return c;
  };
  const m = (r.measure ?? { op: 'count' }) as { op: string; column?: string };
  if (!MEASURE_OPS.includes(m.op)) throw new Error('bad_measure');
  const measure = m.op === 'count' ? { op: 'count' } : { op: m.op, column: col(m.column).key };
  const filters = ((r.filters as Record<string, unknown>[]) ?? []).slice(0, 12).map((f) => {
    const c = col(f.column);
    const op = String(f.op);
    if (!FILTER_OPS.includes(op)) throw new Error('bad_filter_op');
    // Categorical values must exist when the full value list is known.
    const known = c.type === 'text' && c.values && (c.distinct ?? c.values.length) <= c.values.length ? new Set(c.values.map((v) => v.value)) : null;
    if (known && (op === 'eq' || op === 'neq') && !known.has(String(f.value))) throw new Error(`unknown_value:${c.key}`);
    if (known && (op === 'in' || op === 'not_in') && !(Array.isArray(f.value) && f.value.every((v) => known.has(String(v))))) throw new Error(`unknown_value:${c.key}`);
    return op === 'is_null' || op === 'not_null' ? { column: c.key, op } : { column: c.key, op, value: f.value };
  });
  const group_by = ((r.group_by as Record<string, unknown>[]) ?? []).slice(0, 2).map((g) => {
    const c = col(g.column);
    const out: Record<string, unknown> = { column: c.key };
    if (c.type === 'date' || c.type === 'datetime') out.grain = ['day', 'month', 'year'].includes(String(g.grain)) ? g.grain : 'month';
    if (c.type === 'number' && Array.isArray(g.bins) && g.bins.length) out.bins = (g.bins as number[]).filter(Number.isFinite).slice(0, 20).sort((a, b) => a - b);
    return out;
  });
  let period: { start: string; end_exclusive: string } | null = null;
  const p = r.period as { start?: string; end_exclusive?: string } | undefined;
  if (p && ds.period_column) {
    if (!DAY.test(String(p.start)) || !DAY.test(String(p.end_exclusive))) throw new Error('bad_dates');
    period = { start: p.start!, end_exclusive: p.end_exclusive! };
  }
  return { dataset_id: ds.id, measure, filters, group_by, period };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  let body: { question?: string; context?: unknown; today?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const question = String(body.question ?? '').trim().slice(0, 600);
  if (!question) return json({ error: 'empty' }, 400);
  const today = DAY.test(String(body.today)) ? String(body.today) : new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

  const { data: catData, error: catErr } = await supabase.rpc('ds_catalog');
  if (catErr) return json({ error: 'forbidden' }, 403);
  if (question === '__health') return json({ kind: 'health', ai_configured: !!Deno.env.get('GROQ_API_KEY'), model: MODEL });
  const catalog = catData as Catalog;
  if (!catalog.datasets.some((d) => d.row_count > 0)) return json({ kind: 'unsupported', reason: 'لا توجد بيانات معتمدة بعد. ارفعي ملفًا من صفحة البيانات واعتمديه.' });

  const key = await sha256(JSON.stringify([PROMPT_VERSION, MODEL, catalog.version, today.slice(0, 7), question.replace(/\s+/g, ' '), body.context ?? null]));
  let decision: { tool: string; args: Record<string, unknown> } | null = null;
  let cached = false;
  const { data: hit } = await supabase.from('ai_cache').select('request').eq('cache_key', key).maybeSingle();
  if (hit?.request) { decision = hit.request as typeof decision; cached = true; }

  if (!decision) {
    const apiKey = Deno.env.get('GROQ_API_KEY');
    if (!apiKey) return json({ kind: 'ai_unavailable', reason: 'missing_key' });
    const contextId = (body.context as { dataset_id?: string } | null)?.dataset_id ?? null;
    const messages: { role: string; content: string }[] = [{ role: 'system', content: systemPrompt(catalog, today, question, contextId) }];
    if (body.context) messages.push({ role: 'user', content: `الطلب السابق (JSON): ${JSON.stringify(body.context).slice(0, 1500)}` });
    messages.push({ role: 'user', content: question });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    let res: Response;
    try {
      res = await fetch(GROQ_URL, {
        method: 'POST', signal: ctrl.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, tools, tool_choice: 'required', temperature: 0, reasoning_effort: 'low', include_reasoning: false, max_completion_tokens: 900 }),
      });
    } catch { return json({ kind: 'ai_unavailable', reason: 'timeout' }); } finally { clearTimeout(timer); }
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after') ?? '0');
      return json({ kind: 'rate_limited', retry_after: Number.isFinite(ra) && ra > 0 ? Math.ceil(ra) : 30 });
    }
    if (!res.ok) return json({ kind: 'ai_unavailable', reason: `http_${res.status}` });
    const out = await res.json();
    const call = out?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) return json({ kind: 'ai_unavailable', reason: 'no_tool_call' });
    try { decision = { tool: call.function.name, args: JSON.parse(call.function.arguments || '{}') }; } catch { return json({ kind: 'ai_unavailable', reason: 'bad_args' }); }
  }

  if (decision.tool === 'clarify' || decision.tool === 'unsupported') {
    if (!cached) await supabase.from('ai_cache').upsert({ cache_key: key, request: decision });
    return decision.tool === 'clarify'
      ? json({ kind: 'clarify', question: decision.args.question, options: decision.args.options ?? [] })
      : json({ kind: 'unsupported', reason: decision.args.reason });
  }
  let requests: ReturnType<typeof sanitize>[];
  try {
    requests = ((decision.args.requests as Record<string, unknown>[]) ?? []).slice(0, 2).map((r) => sanitize(r, catalog));
    if (!requests.length) throw new Error('empty');
  } catch (e) {
    return json({ kind: 'ai_unavailable', reason: `invalid_request:${(e as Error).message}` });
  }
  if (!cached) await supabase.from('ai_cache').upsert({ cache_key: key, request: decision });
  const results = [];
  for (const r of requests) {
    const { data, error } = await supabase.rpc('dataset_query', { p_req: r });
    if (error) return json({ kind: 'error', message: error.message });
    results.push(data);
  }
  return json({ kind: 'answer', interpretation: decision.args.interpretation ?? '', assumptions: decision.args.assumptions ?? [], requests, results, cached, model: MODEL });
});
