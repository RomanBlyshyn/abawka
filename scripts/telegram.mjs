// Під'єднати бота до функції telegram у Supabase (webhook). Токен бота читає з .env і не виводить.
//   node scripts/telegram.mjs setup   — один раз після деплою функції (і після зміни токена)
//   node scripts/telegram.mjs status  — що зараз бачить Telegram
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const token = env.TELEGRAM_BOT_TOKEN;
if (!/^\d+:[\w-]{30,}$/.test(token ?? '')) throw new Error('TELEGRAM_BOT_TOKEN у .env порожній або не схожий на токен від @BotFather');

// Той самий секрет, що рахує supabase/functions/telegram/index.ts.
const secret = createHash('sha256').update(`abawka-webhook:${token}`).digest('hex').slice(0, 48);
const url = `${env.PUBLIC_SUPABASE_URL.replace(/\/$/, '')}/functions/v1/telegram`;

async function tg(method, params = {}) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params),
  });
  const out = await res.json();
  if (!out.ok) throw new Error(`Telegram ${method}: ${out.description}`);
  return out.result;
}

const cmd = process.argv[2];
const me = await tg('getMe');
if (cmd === 'setup') {
  await tg('setWebhook', { url, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: true });
  await tg('setMyDescription', { description: 'Службовий бот магазину ABAWKA: надсилає команді нові заявки з сайту.' });
  console.log(`Бот @${me.username} під'єднано до ${url}`);
} else if (cmd === 'status') {
  const info = await tg('getWebhookInfo');
  console.log(`Бот @${me.username}`);
  console.log(`webhook: ${info.url || '(не задано)'}`);
  if (info.last_error_message) console.log(`остання помилка: ${info.last_error_message}`);
  console.log(`у черзі: ${info.pending_update_count}`);
} else {
  throw new Error('Команди: setup | status');
}
