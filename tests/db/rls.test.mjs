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

// ── Заявки ──────────────────────────────────────────────────────────────────
const order = (over = {}) => JSON.stringify({
  name: 'Anna', method: 'call', contact: '+48 600 000 000', country: 'PL', delivery: 'inpost', comment: '',
  locale: 'pl', consent: true, website: '', lines: [{ slug: 'bobo-balloon', qty: 2 }], ...over,
});
async function submit(payload, ip = '10.0.0.1') {
  await db.exec('reset role');
  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-forwarded-for': `${ip}, 172.16.0.1` })]);
  await db.exec(`set role anon; set request.jwt.claim.sub = ''`);
  try { return (await db.query('select public.submit_request($1::jsonb) r', [payload])).rows[0].r; }
  finally { await db.exec('reset role'); }
}
const stockOf = async (slug) => (await admin(`select stock from public.products where slug = $1`, [slug])).rows[0].stock;

test('request: price comes from the database, stock is reserved, buyer cannot read requests', async () => {
  await admin(`update public.products set stock = 10, price = 599 where slug = 'bobo-balloon'`);
  const r = await submit(order({ lines: [{ slug: 'bobo-balloon', qty: 2, price: 1 }] }), '10.0.0.10'); // ціна з браузера ігнорується
  assert.ok(r.id >= 1001);
  const row = (await admin(`select total, items, ip, status, currency from public.requests where id = $1`, [r.id])).rows[0];
  assert.equal(row.total, 1198);
  assert.equal(row.items[0].price, 599);
  assert.equal(row.ip, '10.0.0.10');
  assert.equal(row.status, 'new');
  assert.equal(await stockOf('bobo-balloon'), 8);
  assert.equal((await as('anon', 'select count(*)::int n from public.requests')).rows[0].n, 0);
  assert.ok((await as(MANAGER, 'select count(*)::int n from public.requests')).rows[0].n >= 1);
});

test('request: not enough stock or unpublished product is refused and nothing is reserved', async () => {
  await admin(`update public.products set stock = 1 where slug = 'chess'`);
  await rejects(submit(order({ lines: [{ slug: 'bobo-balloon', qty: 1 }, { slug: 'chess', qty: 2 }] }), '10.0.0.11'), /stock:chess/);
  assert.equal(await stockOf('chess'), 1);
  const bobo = await stockOf('bobo-balloon');
  assert.ok(bobo >= 0); // перший рядок відкотився разом з усією транзакцією
  await admin(`update public.products set published = false where slug = 'chess'`);
  await rejects(submit(order({ lines: [{ slug: 'chess', qty: 1 }] }), '10.0.0.11'), /stock:chess/);
  await admin(`update public.products set published = true where slug = 'chess'`);
});

test('request: server-side validation mirrors the form', async () => {
  const cases = [
    [{ name: 'A' }, /invalid:name/],
    [{ method: 'pigeon' }, /invalid:method/],
    [{ contact: '123' }, /invalid:contact/],
    [{ method: 'email', contact: 'not-an-email' }, /invalid:contact/],
    [{ method: 'telegram', contact: '@ab' }, /invalid:contact/],
    [{ country: 'Poland' }, /invalid:country/],
    [{ delivery: '<script>' }, /invalid:delivery/],
    [{ consent: false }, /invalid:consent/],
    [{ lines: [] }, /empty/],
    [{ lines: [{ slug: 'chess', qty: 0 }] }, /invalid:lines/],
    [{ lines: [{ slug: 'chess', qty: 'lots' }] }, /invalid:lines/],
  ];
  for (const [over, re] of cases) await rejects(submit(order(over), '10.0.0.12'), re, JSON.stringify(over));
  const ok = await submit(order({ method: 'telegram', contact: '@abawka_fan', lines: [{ slug: 'chess', qty: 1 }] }), '10.0.0.12');
  assert.ok(ok.id > 0);
});

test('request: honeypot gets a fake success and nothing is stored', async () => {
  const before = (await admin('select count(*)::int n from public.requests')).rows[0].n;
  const r = await submit(order({ website: 'http://spam.example' }), '10.0.0.13');
  assert.equal(r.id, 0);
  assert.equal((await admin('select count(*)::int n from public.requests')).rows[0].n, before);
});

test('request: more than 5 in 10 minutes from one address is refused', async () => {
  await admin(`update public.products set stock = 100 where slug = 'bobo-balloon'`);
  for (let i = 0; i < 5; i++) await submit(order({ lines: [{ slug: 'bobo-balloon', qty: 1 }] }), '10.0.0.99');
  await rejects(submit(order({ lines: [{ slug: 'bobo-balloon', qty: 1 }] }), '10.0.0.99'), /rate_limited/);
  assert.ok((await submit(order({ lines: [{ slug: 'bobo-balloon', qty: 1 }] }), '10.0.0.98')).id > 0); // інша адреса — можна
});

test('request: staff changes status and note only; cancelling returns stock, un-cancelling reserves again', async () => {
  await admin(`update public.products set stock = 5 where slug = 'knight-sword'`);
  const { id } = await submit(order({ lines: [{ slug: 'knight-sword', qty: 3 }] }), '10.0.0.20');
  assert.equal(await stockOf('knight-sword'), 2);
  await rejects(as(MANAGER, `update public.requests set total = 1 where id = ${id}`), /лише статус/);
  await as(MANAGER, `update public.requests set status = 'cancelled', staff_note = 'передумав' where id = ${id}`);
  assert.equal(await stockOf('knight-sword'), 5);
  await as(MANAGER, `update public.requests set status = 'contacted' where id = ${id}`);
  assert.equal(await stockOf('knight-sword'), 2);
  await rejects(as(MANAGER, `delete from public.requests where id = ${id} returning id`).then((r) => { if (!r.rows.length) throw new Error('blocked'); }), /blocked/);
  assert.equal((await as(OWNER, `delete from public.requests where id = ${id} returning id`)).rows.length, 1);
});

test('request: nobody can insert directly, only through submit_request', async () => {
  await rejects(as('anon', `insert into public.requests (locale, name, method, contact, country, delivery, currency, total, items) values ('pl','Bot','call','+48600000000','PL','x','EUR',0,'[{}]')`), /row-level security|permission denied/);
  await rejects(as(OWNER, `insert into public.requests (locale, name, method, contact, country, delivery, currency, total, items) values ('pl','Bot','call','+48600000000','PL','x','EUR',0,'[{}]')`), /row-level security/);
});

test('telegram: a new request signals the telegram function with its number only', async () => {
  await admin('delete from net.calls');
  await admin(`update public.products set stock = 10 where slug = 'bobo-balloon'`);
  const r = await submit(order(), '10.0.0.30');
  const calls = (await admin('select url, body from net.calls')).rows;
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/functions\/v1\/telegram$/);
  assert.deepEqual(calls[0].body, { request: r.id });
});

test('telegram: if the signal fails, the request is still saved', async () => {
  await admin(`create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
    returns bigint language plpgsql as $$ begin raise exception 'network down'; end $$`);
  try {
    const r = await submit(order(), '10.0.0.31');
    assert.equal((await admin('select count(*)::int n from public.requests where id = $1', [r.id])).rows[0].n, 1);
  } finally {
    await admin(`create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
      returns bigint language sql as $$ insert into net.calls values (url, body) returning 1::bigint $$`);
  }
});

test('telegram: a manager cannot change someone else\'s telegram chat', async () => {
  const r = await as(MANAGER, `update public.staff set telegram_chat_id = 1 where user_id = '${OWNER}' returning user_id`);
  assert.equal(r.rows.length, 0);
});

test('retention: old IPs are wiped, old requests deleted as the privacy policy says', async () => {
  const add = async (status, age, ip = '10.9.9.9') => (await admin(
    `insert into public.requests (locale, name, method, contact, country, delivery, currency, total, items, ip, status, created_at)
     values ('pl', 'Old', 'call', '+48600000000', 'PL', 'inpost', 'EUR', 100, '[{"slug":"x","qty":1}]', $1, $2, now() - $3::interval) returning id`,
    [ip, status, age])).rows[0].id;
  const fresh = await add('new', '1 day');
  const month = await add('done', '40 days');
  const unsold = await add('contacted', '13 months');
  const sold = await add('done', '13 months');
  const ancient = await add('done', '7 years');
  await admin('select public.cleanup_personal_data()');
  const left = Object.fromEntries((await admin(`select id, ip from public.requests where id = any($1)`, [[fresh, month, unsold, sold, ancient]])).rows.map((r) => [r.id, r.ip]));
  assert.equal(left[fresh], '10.9.9.9');
  assert.equal(left[month], '');
  assert.equal(left[unsold], undefined);
  assert.equal(left[sold], '');
  assert.equal(left[ancient], undefined);
  // Стирання IP не відкриває шлях до підміни: вписати іншу адресу не можна.
  await rejects(as(MANAGER, `update public.requests set ip = '1.2.3.4' where id = ${fresh}`), /лише статус/);
  await rejects(as('anon', 'select public.cleanup_personal_data()'), /permission denied/);
});

// ── Акції й промокоди ─────────────────────────────────────────────────────────
const idOf = async (slug) => (await admin(`select id from public.products where slug = $1`, [slug])).rows[0].id;
const product = async (slug) => (await admin(`select price, old_price from public.products where slug = $1`, [slug])).rows[0];

test('sale: owner starts and ends a sale; manager and buyers cannot', async () => {
  await admin(`update public.products set price = 2000, old_price = null where slug = 'chess'`);
  const chess = await idOf('chess');
  await rejects(as(MANAGER, `select public.start_sale(array['${chess}']::uuid[], 25)`), /forbidden/);
  await rejects(as('anon', `select public.start_sale(array['${chess}']::uuid[], 25)`), /permission denied/);
  await rejects(as(OWNER, `select public.start_sale(array['${chess}']::uuid[], 95)`), /invalid:percent/);
  assert.equal((await as(OWNER, `select public.start_sale(array['${chess}']::uuid[], 25) n`)).rows[0].n, 1);
  assert.deepEqual(await product('chess'), { price: 1500, old_price: 2000 });
  // Друга акція рахується від ціни до першої, а не від уже зниженої.
  await as(OWNER, `select public.start_sale(array['${chess}']::uuid[], 10)`);
  assert.deepEqual(await product('chess'), { price: 1800, old_price: 2000 });
  await as(OWNER, `select public.end_sale(array['${chess}']::uuid[])`);
  assert.deepEqual(await product('chess'), { price: 2000, old_price: null });
});

test('omnibus: lowest price of the 30 days before the current price', async () => {
  const id = await idOf('knight-sword');
  // Спершу ціна товару (тригер пише свій рядок історії), потім історію замінюємо контрольованою.
  await admin(`update public.products set price = 1999, old_price = 2800 where id = $1`, [id]);
  await admin(`delete from public.price_history where product_id = $1`, [id]);
  await admin(`insert into public.price_history (product_id, price, changed_at) values
    ($1, 3000, now() - interval '90 days'),  -- діяла на початку 30-денного вікна
    ($1, 2500, now() - interval '20 days'),
    ($1, 2800, now() - interval '10 days'),
    ($1, 1999, now())`, [id]);
  const low = async () => (await as('anon', `select lowest_30d from public.product_lowest_30d where product_id = $1`, [id])).rows[0].lowest_30d;
  assert.equal(await low(), 2500);
  await admin(`update public.price_history set changed_at = now() - interval '40 days' where product_id = $1 and price = 2500`, [id]);
  assert.equal(await low(), 2500, 'ціна, що діяла на початку вікна, теж рахується');
  await admin(`delete from public.price_history where product_id = $1 and price in (2500, 3000)`, [id]);
  assert.equal(await low(), 2800);
});

test('promo: buyers check a code, the server computes the discount; codes stay hidden', async () => {
  await admin(`update public.products set price = 1000, stock = 20, old_price = null where slug = 'bobo-balloon'`);
  await as(OWNER, `insert into public.promo_codes (code, kind, value, min_total) values ('SUMMER10', 'percent', 10, 0), ('MINUS5', 'amount', 500, 3000)`);
  await rejects(as(MANAGER, `insert into public.promo_codes (code, kind, value) values ('MGR', 'percent', 50)`), /row-level security/);
  assert.equal((await as('anon', 'select count(*)::int n from public.promo_codes')).rows[0].n, 0);
  const check = (payload) => as('anon', 'select public.check_promo($1::jsonb) r', [JSON.stringify(payload)]).then((r) => r.rows[0].r);
  assert.deepEqual(await check({ promo: ' summer10 ', lines: [{ slug: 'bobo-balloon', qty: 2 }] }), { code: 'SUMMER10', subtotal: 2000, discount: 200, total: 1800 });
  await rejects(check({ promo: 'MINUS5', lines: [{ slug: 'bobo-balloon', qty: 2 }] }), /promo:min:3000/);
  await rejects(check({ promo: 'NOPE', lines: [{ slug: 'bobo-balloon', qty: 1 }] }), /promo:invalid/);
  await rejects(as('anon', `select * from public.promo_discount('SUMMER10', 1000)`), /permission denied/);
});

test('promo: request total includes the discount; limits, dates and cancellation are respected', async () => {
  await as(OWNER, `insert into public.promo_codes (code, kind, value, max_uses) values ('ONCE', 'amount', 300, 1)`);
  await as(OWNER, `insert into public.promo_codes (code, kind, value, ends_at) values ('OLD', 'percent', 20, now() - interval '1 day')`);
  const r = await submit(order({ promo: 'once', lines: [{ slug: 'bobo-balloon', qty: 1, price: 1 }] }), '10.0.0.40');
  const row = (await admin(`select total, discount, promo_code from public.requests where id = $1`, [r.id])).rows[0];
  assert.deepEqual(row, { total: 700, discount: 300, promo_code: 'ONCE' });
  await rejects(submit(order({ promo: 'ONCE' }), '10.0.0.41'), /promo:invalid/); // ліміт 1 використання
  await rejects(submit(order({ promo: 'OLD' }), '10.0.0.41'), /promo:invalid/);
  await as(MANAGER, `update public.requests set status = 'cancelled' where id = ${r.id}`);
  assert.equal((await admin(`select used from public.promo_codes where code = 'ONCE'`)).rows[0].used, 0);
  await rejects(as(MANAGER, `update public.requests set discount = 0 where id = ${r.id}`), /лише статус/);
  // Знижка не робить суму від'ємною.
  await as(OWNER, `insert into public.promo_codes (code, kind, value) values ('BIG', 'amount', 99999)`);
  const big = await submit(order({ promo: 'BIG', lines: [{ slug: 'bobo-balloon', qty: 1 }] }), '10.0.0.42');
  assert.equal((await admin(`select total from public.requests where id = $1`, [big.id])).rows[0].total, 0);
});

// ── Статистика ────────────────────────────────────────────────────────────────
test('stats: buyers add anonymous view counters, only valid values are kept', async () => {
  const track = (p) => as('anon', 'select public.track_view($1::jsonb)', [JSON.stringify(p)]);
  await track({ page: 'product', product: 'chess', locale: 'pl', referrer: 'www.Google.com' });
  await track({ page: 'product', product: 'chess', locale: 'pl', referrer: 'google.com' });
  await track({ page: 'product', product: 'no-such-toy', locale: 'xx', referrer: 'javascript:alert(1)' });
  await track({ page: '<script>' });
  const rows = (await admin(`select metric, key, n from public.daily_stats where day = current_date order by metric, key`)).rows;
  assert.deepEqual(rows, [
    { metric: 'locale', key: 'pl', n: 2 },
    { metric: 'page', key: 'product', n: 3 },
    { metric: 'product', key: 'chess', n: 2 },
    { metric: 'referrer', key: 'google.com', n: 2 },
  ]);
  assert.equal((await as('anon', 'select count(*)::int n from public.daily_stats')).rows[0].n, 0);
  await rejects(as('anon', `insert into public.daily_stats (metric, key, n) values ('page', 'home', 999)`), /row-level security|permission denied/);
});

test('stats: owner gets the summary for a period; manager does not', async () => {
  const s = (await as(OWNER, `select public.shop_stats(current_date - 6, current_date) s`)).rows[0].s;
  assert.ok(s.requests.total >= 1);
  assert.equal(typeof s.requests.revenue, 'number');
  assert.ok(Array.isArray(s.requests.products));
  assert.equal(s.views.pages, 3);
  assert.deepEqual(s.views.products, [{ key: 'chess', n: 2 }]);
  await rejects(as(MANAGER, `select public.shop_stats(current_date - 6, current_date)`), /forbidden/);
  await rejects(as('anon', `select public.shop_stats(current_date - 6, current_date)`), /permission denied/);
});

// ── Відгуки від покупців ─────────────────────────────────────────────────────
async function review(payload, ip = '10.1.0.1') {
  await db.exec('reset role');
  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify({ 'x-forwarded-for': ip })]);
  await db.exec(`set role anon; set request.jwt.claim.sub = ''`);
  try { return (await db.query('select public.submit_review($1::jsonb) r', [JSON.stringify(payload)])).rows[0].r; }
  finally { await db.exec('reset role'); }
}
const goodReview = (over = {}) => ({ name: 'Olena', rating: 5, text: 'Син у захваті від меча!', locale: 'uk', product: 'knight-sword', consent: true, website: '', ...over });

test('reviews: buyer sends a review, it waits for moderation and is hidden until approved', async () => {
  await admin('delete from net.calls');
  assert.deepEqual(await review(goodReview()), { ok: true });
  await review(goodReview({ product: '', text: 'Дуже гарний магазин, швидко відповіли.' }), '10.1.0.2');
  const rows = (await admin(`select id, author, rating, body, locale, approved, product_id from public.reviews where author = 'Olena' order by created_at`)).rows;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].body, { uk: 'Син у захваті від меча!' });
  assert.equal(rows[0].approved, false);
  assert.ok(rows[0].product_id);
  assert.equal(rows[1].product_id, null); // про магазин загалом
  assert.equal((await as('anon', `select count(*)::int n from public.reviews where author = 'Olena'`)).rows[0].n, 0);
  assert.equal((await admin(`select count(*)::int n from net.calls where body ? 'review'`)).rows[0].n, 2); // сигнал у Telegram
  await as(MANAGER, `update public.reviews set approved = true where id = '${rows[0].id}'`);
  assert.equal((await as('anon', `select count(*)::int n from public.reviews where author = 'Olena'`)).rows[0].n, 1);
  await rejects(as(MANAGER, `update public.reviews set rating = 1 where id = '${rows[0].id}'`), /лише публікацію/);
  assert.equal((await as(MANAGER, `delete from public.reviews where id = '${rows[1].id}' returning id`)).rows.length, 1);
});

test('reviews: server-side validation, honeypot and rate limit', async () => {
  const bad = async (over, re) => rejects(review(goodReview(over), '10.1.0.9'), re);
  await bad({ name: 'A' }, /invalid:name/);
  await bad({ rating: 6 }, /invalid:rating/);
  await bad({ rating: '4.5' }, /invalid:rating/);
  await bad({ text: 'коротко' }, /invalid:text/);
  await bad({ consent: false }, /invalid:consent/);
  await bad({ product: 'no-such-toy' }, /invalid:product/);
  const before = (await admin('select count(*)::int n from public.reviews')).rows[0].n;
  assert.deepEqual(await review(goodReview({ website: 'http://spam' }), '10.1.0.9'), { ok: true });
  assert.equal((await admin('select count(*)::int n from public.reviews')).rows[0].n, before);
  for (let i = 0; i < 3; i++) await review(goodReview({ name: `Bot ${i}` }), '10.1.0.10');
  await rejects(review(goodReview(), '10.1.0.10'), /rate_limited/);
  await rejects(as('anon', `insert into public.reviews (author, rating, body, approved) values ('X', 5, '{"en":"fake"}', true)`), /row-level security/);
});

test('request: phone must be in international format (+country code), as the form sends it', async () => {
  await admin(`update public.products set stock = 20 where slug = 'bobo-balloon'`);
  await rejects(submit(order({ contact: '600000000' }), '10.2.0.1'), /invalid:contact/); // без коду країни
  await rejects(submit(order({ contact: '+0600000000' }), '10.2.0.1'), /invalid:contact/);
  await rejects(submit(order({ contact: '+4860' }), '10.2.0.1'), /invalid:contact/);
  assert.ok((await submit(order({ contact: '+380671234567' }), '10.2.0.2')).id > 0);
  assert.ok((await submit(order({ method: 'telegram', contact: '@olena_shop' }), '10.2.0.3')).id > 0);
});
