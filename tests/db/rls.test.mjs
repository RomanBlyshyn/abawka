// Тести схеми й прав доступу на справжньому Postgres (PGlite, без Docker).
// Запуск: npm run test:db
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const OWNER = '11111111-1111-1111-1111-111111111111';
const MANAGER = '22222222-2222-2222-2222-222222222222';
const STRANGER = '33333333-3333-3333-3333-333333333333';

let db;

/** Виконати SQL від імені ролі: anon (покупець) або authenticated з конкретним користувачем. */
async function as(who, sql, params = []) {
  await db.exec('reset role');
  if (who === 'anon') await db.exec(`set role anon; set request.jwt.claim.sub = ''`);
  else await db.exec(`set role authenticated; set request.jwt.claim.sub = '${who}'`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role');
  }
}
const admin = (sql, params = []) => db.query(sql, params);
const rejects = (p, re) => assert.rejects(p, re);

before(async () => {
  db = new PGlite();
  await db.exec(read('tests/db/supabase-stubs.sql'));
  const dir = new URL('supabase/migrations/', root);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  await db.exec(`
    insert into auth.users (id, email) values ('${OWNER}', 'owner@x.test'), ('${MANAGER}', 'manager@x.test'), ('${STRANGER}', 'stranger@x.test');
    insert into public.staff (user_id, email, role) values ('${OWNER}', 'owner@x.test', 'owner'), ('${MANAGER}', 'manager@x.test', 'manager');
  `);
});

test('seed: categories, products, banner and initial price history', async () => {
  const count = async (t) => (await admin(`select count(*)::int n from ${t}`)).rows[0].n;
  assert.equal(await count('public.categories'), 5);
  assert.equal(await count('public.products'), 7);
  assert.equal(await count('public.banners'), 1);
  assert.equal(await count('public.price_history'), 7);
});

test('buyer (anon) sees the catalog but cannot change anything', async () => {
  assert.equal((await as('anon', 'select count(*)::int n from public.products')).rows[0].n, 7);
  await rejects(as('anon', `update public.products set price = 1 where slug = 'chess' returning id`).then((r) => { if (!r.rows.length) throw new Error('blocked'); }), /blocked/);
  await rejects(as('anon', `insert into public.categories (slug, name) values ('x', '{"en":"X"}')`), /row-level security/);
  assert.equal((await as('anon', 'select count(*)::int n from public.staff')).rows[0].n, 0);
});

test('unpublished products are hidden from buyers, visible to staff', async () => {
  await admin(`update public.products set published = false where slug = 'chess'`);
  assert.equal((await as('anon', `select count(*)::int n from public.products where slug = 'chess'`)).rows[0].n, 0);
  assert.equal((await as(MANAGER, `select count(*)::int n from public.products where slug = 'chess'`)).rows[0].n, 1);
  await admin(`update public.products set published = true where slug = 'chess'`);
});

test('a logged-in stranger (not staff) is treated like a buyer', async () => {
  const r = await as(STRANGER, `update public.products set price = 1 where slug = 'chess' returning id`);
  assert.equal(r.rows.length, 0);
});

test('manager edits the catalog but not settings or the team', async () => {
  const r = await as(MANAGER, `update public.products set price = 2599, stock = 3 where slug = 'chess' returning price`);
  assert.equal(r.rows[0].price, 2599);
  assert.equal((await as(MANAGER, `update public.settings set reply_hours = 2 returning id`)).rows.length, 0);
  await rejects(as(MANAGER, `insert into public.staff (user_id, email, role) values ('${STRANGER}', 's', 'manager')`), /row-level security/);
});

test('owner changes settings and manages the team, but cannot remove the last owner', async () => {
  assert.equal((await as(OWNER, `update public.settings set reply_hours = 4 returning reply_hours`)).rows[0].reply_hours, 4);
  await as(OWNER, `insert into public.staff (user_id, email, role) values ('${STRANGER}', 'stranger@x.test', 'manager')`);
  await as(OWNER, `delete from public.staff where user_id = '${STRANGER}'`);
  await rejects(as(OWNER, `delete from public.staff where user_id = '${OWNER}'`), /без власника/);
  await rejects(as(OWNER, `update public.staff set role = 'manager' where user_id = '${OWNER}'`), /без власника/);
});

test('price changes are recorded for the 30-day lowest price (Omnibus)', async () => {
  const hist = async () => (await admin(`select count(*)::int n from public.price_history h join public.products p on p.id = h.product_id where p.slug = 'toy-sword'`)).rows[0].n;
  const before = await hist();
  await as(MANAGER, `update public.products set stock = 5 where slug = 'toy-sword'`); // ціна та сама — історія не росте
  assert.equal(await hist(), before);
  await as(MANAGER, `update public.products set price = 1799 where slug = 'toy-sword'`);
  assert.equal(await hist(), before + 1);
  await rejects(as(MANAGER, `insert into public.price_history (product_id, price) select id, 1 from public.products limit 1`), /row-level security/);
});

test('database rejects bad data even if the admin UI is bypassed', async () => {
  const bad = [
    [`update public.products set old_price = price where slug = 'chess'`, /check/],
    [`update public.products set stock = -1 where slug = 'chess'`, /check/],
    [`update public.products set price = 0 where slug = 'chess'`, /check/],
    [`update public.products set name = '{"xx":"Bad"}' where slug = 'chess'`, /check/],
    [`update public.products set name = '{"en":"   "}' where slug = 'chess'`, /check/],
    [`update public.products set slug = 'Bad Slug!' where slug = 'chess'`, /check/],
    [`update public.products set age_min = 40 where slug = 'chess'`, /check/],
    [`update public.banners set href = 'javascript:alert(1)'`, /check/],
    [`insert into public.product_images (product_id, path) select id, '../../etc/passwd' from public.products limit 1`, /check/],
  ];
  for (const [sql, re] of bad) await rejects(as(OWNER, sql), re, sql);
});

test('reviews: buyers see only approved ones', async () => {
  await as(MANAGER, `insert into public.reviews (product_id, author, rating, body) select id, 'Anna', 5, '{"en":"Great"}' from public.products where slug = 'chess'`);
  assert.equal((await as('anon', 'select count(*)::int n from public.reviews')).rows[0].n, 0);
  await as(MANAGER, `update public.reviews set approved = true`);
  assert.equal((await as('anon', 'select count(*)::int n from public.reviews')).rows[0].n, 1);
});

test('photo storage: only staff can upload or delete', async () => {
  await rejects(as('anon', `insert into storage.objects (bucket_id, name) values ('catalog', 'x.webp')`), /row-level security|permission denied/);
  await rejects(as(STRANGER, `insert into storage.objects (bucket_id, name) values ('catalog', 'x.webp')`), /row-level security/);
  await as(MANAGER, `insert into storage.objects (bucket_id, name) values ('catalog', 'products/a.webp')`);
  assert.equal((await as(STRANGER, `delete from storage.objects returning id`)).rows.length, 0);
});

test('photo storage: staff can list objects (needed to delete), strangers cannot', async () => {
  assert.ok((await as(MANAGER, `select count(*)::int n from storage.objects where bucket_id = 'catalog'`)).rows[0].n >= 1);
  assert.equal((await as(STRANGER, `select count(*)::int n from storage.objects`)).rows[0].n, 0);
});
