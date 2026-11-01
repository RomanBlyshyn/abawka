// Викласти Edge Functions і їхні секрети в Supabase. Нічого секретного не виводить.
//   node scripts/functions.mjs deploy translate   — викласти функцію (без Docker, збірка на боці Supabase)
//   node scripts/functions.mjs secrets            — передати функціям потрібні ключі з .env
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const ref = new URL(env.PUBLIC_SUPABASE_URL).hostname.split('.')[0];
if (!env.SUPABASE_ACCESS_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN порожній у .env');

// Ключі, які отримують функції (лише потрібні їм, а не весь .env).
const FUNCTION_SECRETS = ['DEEPL_API_KEY', 'TELEGRAM_BOT_TOKEN', 'SITE_URL', 'NETLIFY_BUILD_HOOK_URL'];
// Функції, які кличуть не з браузера (база, Telegram): без перевірки JWT на шлюзі, права перевіряють самі.
const PUBLIC_FUNCTIONS = ['telegram', 'rates'];
const secretValues = Object.values(env).filter((v) => v.length >= 8);

function supabase(args) {
  const r = spawnSync('npx', ['-y', 'supabase@2', ...args, '--project-ref', ref], {
    encoding: 'utf8', shell: process.platform === 'win32',
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: env.SUPABASE_ACCESS_TOKEN },
  });
  let out = `${r.stdout}\n${r.stderr}`;
  for (const v of secretValues) out = out.replaceAll(v, '***');
  console.log(out.split('\n').filter((l) => l.trim() && !/npm warn|DEP0190|trace-deprecation/.test(l)).join('\n'));
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const [cmd, name] = process.argv.slice(2);
if (cmd === 'deploy') {
  if (!/^[a-z0-9-]+$/.test(name ?? '')) throw new Error('Вкажи назву функції: node scripts/functions.mjs deploy translate');
  supabase(['functions', 'deploy', name, '--use-api', ...(PUBLIC_FUNCTIONS.includes(name) ? ['--no-verify-jwt'] : [])]);
} else if (cmd === 'secrets') {
  const dir = mkdtempSync(join(tmpdir(), 'abawka-'));
  const file = join(dir, 'secrets.env');
  const lines = FUNCTION_SECRETS.filter((k) => env[k]).map((k) => `${k}=${env[k]}`);
  if (!lines.length) throw new Error('У .env немає жодного з ключів для функцій');
  try {
    writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
    supabase(['secrets', 'set', '--env-file', file]);
    console.log(`передано: ${FUNCTION_SECRETS.filter((k) => env[k]).join(', ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  throw new Error('Команди: deploy <name> | secrets');
}
