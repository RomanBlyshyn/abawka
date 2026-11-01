import { expect, test } from './fixtures';
import { mockAdmin, sampleDb } from './helpers/supabase-mock';
import { describePath } from '../../src/lib/stats-path';

const iso = (daysAgo: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const STATS = {
  requests: {
    total: 5, cancelled: 1, sold: 3, revenue: 12497, by_day: { [iso(0)]: 2, [iso(3)]: 3 },
    products: [{ slug: 'toy-sword', name: 'Іграшковий меч', qty: 6 }, { slug: 'chess', name: 'Шахи', qty: 2 }],
    countries: [{ key: 'PL', n: 4 }, { key: 'UA', n: 1 }], locales: [{ key: 'pl', n: 4 }],
  },
  views: { pages: 1234, by_day: {}, products: [{ key: 'toy-sword', n: 80 }], locales: [{ key: 'uk', n: 50 }, { key: 'pl', n: 20 }], referrers: [] },
};

test.describe('admin: statistics', () => {
  test('owner sees totals, requests per day and rankings; period can be changed', async ({ page }) => {
    const db = sampleDb();
    await mockAdmin(page, db);
    const calls: { p_from: string; p_to: string }[] = [];
    await page.route(/\/rest\/v1\/rpc\/shop_stats/, (r) => { calls.push(r.request().postDataJSON()); return r.fulfill({ json: STATS }); });
    await page.goto('/admin/stats/');
    await expect(page.locator('[data-stat="total"]')).toHaveText('5');
    await expect(page.locator('[data-stat="cancelled"]')).toHaveText('з них скасовано 1');
    await expect(page.locator('[data-stat="revenue"]')).toHaveText('124.97 EUR');
    await expect(page.locator('[data-stat="pages"]')).toHaveText(/1\s234/);
    expect(calls[0]).toEqual({ p_from: iso(29), p_to: iso(0) });

    const cols = page.locator('[data-chart] .col');
    await expect(cols).toHaveCount(30);
    await expect(cols.last()).toHaveAttribute('aria-label', /: 2 заявки$/);
    await expect(page.locator('[data-rank="ordered"] li').first()).toHaveText(/Іграшковий меч\s*6/);
    await expect(page.locator('[data-rank="viewed"] li').first()).toHaveText(/Іграшковий меч\s*80/); // назва товару, а не адреса
    await expect(page.locator('[data-rank="countries"]')).toContainText('Польща');
    await expect(page.locator('[data-rank="locales"] li').first()).toContainText('Українська');
    await expect(page.locator('[data-rank="referrers"]')).toHaveText('За цей період даних немає.');

    await page.getByRole('button', { name: '7 днів' }).click();
    await expect(cols).toHaveCount(7);
    expect(calls[1]).toEqual({ p_from: iso(6), p_to: iso(0) });
  });

  test('manager: statistics are for the owner only', async ({ page }) => {
    await mockAdmin(page, sampleDb(), { role: 'manager' });
    await page.goto('/admin/stats/');
    await expect(page.getByText('Статистика доступна лише власнику магазину.')).toBeVisible();
  });
});

test.describe('view counter', () => {
  test('sends page type, product and language once per visit, no cookies', async ({ page }) => {
    const sent: Record<string, string>[] = [];
    await page.route(/\/rest\/v1\/rpc\/track_view/, (r) => { sent.push(r.request().postDataJSON().payload); return r.fulfill({ status: 204 }); });
    await page.goto('/pl/product/toy-sword/');
    await page.reload();
    await page.goto('/pl/catalog/swords/');
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[0]).toEqual({ page: 'product', product: 'toy-sword', locale: 'pl', referrer: '' });
    expect(sent[1]).toMatchObject({ page: 'category', locale: 'pl' });
    expect(await page.context().cookies()).toEqual([]);
  });

  test('admin pages are not counted', async ({ page }) => {
    let n = 0;
    await page.route(/\/rest\/v1\/rpc\/track_view/, (r) => { n++; return r.fulfill({ status: 204 }); });
    await page.goto('/admin/');
    await page.waitForTimeout(300);
    expect(n).toBe(0);
  });

  test('path → page type', () => {
    expect(describePath('/uk/')).toEqual({ page: 'home', locale: 'uk' });
    expect(describePath('/uk/catalog/')).toEqual({ page: 'catalog', locale: 'uk' });
    expect(describePath('/en/cart/')).toEqual({ page: 'cart', locale: 'en' });
    expect(describePath('/en/terms/')).toEqual({ page: 'other', locale: 'en' });
  });
});
