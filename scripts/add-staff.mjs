// Додати людину в команду магазину без адмінки (перший власник, передача замовнику).
//   node scripts/add-staff.mjs owner@example.com owner
//   node scripts/add-staff.mjs manager@example.com manager
// Листів не надсилає: пароль людина задає сама через «Забули пароль?» на сторінці входу адмінки.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const [email, role = 'manager'] = process.argv.slice(2);
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? '')) throw new Error('Вкажи email: node scripts/add-staff.mjs name@example.com owner|manager');
if (!['owner', 'manager'].includes(role)) throw new Error('Роль: owner або manager');

const base = env.PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
const call = async (path, init = {}) => {
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const body = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${body}`);
  return body ? JSON.parse(body) : null;
};

// Користувач: знайти або створити (email одразу підтверджений, пароля поки немає).
let user = (await call(`/auth/v1/admin/users?per_page=1000`)).users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!user) user = await call('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, email_confirm: true }) });

await call('/rest/v1/staff?on_conflict=user_id', {
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify({ user_id: user.id, email: user.email, role }),
});
console.log(`✓ ${user.email} — ${role}`);
