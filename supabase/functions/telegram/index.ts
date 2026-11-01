// Edge Function: Telegram-бот магазину. Ключ TELEGRAM_BOT_TOKEN — лише в секретах Supabase.
// Три види викликів:
//   1) база після нової заявки: {request: <номер>} — розсилає заявку всім підключеним з команди;
//   2) Telegram (webhook): /start <код> — прив'язує чат до людини з команди;
//   3) адмінка з токеном користувача: {action: 'link' | 'unlink' | 'test'}.
// Розгортається без перевірки JWT (бо кличуть база й Telegram) — права перевіряємо тут.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { requestMessage, type RequestRow } from './message.ts';

const TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const SITE = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const CODE_TTL_MS = 24 * 3600e3;

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

async function tg(method: string, params: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params),
  });
  return await res.json() as { ok: boolean; result?: Record<string, unknown>; description?: string };
}

/** Секрет webhook виводимо з токена бота (scripts/telegram.mjs рахує так само) — окремий ключ не потрібен. */
async function webhookSecret() {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`abawka-webhook:${TOKEN}`));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}

// ── 1) Нова заявка ────────────────────────────────────────────────────────────
async function notify(id: number) {
  const { data: r } = await db.from('requests')
    .select('id,locale,name,method,contact,country,delivery,comment,currency,total,items')
    .eq('id', id).is('notified_at', null).gte('created_at', new Date(Date.now() - 3600e3).toISOString())
    .maybeSingle();
  if (!r) return reply({ sent: 0 }); // уже надіслано, стара або не існує
  const { data: staff } = await db.from('staff').select('telegram_chat_id').not('telegram_chat_id', 'is', null);
  const text = requestMessage(r as RequestRow);
  const keyboard = SITE ? { inline_keyboard: [[{ text: 'Відкрити в адмінці', url: `${SITE}/admin/requests/` }]] } : undefined;
  let sent = 0;
  for (const s of staff ?? []) {
    const res = await tg('sendMessage', { chat_id: s.telegram_chat_id, text, parse_mode: 'HTML', reply_markup: keyboard, link_preview_options: { is_disabled: true } });
    if (res.ok) sent++;
  }
  if (sent) await db.from('requests').update({ notified_at: new Date().toISOString() }).eq('id', id);
  return reply({ sent });
}

// ── 2) Повідомлення від Telegram ─────────────────────────────────────────────
async function onUpdate(update: { message?: { text?: string; chat?: { id: number; type: string } } }) {
  const chat = update.message?.chat;
  const text = update.message?.text ?? '';
  if (!chat || chat.type !== 'private') return;
  // Код приходить з посилання (/start <код>) або вставлений вручну — деякі клієнти Telegram
  // не передають код, якщо чат з ботом уже відкритий.
  const code = /^(?:\/start(?:@\w+)?\s+)?([a-f0-9]{32})$/i.exec(text.trim())?.[1]?.toLowerCase();
  console.log(`update: ${code ? 'code' : text.startsWith('/start') ? 'start without code' : 'other'}`);
  if (code) {
    const { data: who } = await db.from('staff').select('user_id,telegram_code_at').eq('telegram_code', code).maybeSingle();
    if (who && Date.now() - Date.parse(who.telegram_code_at) < CODE_TTL_MS) {
      await db.from('staff').update({ telegram_chat_id: chat.id, telegram_code: null, telegram_code_at: null }).eq('user_id', who.user_id);
      await tg('sendMessage', { chat_id: chat.id, text: '✅ Готово! Нові заявки з сайту ABAWKA приходитимуть сюди.' });
      return;
    }
    await tg('sendMessage', { chat_id: chat.id, text: 'Посилання застаріло. Відкрийте адмінку й натисніть «Підключити Telegram» ще раз.' });
    return;
  }
  await tg('sendMessage', {
    chat_id: chat.id,
    text: 'Привіт! Це службовий бот магазину ABAWKA: він надсилає команді нові заявки. Щоб отримувати їх, відкрийте адмінку, натисніть «Підключити Telegram» і надішліть сюди код, який там з’явиться.',
  });
}

// ── 3) Дії з адмінки ─────────────────────────────────────────────────────────
async function staffAction(req: Request, action: string) {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: { user } } = await db.auth.getUser(jwt);
  if (!user) return reply({ error: 'forbidden' }, 403);
  const { data: me } = await db.from('staff').select('user_id,telegram_chat_id').eq('user_id', user.id).maybeSingle();
  if (!me) return reply({ error: 'forbidden' }, 403);

  if (action === 'link') {
    const code = crypto.randomUUID().replaceAll('-', '');
    const { error } = await db.from('staff').update({ telegram_code: code, telegram_code_at: new Date().toISOString() }).eq('user_id', me.user_id);
    const bot = await tg('getMe', {});
    if (error || !bot.ok) return reply({ error: 'telegram' }, 502);
    return reply({ url: `https://t.me/${bot.result!.username}?start=${code}` });
  }
  if (action === 'unlink') {
    await db.from('staff').update({ telegram_chat_id: null }).eq('user_id', me.user_id);
    return reply({ ok: true });
  }
  if (action === 'test') {
    if (!me.telegram_chat_id) return reply({ error: 'not linked' }, 409);
    const res = await tg('sendMessage', { chat_id: me.telegram_chat_id, text: '🔔 Перевірка: сповіщення про заявки працюють.' });
    return res.ok ? reply({ ok: true }) : reply({ error: 'telegram' }, 502);
  }
  return reply({ error: 'bad request' }, 400);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'method' }, 405);
  if (!TOKEN) return reply({ error: 'not configured' }, 503);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: 'bad json' }, 400); }

  const secret = req.headers.get('x-telegram-bot-api-secret-token');
  if (secret !== null) {
    if (secret !== await webhookSecret()) return reply({ error: 'forbidden' }, 403);
    await onUpdate(body);
    return reply({ ok: true }); // Telegram чекає 200, інакше повторюватиме
  }
  if (typeof body.request === 'number') return notify(body.request);
  if (typeof body.action === 'string') return staffAction(req, body.action);
  return reply({ error: 'bad request' }, 400);
});
