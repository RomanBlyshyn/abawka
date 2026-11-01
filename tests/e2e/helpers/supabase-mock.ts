// Імітація Supabase для e2e адмінки: вхід, роль і таблиці в пам'яті тесту.
import type { Page, Route } from '@playwright/test';

export const USER = { id: '11111111-1111-1111-1111-111111111111', email: 'owner@abawka.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
export const session = () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, email: USER.email, role: 'authenticated', aud: 'authenticated', exp })}.sig`,
    token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'refresh', user: USER,
  };
};

type Row = Record<string, unknown> & { id: string };
export interface Db { products: Row[]; categories: Row[]; product_images: Row[]; requests: { method: string; url: string; body: unknown }[] }

const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' };
const reply = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', headers: cors, body: body === undefined ? '' : JSON.stringify(body) });

/** Увійти (сесія в localStorage) і підмінити auth + REST + functions. */
export async function mockAdmin(page: Page, db: Db, opts: { role?: 'owner' | 'manager'; translate?: 'ok' | 'fail'; dbError?: { code: string; status: number } } = {}) {
  await page.route(/\/auth\/v1\/token/, (r) => reply(r, session()));
  await page.route(/\/auth\/v1\/user/, (r) => reply(r, USER));
  await page.route(/\/auth\/v1\/logout/, (r) => r.fulfill({ status: 204, headers: cors }));
  await page.route(/\/rest\/v1\/staff\?/, (r) => reply(r, [{ role: opts.role ?? 'owner' }]));

  await page.route(/\/functions\/v1\/translate/, async (r) => {
    const { texts, targets } = r.request().postDataJSON();
    if (opts.translate === 'fail') return reply(r, { error: 'not configured' }, 503);
    const translations = Object.fromEntries(targets.map((t: string) => [t, Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, `[${t}] ${v}`]))]));
    return reply(r, { translations });
  });

  await page.route(/\/rest\/v1\/(products|categories|product_images)/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const table = url.pathname.split('/').pop() as 'products' | 'categories' | 'product_images';
    const rows = db[table];
    const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    const idEq = url.searchParams.get('id')?.replace(/^eq\./, '');
    const method = req.method();
    if (method !== 'GET' && method !== 'HEAD') db.requests.push({ method, url: req.url(), body: req.postDataJSON?.() ?? null });
    if (opts.dbError && method !== 'GET') return reply(route, { code: opts.dbError.code, message: 'mock error' }, opts.dbError.status);

    if (method === 'GET') {
      let out = idEq ? rows.filter((r) => r.id === idEq) : rows;
      if (table === 'products') out = out.map((p) => ({ ...p, images: db.product_images.filter((i) => i.product_id === p.id) }));
      return reply(route, single ? out[0] ?? null : out);
    }
    if (method === 'POST') {
      const created = { id: `new-${rows.length + 1}`, ...(req.postDataJSON() as object) } as Row;
      rows.push(created);
      return reply(route, single ? { id: created.id } : [{ id: created.id }], 201);
    }
    if (method === 'PATCH') {
      const row = rows.find((r) => r.id === idEq);
      if (!row) return reply(route, { code: 'PGRST116', message: 'no rows' }, 406);
      Object.assign(row, req.postDataJSON());
      return reply(route, single ? { id: row.id } : [{ id: row.id }]);
    }
    if (method === 'DELETE') {
      db[table] = rows.filter((r) => r.id !== idEq) as Row[];
      return route.fulfill({ status: 204, headers: cors });
    }
    return reply(route, { message: 'unsupported' }, 400);
  });

  // Сесія як після входу: supabase-js читає її з localStorage.
  const ref = new URL(process.env.PUBLIC_SUPABASE_URL ?? 'https://uvpoanwkoikudjdbreys.supabase.co').hostname.split('.')[0];
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [`sb-${ref}-auth-token`, JSON.stringify(session())]);
}

export const sampleDb = (): Db => ({
  categories: [
    { id: 'cat-swords', slug: 'swords', name: { uk: 'Мечі', en: 'Swords' }, position: 0 },
    { id: 'cat-games', slug: 'board-games', name: { uk: 'Настільні ігри', en: 'Board games' }, position: 1 },
  ],
  products: [
    { id: 'p-sword', slug: 'toy-sword', name: { uk: 'Іграшковий меч', en: 'Toy sword' }, description: {}, price: 1999, old_price: 2499, stock: 12, age_min: 3, hit: true, is_new: false, published: true, category_id: 'cat-swords', position: 0 },
    { id: 'p-chess', slug: 'chess', name: { uk: 'Шахи', en: 'Chess set' }, description: { uk: 'Дерев’яні' }, price: 3499, old_price: null, stock: 0, age_min: 6, hit: false, is_new: false, published: false, category_id: 'cat-games', position: 1 },
  ],
  product_images: [],
  requests: [],
});
