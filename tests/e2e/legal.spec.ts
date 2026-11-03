import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from './fixtures';

const LOCALES = ['pl', 'en', 'uk', 'de', 'cs', 'lt', 'es', 'fr', 'ru'];
const DOCS = ['terms/', 'privacy/', 'returns/'];

test('legal pages: footer links open real pages in the site language, with a link to the English original', async ({ page }) => {
  await page.goto('/pl/cart/');
  for (const name of ['Regulamin', 'Polityka prywatności', 'Zwroty']) {
    const link = page.locator('footer').getByRole('link', { name, exact: true });
    const res = await page.request.get(await link.getAttribute('href') as string);
    expect(res.status(), name).toBe(200);
  }
  await page.goto('/uk/returns/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Повернення товарів та право на відмову від угоди');
  await expect(page.locator('.note')).toContainText('У разі розбіжностей діє англійська версія');
  await page.locator('.note').getByRole('link', { name: 'English version' }).click();
  await expect(page).toHaveURL(/\/en\/returns\/$/);
  await expect(page.locator('.note')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Returns and right of withdrawal');
  await page.goto('/uk/terms/');
  await expect(page).toHaveTitle('Регламент · ABAWKA');
  await expect(page.locator('meta[name=robots]')).toHaveCount(0); // переклад — окрема сторінка для пошуку
  await page.locator('article').getByRole('link', { name: /Повернення/ }).click();
  await expect(page).toHaveURL(/\/uk\/returns\/$/); // посилання всередині документа ведуть на ту саму мову
});

test('legal pages: seller from shop data in every language, with clickable email and phone', async ({ page }) => {
  for (const [locale, country, phone] of [['en', 'Poland', 'Phone'], ['uk', 'Польща', 'Телефон'], ['de', 'Polen', 'Telefon']]) {
    await page.goto(`/${locale}/returns/`);
    const seller = page.locator('address').first();
    await expect(seller).toContainText('Viktor Marchenko');
    await expect(seller).toContainText(`ul. Wojrowicka 48, 54-436 Wrocław, ${country}`);
    await expect(seller).toContainText(`${phone}: +48 515 379 848`);
    await expect(seller.locator('a[href="tel:+48515379848"]')).toBeVisible();
    await expect(seller.locator('a[href="mailto:abawkashop@gmail.com"]')).toBeVisible();
    await expect(seller).not.toContainText('[');
  }
  await page.goto('/en/privacy/');
  // Строки — ті самі, що чистить база (cleanup_personal_data).
  for (const term of ['IP address — 30 days.', 'Requests that did not lead to a purchase — 12 months.', 'Completed purchases — 5 years']) {
    await expect(page.getByText(term)).toBeVisible();
  }
});

test('legal translations: every document exists in every language and keeps all placeholders', () => {
  const vars = (s: string) => [...s.matchAll(/<var>([a-z-]+)<\/var>/g)].map((m) => m[1]).sort().join(',');
  for (const file of readdirSync('src/legal/en')) {
    const source = readFileSync(`src/legal/en/${file}`, 'utf8');
    for (const l of LOCALES.filter((x) => x !== 'en')) {
      const text = readFileSync(`src/legal/${l}/${file}`, 'utf8');
      expect(vars(text), `${l}/${file}`).toBe(vars(source));
      expect(text, `${l}/${file}`).not.toMatch(/\p{L}<a |<\/a>\p{L}/u); // посилання не рвуть слова
    }
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
