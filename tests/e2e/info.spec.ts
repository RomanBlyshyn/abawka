import { expect, test } from './fixtures';

const LOCALES = ['pl', 'en', 'uk', 'de', 'cs', 'lt', 'es', 'fr', 'ru'];

test('every footer link in every language opens a real page (no 404)', async ({ page }) => {
  for (const locale of LOCALES) {
    await page.goto(`/${locale}/`);
    const links = await page.locator('footer a[href^="/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
    expect(links.length, locale).toBeGreaterThan(5);
    for (const href of links) expect((await page.request.get(href)).status(), `${locale}: ${href}`).toBe(200);
  }
});

test('how to order: steps use the real button name and reply hours', async ({ page }) => {
  await page.goto('/en/how-to-order/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('How to order');
  await expect(page.locator('.steps li')).toHaveCount(4);
  await expect(page.locator('.steps')).toContainText('use “Quick order” on the product page'); // та сама назва, що на кнопці
  await expect(page.locator('.steps')).toContainText('during 10:00–18:00 (Warsaw time)');
});

test('delivery and contacts: what is agreed personally, seller address, email and phone from the owner', async ({ page }) => {
  await page.goto('/uk/delivery/');
  await expect(page.locator('.info')).toContainText('Спосіб і вартість доставки власник узгоджує з вами особисто');
  await page.getByRole('link', { name: 'Як повернути товар' }).click();
  await expect(page).toHaveURL(/\/uk\/returns\/$/);
  await page.goto('/uk/contacts/');
  const seller = page.locator('address');
  await expect(seller).toContainText('Viktor Marchenko');
  await expect(seller).toContainText('ul. Wojrowicka 48, 54-436 Wrocław, Польща');
  await expect(seller.getByRole('link', { name: 'abawkashop@gmail.com' })).toHaveAttribute('href', 'mailto:abawkashop@gmail.com');
  await expect(seller.getByRole('link', { name: '+48 515 379 848' })).toHaveAttribute('href', 'tel:+48515379848');
});

test('info pages: no overflow or errors in any language', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 320, height: 800 });
  for (const locale of LOCALES) for (const p of ['how-to-order/', 'delivery/', 'contacts/']) {
    await page.goto(`/${locale}/${p}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${locale}/${p}`).toBe(0);
  }
  expect(errors).toEqual([]);
});
