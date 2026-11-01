// Запобіжник для публічного репозиторію: не пускає в коміт значення з .env і схоже на ключі.
// Працює як git pre-commit hook (npm run hooks:install) і вручну: npm run check:secrets.
// Нічого секретного не виводить — лише назву файлу й що саме знайдено.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

if (process.argv.includes('--install')) {
  writeFileSync('.git/hooks/pre-commit', '#!/bin/sh\nnode scripts/check-secrets.mjs --staged\n', { mode: 0o755 });
  console.log('pre-commit hook встановлено: коміт із секретами буде зупинено');
  process.exit(0);
}

const staged = process.argv.includes('--staged');
const files = execSync(staged ? 'git diff --cached --name-only --diff-filter=ACM -z' : 'git ls-files -z', { encoding: 'utf8' })
  .split('\0').filter(Boolean);

const env = existsSync('.env')
  ? Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
  : {};
// Публічні значення (адреса й anon-ключ Supabase) можна — вони і так на сайті.
const secrets = Object.entries(env).filter(([k, v]) => !k.startsWith('PUBLIC_') && v.length >= 8);
const PATTERNS = {
  'ключ Supabase service_role': /sb_secret_[A-Za-z0-9_-]{10,}/,
  'токен Supabase': /sbp_[a-f0-9]{20,}/,
  'ключ DeepL': /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:fx\b/,
  'токен Telegram-бота': /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/,
  'build hook Netlify': /api\.netlify\.com\/build_hooks\/[a-f0-9]{20,}/,
  'приватний ключ': /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
};

const problems = [];
for (const f of files) {
  if (f === '.env' || /(^|\/)\.env\.(?!example$)/.test(f)) { problems.push(`${f}: файл з секретами не можна комітити`); continue; }
  let text;
  try { text = staged ? execSync(`git show :"${f}"`, { encoding: 'utf8', maxBuffer: 1 << 28 }) : readFileSync(f, 'utf8'); } catch { continue; }
  if (text.includes('\0')) continue; // картинки й інші бінарні файли
  for (const [k, v] of secrets) if (text.includes(v)) problems.push(`${f}: значення ${k} з .env`);
  for (const [name, re] of Object.entries(PATTERNS)) if (re.test(text)) problems.push(`${f}: схоже на ${name}`);
}

if (problems.length) {
  console.error(`Зупинено: у ${staged ? 'коміті' : 'репозиторії'} схоже на секрети:\n  ${problems.join('\n  ')}\nПриберіть їх (секрети — лише в .env).`);
  process.exit(1);
}
console.log(`secrets OK: ${files.length} файлів перевірено`);
