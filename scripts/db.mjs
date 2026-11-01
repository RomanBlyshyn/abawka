// Робота з базою Supabase без `supabase login`: бере пароль із .env і нікуди його не виводить.
//   node scripts/db.mjs push            — застосувати нові міграції з supabase/migrations
//   node scripts/db.mjs push --dry-run  — показати, що буде застосовано
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import net from 'node:net';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const ref = new URL(env.PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const password = env.SUPABASE_DB_PASSWORD;
if (!password) throw new Error('SUPABASE_DB_PASSWORD порожній у .env');

// Безкоштовний Supabase дає пряму адресу бази лише по IPv6, тож ідемо через session pooler (IPv4).
const HOSTS = ['aws-0-eu-west-1', 'aws-1-eu-west-1', 'aws-1-eu-central-1', 'aws-0-eu-central-1', 'aws-1-eu-central-2'].map((r) => `${r}.pooler.supabase.com`);
const reachable = (host) => new Promise((ok) => {
  const s = net.connect(5432, host);
  s.setTimeout(4000);
  s.on('connect', () => { s.destroy(); ok(true); }).on('error', () => ok(false)).on('timeout', () => { s.destroy(); ok(false); });
});

const [cmd = 'push', ...rest] = process.argv.slice(2);
if (cmd !== 'push') throw new Error(`Невідома команда: ${cmd}`);

for (const host of HOSTS) {
  if (!(await reachable(host))) continue;
  // Пароль іде змінною середовища, а не в адресі: на Windows npx запускається через cmd.exe,
  // який спотворює % і & у аргументах.
  const url = `postgresql://postgres.${ref}@${host}:5432/postgres`;
  const r = spawnSync('npx', ['-y', 'supabase@2', 'db', 'push', '--db-url', url, '--include-all', ...rest], {
    encoding: 'utf8', shell: process.platform === 'win32', input: 'y\n',
    env: { ...process.env, SUPABASE_DB_PASSWORD: password, PGPASSWORD: password },
  });
  const out = `${r.stdout}\n${r.stderr}`.replaceAll(password, '***').replaceAll(encodeURIComponent(password), '***');
  // «tenant/user … not found» — проєкт живе в іншому регіоні пулера, пробуємо наступний.
  if (/tenant(\/| or )user .*not found/i.test(out)) { console.log(`${host}: не той регіон`); continue; }
  console.log(`pooler: ${host}\n${out.trim()}`);
  process.exit(r.status ?? 1);
}
console.error('Жоден регіон пулера не підійшов — перевір регіон проєкту в Supabase (Project Settings → General).');
process.exit(1);
