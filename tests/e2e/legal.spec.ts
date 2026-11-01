import { expect, test } from './fixtures';

const LOCALES = ['pl', 'en', 'uk', 'de', 'cs', 'lt', 'es', 'fr', 'ru'];
const DOCS = ['terms/', 'privacy/', 'returns/'];

test('legal pages: footer links open real pages; text is in English', async ({ page }) => {
  await page.goto('/pl/cart/');
  for (const name of ['Regulamin', 'Polityka prywatności', 'Zwroty']) {
    const link = page.locator('footer').getByRole('link', { name, exact: true });
    const res = await page.request.get(await link.getAttribute('href') as string);
    expect(res.status(), name).toBe(200);
  }
  await page.goto('/pl/terms/');
  await expect(page.getByText('Ten dokument jest dostępny w języku angielskim.')).toBeVisible();
  await expect(page.locator('article')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Terms of Sale');
  await expect(page).toHaveTitle('Regulamin · ABAWKA');
  await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/); // копії англійського тексту не дублюються в пошуку
  await page.goto('/en/terms/');
  await expect(page.getByText('This document is available in English.')).toHaveCount(0);
  await expect(page.locator('meta[name=robots]')).toHaveCount(0);
});

test('legal pages: seller from shop data; missing details are clearly marked, not invented', async ({ page }) => {
  await page.goto('/en/returns/');
  const seller = page.locator('address').first();
  await expect(seller).toContainText('Viktor Marchenko');
  await expect(seller).toContainText('ul. Wojrowicka 48');
  await expect(seller).toContainText('[email — to be added]');
  await expect(page.getByRole('heading', { name: 'Model withdrawal form' })).toBeVisible();
  await page.goto('/en/privacy/');
  // Строки — ті самі, що чистить база (cleanup_personal_data).
  for (const term of ['IP address — 30 days.', 'Requests that did not lead to a purchase — 12 months.', 'Completed purchases — 5 years']) {
    await expect(page.getByText(term)).toBeVisible();
  }
});

test('footer: no made-up messenger link while the shop has none', async ({ page }) => {
  await page.goto('/en/');
  await expect(page.locator('footer a[href*="t.me"]')).toHaveCount(0);
});

test('legal pages: no overflow or errors in any language', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 320, height: 800 });
  for (const locale of LOCALES) for (const doc of DOCS) {
    await page.goto(`/${locale}/${doc}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow, `${locale}/${doc}`).toBe(0);
  }
  expect(errors).toEqual([]);
});
