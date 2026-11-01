// Edge Function: переклад текстів товару через DeepL. Ключ DEEPL_API_KEY — лише в секретах Supabase.
// Викликати може тільки команда магазину (перевіряємо public.is_staff() від імені користувача).
import { createClient } from 'npm:@supabase/supabase-js@2';

const LANGS = ['pl', 'en', 'uk', 'de', 'cs', 'lt', 'es', 'fr', 'ru'] as const;
type Lang = (typeof LANGS)[number];
// DeepL: мова призначення для англійської має варіант (EN-GB), для джерела — просто EN.
const TARGET: Record<Lang, string> = { pl: 'PL', en: 'EN-GB', uk: 'UK', de: 'DE', cs: 'CS', lt: 'LT', es: 'ES', fr: 'FR', ru: 'RU' };
const MAX_CHARS = 6000;

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

  // Хто кличе: клієнт Supabase з токеном користувача, тож RLS і is_staff() бачать саме його.
  const auth = req.headers.get('authorization') ?? '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { authorization: auth } },
  });
  const { data: isStaff, error: staffErr } = await sb.rpc('is_staff');
  if (staffErr || isStaff !== true) return reply({ error: 'forbidden' }, 403);

  let body: { source?: string; texts?: Record<string, string>; targets?: string[] };
  try { body = await req.json(); } catch { return reply({ error: 'bad json' }, 400); }
  const source = body.source as Lang;
  const fields = Object.entries(body.texts ?? {}).filter(([k, v]) => /^[a-z_]{1,30}$/.test(k) && typeof v === 'string' && v.trim());
  const targets = (body.targets ?? []).filter((t): t is Lang => (LANGS as readonly string[]).includes(t) && t !== source);
  if (!(LANGS as readonly string[]).includes(source) || !fields.length || !targets.length) return reply({ error: 'bad request' }, 400);
  if (fields.reduce((n, [, v]) => n + v.length, 0) > MAX_CHARS) return reply({ error: 'too long' }, 413);

  const key = Deno.env.get('DEEPL_API_KEY');
  if (!key) return reply({ error: 'not configured' }, 503);
  // Ключі безкоштовного тарифу DeepL закінчуються на ":fx" і мають окрему адресу.
  const api = key.endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';

  const translations: Record<string, Record<string, string>> = {};
  for (const target of targets) {
    const res = await fetch(api, {
      method: 'POST',
      headers: { authorization: `DeepL-Auth-Key ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        text: fields.map(([, v]) => v),
        source_lang: source.toUpperCase(),
        target_lang: TARGET[target],
        preserve_formatting: true,
      }),
    });
    if (!res.ok) return reply({ error: `deepl ${res.status}` }, res.status === 456 ? 429 : 502); // 456 — вичерпано місячний ліміт
    const out = await res.json() as { translations: { text: string }[] };
    translations[target] = Object.fromEntries(fields.map(([k], i) => [k, out.translations[i]?.text ?? '']));
  }
  return reply({ translations });
});
