import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';

const LOCALES = ['pl', 'en', 'uk', 'de', 'cs', 'lt', 'es', 'fr', 'ru'];

test('404: unknown address shows the bear page with ways back, not indexed', async ({ page }) => {
  const res = await page.goto('/no-such-page/');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
  await page.goto('/uk/404/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сторінку не знайдено');
  await page.getByRole('link', { name: 'До каталогу' }).click();
  await expect(page).toHaveURL(/\/uk\/catalog\/$/);
});

test('404: every language has its own page; hosting rules point to it', async ({ page }) => {
  const rules = readFileSync('public/_redirects', 'utf8');
  for (const l of LOCALES) {
    expect(rules).toContain(`/${l}/*  /${l}/404/  404`);
    expect((await page.request.get(`/${l}/404/`)).status()).toBe(200);
  }
});

test('sitemap: shop pages in, service pages out; robots.txt points to it', async ({ page }) => {
  const xml = await (await page.request.get('/sitemap-0.xml')).text();
  expect(xml).toContain('/pl/catalog/swords/');
  expect(xml).toContain('/en/product/toy-sword/');
  expect(xml).toContain('/en/terms/');
  expect(xml).toContain('hreflang="uk"');
  for (const hidden of ['/admin/', '/en/cart/', '/en/thanks/', '/en/404/', '/pl/terms/']) expect(xml, hidden).not.toContain(hidden);
  const robots = await (await page.request.get('/robots.txt')).text();
  expect(robots).toContain('Disallow: /admin/');
  expect(robots).toMatch(/Sitemap: https?:\/\/[^/]+\/sitemap-index\.xml/);
});
