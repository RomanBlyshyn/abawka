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

type Row = Record<string, unknown> & { id?: string };
export interface Db { products: Row[]; categories: Row[]; product_images: Row[]; banners: Row[]; requests_table: Row[]; promo_codes: Row[]; settings: Row[]; reviews: Row[]; storage: string[]; telegram: { chatId: number | null; actions: string[] }; requests: { method: string; url: string; body: unknown }[] }

const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' };
const reply = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', headers: cors, body: body === undefined ? '' : JSON.stringify(body) });

/** Увійти (сесія в localStorage) і підмінити auth + REST + functions. */
export async function mockAdmin(page: Page, db: Db, opts: { role?: 'owner' | 'manager'; translate?: 'ok' | 'fail'; dbError?: { code: string; status: number }; storageError?: boolean; telegram?: 'fail' } = {}) {
  await page.route(/\/auth\/v1\/token/, (r) => reply(r, session()));
  await page.route(/\/auth\/v1\/user/, (r) => reply(r, USER));
  await page.route(/\/auth\/v1\/logout/, (r) => r.fulfill({ status: 204, headers: cors }));
  await page.route(/\/rest\/v1\/staff\?/, (r) => reply(r, [{ role: opts.role ?? 'owner', telegram_chat_id: db.telegram.chatId }]));
  await page.route(/\/functions\/v1\/telegram/, (r) => {
    const { action } = r.request().postDataJSON();
    db.telegram.actions.push(action);
    if (opts.telegram === 'fail') return reply(r, { error: 'telegram' }, 502);
    if (action === 'link') return reply(r, { url: 'https://t.me/abawka_test_bot?start=0123456789abcdef0123456789abcdef' });
    if (action === 'unlink') db.telegram.chatId = null;
    return reply(r, { ok: true });
  });

  await page.route(/\/functions\/v1\/translate/, async (r) => {
    const { texts, targets } = r.request().postDataJSON();
    if (opts.translate === 'fail') return reply(r, { error: 'not configured' }, 503);
    const translations = Object.fromEntries(targets.map((t: string) => [t, Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, `[${t}] ${v}`]))]));
    return reply(r, { translations });
  });

  // Акції: та сама логіка, що в start_sale/end_sale у базі.
  await page.route(/\/rest\/v1\/rpc\/(start_sale|end_sale)/, async (route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop()!;
    const body = route.request().postDataJSON() as { product_ids: string[]; percent?: number };
    db.requests.push({ method: 'RPC', url: fn, body });
    if (opts.role === 'manager') return reply(route, { code: '42501', message: 'forbidden' }, 403);
    let n = 0;
    for (const p of db.products.filter((x) => body.product_ids.includes(x.id!))) {
      if (fn === 'start_sale') {
        const base = (p.old_price as number | null) ?? (p.price as number);
        Object.assign(p, { old_price: base, price: Math.max(1, Math.round(base * (100 - body.percent!) / 100)) });
        n++;
      } else if (p.old_price) {
        Object.assign(p, { price: p.old_price, old_price: null });
        n++;
      }
    }
    return reply(route, n);
  });

  await page.route(/\/rest\/v1\/(products|categories|product_images|banners|requests|promo_codes|settings|reviews)(\?|$)/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const name = url.pathname.split('/').pop()!;
    const table = (name === 'requests' ? 'requests_table' : name) as 'products' | 'categories' | 'product_images' | 'banners' | 'requests_table' | 'promo_codes' | 'settings' | 'reviews';
    const rows = db[table];
    const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    // Фільтри виду col=eq.value (id, product_id …).
    const eqs = [...url.searchParams].filter(([, v]) => v.startsWith('eq.')).map(([k, v]) => [k, v.slice(3)] as const);
    const matches = (r: Row) => eqs.every(([k, v]) => String(r[k]) === v);
    const method = req.method();
    if (method !== 'GET' && method !== 'HEAD') db.requests.push({ method, url: req.url(), body: req.postDataJSON?.() ?? null });
    if (opts.dbError && method !== 'GET') return reply(route, { code: opts.dbError.code, message: 'mock error' }, opts.dbError.status);

    if (method === 'GET') {
      let out = rows.filter(matches);
      if (url.searchParams.get('order')?.startsWith('position')) out = [...out].sort((a, b) => Number(a.position) - Number(b.position));
      if (table === 'products') out = out.map((p) => ({ ...p, images: db.product_images.filter((i) => i.product_id === p.id) }));
      if (table === 'reviews') out = out.map((r) => ({ ...r, product: db.products.find((p) => p.id === r.product_id) ?? null }));
      if (table === 'categories') out = out.map((c) => ({ ...c, products: [{ count: db.products.filter((p) => p.category_id === c.id).length }] }));
      return reply(route, single ? out[0] ?? null : out);
    }
    if (method === 'POST') {
      const created = { ...(table === 'promo_codes' ? { used: 0, active: true } : { id: `new-${rows.length + 1}` }), ...(req.postDataJSON() as object) } as Row;
      if (table === 'promo_codes' && rows.some((r) => r.code === created.code)) return reply(route, { code: '23505', message: 'duplicate key' }, 409);
      rows.push(created);
      return reply(route, single ? created : [created], 201);
    }
    if (method === 'PATCH') {
      const row = rows.find(matches);
      if (!row) return reply(route, { code: 'PGRST116', message: 'no rows' }, 406);
      Object.assign(row, req.postDataJSON());
      return reply(route, single ? row : [row]);
    }
    if (method === 'DELETE') {
      (db[table] as Row[]) = rows.filter((r) => !matches(r));
      return route.fulfill({ status: 204, headers: cors });
    }
    return reply(route, { message: 'unsupported' }, 400);
  });

  // Сховище: завантаження, видалення й публічні картинки.
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.route(/\/storage\/v1\/object\/public\//, (r) => r.fulfill({ contentType: 'image/png', body: PNG, headers: cors }));
  await page.route(/\/storage\/v1\/object\/catalog/, async (route) => {
    const req = route.request();
    if (opts.storageError) return reply(route, { statusCode: '500', error: 'mock', message: 'mock storage error' }, 500);
    if (req.method() === 'DELETE') {
      const { prefixes } = req.postDataJSON() as { prefixes: string[] };
      db.requests.push({ method: 'STORAGE-DELETE', url: req.url(), body: prefixes });
      db.storage = db.storage.filter((k) => !prefixes.includes(k));
      return reply(route, prefixes.map((name) => ({ name })));
    }
    const key = decodeURIComponent(new URL(req.url()).pathname.split('/storage/v1/object/catalog/')[1]!);
    db.storage.push(key);
    // supabase-js шле Blob як multipart: тип файлу — у заголовку частини, не запиту.
    const raw = req.postDataBuffer() ?? Buffer.alloc(0);
    const contentType = /content-type:\s*(image\/[a-z+.-]+)/i.exec(raw.toString('latin1'))?.[1] ?? req.headers()['content-type'];
    db.requests.push({ method: 'STORAGE-UPLOAD', url: key, body: { contentType, bytes: raw.length } });
    return reply(route, { Key: `catalog/${key}`, Id: key });
  });

  // Сесія як після входу: supabase-js читає її з localStorage.
  const ref = 'abawka-test'; // див. playwright.config.ts: тестова збірка ходить на https://abawka-test.supabase.co
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
  banners: [
    { id: 'b-hits', title: { uk: 'Мечі — наш хіт' }, body: { uk: 'Для лицарів' }, cta: { uk: 'Дивитись' }, href: 'catalog/swords/', tint: 'pink', mascot: true, active: true, position: 0 },
  ],
  requests_table: [],
  promo_codes: [],
  reviews: [],
  settings: [{ base_currency: 'EUR' }],
  storage: [],
  requests: [],
  telegram: { chatId: null, actions: [] },
});
