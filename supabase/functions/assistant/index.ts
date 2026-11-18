// Assistant: turns an Arabic question into a validated metric request (Groq tool call),
// then computes it with public.metric_query under the caller's own session.
// The model never produces numbers that are shown; it only proposes the structured request.
// No patient rows are sent to the model: only the question, the field catalog and category names.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = Deno.env.get('GROQ_MODEL') ?? 'openai/gpt-oss-120b';
const PROMPT_VERSION = 3;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const DIMS = ['month', 'day', 'encounter_type', 'department', 'payor', 'discharge_type', 'gender', 'nationality_group', 'age_band'];

const requestSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    metric: { type: 'string', enum: ['visits', 'distinct_patients'], description: 'visits = عدد الزيارات. distinct_patients = عدد المرضى المختلفين (كل مريض مرة واحدة).' },
    start: { type: 'string', description: 'YYYY-MM-DD first local day, inclusive' },
    end_exclusive: { type: 'string', description: 'YYYY-MM-DD day after the last day (exclusive). July 2026 → 2026-07-01 .. 2026-08-01' },
    filters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        encounter_type: { type: 'array', items: { type: 'string' } },
        department: { type: 'array', items: { type: 'string' } },
        payor: { type: 'array', items: { type: 'string' } },
        discharge_type: { type: 'array', items: { type: 'string' } },
        gender: { type: 'string', enum: ['M', 'F'] },
        is_saudi: { type: 'boolean' },
        age_min: { type: 'integer', description: 'inclusive. "18 فأكثر" → 18' },
        age_max_exclusive: { type: 'integer', description: 'exclusive. "أقل من 14" → 14' },
      },
    },
    group_by: { type: 'array', items: { type: 'string', enum: DIMS }, maxItems: 2 },
  },
  required: ['metric', 'start', 'end_exclusive', 'filters', 'group_by'],
};

const tools = [
  {
    type: 'function',
    function: {
      name: 'statistics',
      description: 'Compute one statistic, or two for a comparison (e.g. two months). Use exactly the catalog values for categorical filters.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          requests: { type: 'array', items: requestSchema, minItems: 1, maxItems: 2 },
          interpretation: { type: 'string', description: 'One short Arabic sentence describing exactly what will be counted.' },
          assumptions: { type: 'array', items: { type: 'string' }, description: 'Short Arabic notes for any default applied (e.g. year assumed).' },
        },
        required: ['requests', 'interpretation'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clarify',
      description: 'Ask one short Arabic question when the answer would change materially (unknown year, unclear whether visits or patients).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' }, maxItems: 4 } },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'unsupported',
      description: 'The data source cannot answer (e.g. CTAS, diagnoses, beds, or a non-statistical request).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { reason: { type: 'string', description: 'Short Arabic reason' } },
        required: ['reason'],
      },
    },
  },
];

interface Catalog {
  dataset_version: number;
  definition_version: number;
  first_visit: string | null;
  last_visit: string | null;
  coverage: { start: string; end_exclusive: string }[];
  values: Record<string, { value: string; n: number }[]>;
}

function systemPrompt(cat: Catalog, today: string): string {
  const vals = (k: string) => (cat.values[k] ?? []).slice(0, 30).map((v) => v.value).join(' | ') || '—';
  const cov = cat.coverage.map((c) => `${c.start}..${c.end_exclusive}`).join(', ') || 'لا توجد بيانات معتمدة';
  return [
    'أنت محلل يحوّل أسئلة رئيسة قسم الإحصاء الطبي إلى طلب إحصائي منظم عبر الأدوات فقط. لا تكتب أرقامًا.',
    `اليوم (توقيت الرياض): ${today}. الفترات المغطاة بالبيانات المعتمدة: ${cov}.`,
    'قواعد:',
    '- "زيارات/مراجعات" = visits. "مرضى/مراجعين مختلفين/أشخاص" = distinct_patients. إن كان الغموض يغير العدد اسأل بـ clarify.',
    '- الشهر بلا سنة: استخدم آخر سنة يقع فيها ذلك الشهر ضمن البيانات أو قبل اليوم، واذكر ذلك في assumptions.',
    '- "الشهر الماضي" = الشهر التقويمي السابق لليوم. "الربع الأول" = يناير–مارس. end_exclusive هو اليوم التالي لآخر يوم.',
    '- "18 فأكثر" → age_min 18. "أكبر من 18" → age_min 19. "أقل من 18" → age_max_exclusive 18. الأطفال دون تحديد → اسأل.',
    '- "سعوديين" → is_saudi true. "ذكور" → gender M. "إناث/نساء" → gender F.',
    '- "حسب/توزيع/موزعة" → group_by. "شهريًا" → month. المقارنة بين فترتين → requests بعنصرين بالمرشحات نفسها.',
    '- للمتابعات مثل "والنساء فقط؟" عدّل الطلب السابق المرفق وأبقِ بقية المرشحات.',
    '- CTAS والتشخيص والأسرّة غير متاحة في المصدر → unsupported.',
    '- لا ترفض ولا تسأل لأن الفترة خارج التغطية؛ أرسل الطلب كما هو وسيظهر النظام أن البيانات غير متاحة.',
    '- خاطب المستخدمة بصيغة المؤنث وبعبارات قصيرة.',
    `قيم encounter_type المتاحة: ${vals('encounter_type')}`,
    `قيم department المتاحة: ${vals('department')}`,
    `قيم payor: ${vals('payor')}. قيم discharge_type: ${vals('discharge_type')}`,
    'الطوارئ = encounter_type "Emergency". العيادات = "Outpatient". استخدم department فقط عند ذكر قسم بعينه.',
  ].join('\n');
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function sanitize(req: Record<string, unknown>, cat: Catalog) {
  const f = (req.filters ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ['encounter_type', 'department', 'payor', 'discharge_type']) {
    const arr = f[k];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const allowed = new Set((cat.values[k] ?? []).map((v) => v.value));
    const kept = arr.filter((x) => typeof x === 'string' && (allowed.size === 0 || allowed.has(x)));
    if (kept.length !== arr.length) throw new Error(`unknown_value:${k}`);
    out[k] = kept;
  }
  if (f.gender === 'M' || f.gender === 'F') out.gender = f.gender;
  if (typeof f.is_saudi === 'boolean') out.is_saudi = f.is_saudi;
  for (const k of ['age_min', 'age_max_exclusive']) if (Number.isInteger(f[k])) out[k] = f[k];
  const g = Array.isArray(req.group_by) ? req.group_by.filter((d) => DIMS.includes(d as string)).slice(0, 2) : [];
  if (!DAY.test(String(req.start)) || !DAY.test(String(req.end_exclusive))) throw new Error('bad_dates');
  return { metric: req.metric === 'distinct_patients' ? 'distinct_patients' : 'visits', start: req.start, end_exclusive: req.end_exclusive, filters: out, group_by: g };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const auth = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });

  let body: { question?: string; context?: unknown; today?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const question = String(body.question ?? '').trim().slice(0, 600);
  if (!question) return json({ error: 'empty' }, 400);
  const today = DAY.test(String(body.today)) ? String(body.today) : new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

  const { data: cat, error: catErr } = await supabase.rpc('data_catalog');
  if (catErr) return json({ error: 'forbidden' }, 403);
  // Health check from Settings: no model call, no quota used.
  if (question === '__health') return json({ kind: 'health', ai_configured: !!Deno.env.get('GROQ_API_KEY'), model: MODEL });
  const catalog = cat as Catalog;

  const key = await sha256(JSON.stringify([PROMPT_VERSION, MODEL, catalog.dataset_version, catalog.definition_version, today.slice(0, 7), question.replace(/\s+/g, ' '), body.context ?? null]));
  let decision: { tool: string; args: Record<string, unknown> } | null = null;
  let cached = false;
  const { data: hit } = await supabase.from('ai_cache').select('request').eq('cache_key', key).maybeSingle();
  if (hit?.request) { decision = hit.request as typeof decision; cached = true; }

  if (!decision) {
    const apiKey = Deno.env.get('GROQ_API_KEY');
    if (!apiKey) return json({ kind: 'ai_unavailable', reason: 'missing_key' });
    const messages: { role: string; content: string }[] = [{ role: 'system', content: systemPrompt(catalog, today) }];
    if (body.context) messages.push({ role: 'user', content: `الطلب السابق (JSON): ${JSON.stringify(body.context).slice(0, 1200)}` });
    messages.push({ role: 'user', content: question });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    let res: Response;
    try {
      res = await fetch(GROQ_URL, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, tools, tool_choice: 'required', temperature: 0, reasoning_effort: 'low', include_reasoning: false, max_completion_tokens: 700 }),
      });
    } catch {
      return json({ kind: 'ai_unavailable', reason: 'timeout' });
    } finally { clearTimeout(timer); }
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after') ?? '0');
      return json({ kind: 'rate_limited', retry_after: Number.isFinite(ra) && ra > 0 ? Math.ceil(ra) : 30 });
    }
    if (!res.ok) return json({ kind: 'ai_unavailable', reason: `http_${res.status}` });
    const out = await res.json();
    const call = out?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) return json({ kind: 'ai_unavailable', reason: 'no_tool_call' });
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(call.function.arguments || '{}'); } catch { return json({ kind: 'ai_unavailable', reason: 'bad_args' }); }
    decision = { tool: call.function.name, args };
  }

  if (decision.tool === 'clarify') {
    if (!cached) await supabase.from('ai_cache').upsert({ cache_key: key, request: decision });
    return json({ kind: 'clarify', question: decision.args.question, options: decision.args.options ?? [] });
  }
  if (decision.tool === 'unsupported') {
    if (!cached) await supabase.from('ai_cache').upsert({ cache_key: key, request: decision });
    return json({ kind: 'unsupported', reason: decision.args.reason });
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
    const { data, error } = await supabase.rpc('metric_query', { p_req: r });
    if (error) return json({ kind: 'error', message: error.message });
    results.push(data);
  }
  return json({
    kind: 'answer',
    interpretation: decision.args.interpretation ?? '',
    assumptions: decision.args.assumptions ?? [],
    requests,
    results,
    cached,
    model: MODEL,
  });
});
