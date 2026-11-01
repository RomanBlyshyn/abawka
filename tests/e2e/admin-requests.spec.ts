import { expect, test } from './fixtures';
import { mockAdmin, sampleDb } from './helpers/supabase-mock';

const req = (id: number, over: Record<string, unknown> = {}) => ({
  id: String(id), created_at: '2026-11-01T10:00:00Z', status: 'new', locale: 'pl', name: 'Anna', method: 'call',
  contact: '+48 600 000 000', country: 'PL', delivery: 'inpost', comment: '', currency: 'EUR', total: 4598,
  items: [{ slug: 'toy-sword', name: { uk: 'Іграшковий меч', pl: 'Miecz zabawkowy' }, price: 1999, qty: 2 }, { slug: 'bobo-balloon', name: { pl: 'Balon Bobo' }, price: 600, qty: 1 }],
  staff_note: '', ...over,
});

test.describe('admin: requests', () => {
  test('new requests with contact links that open the right app', async ({ page }) => {
    const db = sampleDb();
    db.requests_table.push(
      req(1001),
      req(1002, { method: 'telegram', contact: '@abawka_fan', name: 'Olena', country: 'UA', delivery: 'nova-poshta', comment: 'Подарунок', promo_code: 'SAVE10', discount: 460, total: 4138 }),
      req(1003, { method: 'whatsapp', contact: '+380 67 000 00 00', status: 'contacted' }),
      req(1004, { status: 'done' }),
    );
    await mockAdmin(page, db);
    await page.goto('/admin/requests/');
    await expect(page.locator('[data-tab-count="new"]')).toHaveText('2');
    await expect(page.locator('[data-tab-count="work"]')).toHaveText('1');
    await expect(page.locator('.req')).toHaveCount(2);

    const anna = page.locator('.req[data-request-id="1001"]');
    await expect(anna.locator('[data-contact-link]')).toHaveAttribute('href', 'tel:+48600000000');
    await expect(anna).toContainText('Іграшковий меч × 2 — 39.98 EUR');
    await expect(anna).toContainText('Balon Bobo × 1');
    await expect(anna).toContainText('Разом: 45.98 EUR');
    await expect(anna).toContainText('Польща');

    const olena = page.locator('.req[data-request-id="1002"]');
    await expect(olena.locator('[data-contact-link]')).toHaveAttribute('href', 'https://t.me/abawka_fan');
    await expect(olena).toContainText('«Подарунок»');
    await expect(olena).toContainText('Нова пошта');
    await expect(olena.locator('.total')).toHaveText('Промокод SAVE10: −4.60 EUR · Разом: 41.38 EUR');
    await expect(anna.locator('[data-promo]')).toBeHidden();

    await page.getByRole('tab', { name: /В роботі/ }).click();
    await expect(page.locator('.req[data-request-id="1003"] [data-contact-link]')).toHaveAttribute('href', 'https://wa.me/380670000000');
  });

  test('changing the status saves it and moves the request to its tab', async ({ page }) => {
    const db = sampleDb();
    db.requests_table.push(req(1001));
    await mockAdmin(page, db);
    await page.goto('/admin/requests/');
    await page.locator('.req[data-request-id="1001"] [data-status]').selectOption('contacted');
    await expect(page.locator('[data-state="empty"]')).toBeVisible(); // з «Нових» зникла
    const patch = db.requests.find((r) => r.method === 'PATCH')!;
    expect(patch.url).toContain('id=eq.1001');
    expect(patch.body).toEqual({ status: 'contacted' });
    await page.getByRole('tab', { name: /В роботі/ }).click();
    await expect(page.locator('.req[data-request-id="1001"] [data-status]')).toHaveValue('contacted');
  });

  test('cancelling asks first (stock goes back to the shelf)', async ({ page }) => {
    const db = sampleDb();
    db.requests_table.push(req(1001));
    await mockAdmin(page, db);
    await page.goto('/admin/requests/');
    const select = page.locator('.req[data-request-id="1001"] [data-status]');
    page.once('dialog', (d) => { expect(d.message()).toContain('Товар повернеться на склад'); d.dismiss(); });
    await select.selectOption('cancelled');
    await expect(select).toHaveValue('new');
    expect(db.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0);
  });

  test('team note is saved', async ({ page }) => {
    const db = sampleDb();
    db.requests_table.push(req(1001));
    await mockAdmin(page, db);
    await page.goto('/admin/requests/');
    const card = page.locator('.req[data-request-id="1001"]');
    await card.getByText('Нотатка для команди').click();
    await card.locator('[data-note]').fill('Оплатила на картку');
    await card.getByRole('button', { name: 'Зберегти нотатку' }).click();
    await expect(card.locator('[data-row-msg]')).toHaveText('Нотатку збережено ✓');
    expect(db.requests.find((r) => r.method === 'PATCH')!.body).toEqual({ staff_note: 'Оплатила на картку' });
  });
});
