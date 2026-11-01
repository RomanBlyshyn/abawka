// Edge Function: «Оновити сайт» — запустити перезбірку на Netlify, щоб зміни з адмінки з'явились на сайті.
// Адреса build hook — лише в секретах Supabase (NETLIFY_BUILD_HOOK_URL). Кличе тільки команда магазину.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'method' }, 405);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { authorization: req.headers.get('authorization') ?? '' } },
  });
  const { data: isStaff } = await sb.rpc('is_staff');
  if (isStaff !== true) return reply({ error: 'forbidden' }, 403);

  const hook = Deno.env.get('NETLIFY_BUILD_HOOK_URL');
  if (!hook) return reply({ error: 'not configured' }, 503);

  // Не частіше ніж раз на хвилину: кілька натискань поспіль не ставлять у чергу кілька збірок.
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: s } = await admin.from('settings').select('published_at').maybeSingle();
  if (s?.published_at && Date.now() - Date.parse(s.published_at) < 60e3) return reply({ ok: true, published_at: s.published_at, throttled: true });

  const res = await fetch(hook, { method: 'POST', body: '{}' });
  if (!res.ok) return reply({ error: `netlify ${res.status}` }, 502);
  const now = new Date().toISOString();
  await admin.from('settings').update({ published_at: now }).eq('id', true);
  return reply({ ok: true, published_at: now });
});
