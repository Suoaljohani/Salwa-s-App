// Bulk import used by the operator script (scripts/bulk-import). Not called by the app.
// Access: header x-import-token whose SHA-256 is stored, unexpired, in public.admin_import_tokens.
// Runs with the service role (available only inside Supabase) and the same RPCs as the app's import.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

async function sha256(t: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const token = req.headers.get('x-import-token') ?? '';
  if (token.length < 32) return json({ error: 'unauthorized' }, 401);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: tok } = await sb.from('admin_import_tokens').select('expires_at').eq('token_sha256', await sha256(token)).maybeSingle();
  if (!tok || new Date(tok.expires_at).getTime() < Date.now()) return json({ error: 'unauthorized' }, 401);

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  try {
    switch (body.action) {
      case 'upsert_dataset': {
        const d = body.dataset;
        const row = { name: d.name, unit_label: d.unit_label, description: d.description ?? null, mode: d.mode, period_column: d.period_column ?? null,
          key_column: d.key_column ?? null, header_signature: d.header_signature ?? null, columns: d.columns, updated_at: new Date().toISOString() };
        const { data: existing } = await sb.from('datasets').select('id').eq('name', d.name).maybeSingle();
        if (existing) {
          const { error } = await sb.from('datasets').update(row).eq('id', existing.id);
          if (error) throw error;
          return json({ id: existing.id, created: false });
        }
        const { data, error } = await sb.from('datasets').insert(row).select('id').single();
        if (error) throw error;
        return json({ id: data.id, created: true });
      }
      case 'upload_original': {
        const bytes = Uint8Array.from(atob(body.base64), (c) => c.charCodeAt(0));
        const { error } = await sb.storage.from('private-files').upload(body.path, bytes, { upsert: true, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        if (error) throw error;
        return json({ ok: true });
      }
      case 'create_batch': {
        const b = body.batch;
        const { data: live } = await sb.from('dataset_batches').select('id,status').eq('dataset_id', b.dataset_id).eq('file_sha256', b.file_sha256).in('status', ['staged', 'approved']).maybeSingle();
        if (live) return json({ id: live.id, status: live.status, existing: true });
        const { data, error } = await sb.from('dataset_batches').insert(b).select('id').single();
        if (error) throw error;
        return json({ id: data.id, status: 'staged', existing: false });
      }
      case 'stage_rows': {
        const { data, error } = await sb.rpc('ds_stage_rows', { p_batch: body.batch_id, p_rows: body.rows });
        if (error) throw error;
        return json(data);
      }
      case 'approve': {
        const { data, error } = await sb.rpc('ds_approve', { p_batch: body.batch_id });
        if (error) throw error;
        return json({ version: data });
      }
      case 'query': {
        const { data, error } = await sb.rpc('dataset_query', { p_req: body.request });
        if (error) throw error;
        return json(data);
      }
      case 'catalog': {
        const { data, error } = await sb.rpc('ds_catalog');
        if (error) throw error;
        return json(data);
      }
      default:
        return json({ error: 'unknown_action' }, 400);
    }
  } catch (e) {
    return json({ error: (e as { message?: string }).message ?? String(e) }, 500);
  }
});
