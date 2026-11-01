import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { pickCountry } from './helpers/form';

// Підмінена check_promo/submit_request (див. supabase/migrations/…_promotions.sql):
// SAVE10 — мінус 10 %; BIG50 — лише від 50 €; DOWN — мережа впала; інше — немає такого коду.
const submitted: Record<string, unknown>[] = [];
test.beforeEach(async ({ page }) => {
  submitted.length = 0;
  await page.route(/\/rest\/v1\/rpc\/check_promo/, async (route) => {
    const { payload } = route.request().postDataJSON();
    const prices: Record<string, number> = { 'toy-sword': 1999, 'bobo-balloon': 599 };
    const subtotal = payload.lines.reduce((s: number, l: { slug: string; qty: number }) => s + (prices[l.slug] ?? 0) * l.qty, 0);
    const fail = (message: string) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message }) });
    if (payload.promo === 'DOWN') return route.abort('internetdisconnected');
    if (payload.promo === 'BIG50') return subtotal < 5000 ? fail('promo:min:5000') : route.fulfill({ json: { code: 'BIG50', subtotal, discount: 1000, total: subtotal - 1000 } });
    if (payload.promo !== 'SAVE10') return fail('promo:invalid');
    const discount = Math.round(subtotal * 0.1);
    return route.fulfill({ json: { code: 'SAVE10', subtotal, discount, total: subtotal - discount } });
  });
  await page.route(/\/rest\/v1\/rpc\/submit_request/, async (route) => {
    const { payload } = route.request().postDataJSON();
    submitted.push(payload);
    if (payload.promo === 'SAVE10' && payload.comment === 'expired') {
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'promo:invalid' }) });
    }
    return route.fulfill({ json: { id: 1050 } });
  });
});

const openCart = async (page: Page, lines: { slug: string; qty: number }[]) => {
  await page.goto('/en/');
  await page.evaluate((c) => { localStorage.setItem('cart', JSON.stringify(c)); sessionStorage.clear(); }, lines);
  await page.goto('/en/cart/');
};
const summary = (page: Page) => page.locator('.summary');
const fill = async (page: Page) => {
  const form = page.locator('[data-request-form]');
  await form.getByLabel('Name').fill('Anna');
  await form.getByLabel('Phone number').fill('+48 600 000 000');
  await pickCountry(form, /^Country/, 'Poland');
  await form.getByRole('checkbox').check();
  return form;
};

test('promo code: server discount shown in the total, follows quantity changes, sent with the request', async ({ page }) => {
  await openCart(page, [{ slug: 'toy-sword', qty: 2 }]);
  const total = summary(page).locator('[data-sum-total]');
  await expect(total).toHaveText('€39.98');
  await page.getByLabel('Promo code').fill('save10');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(summary(page).getByRole('status')).toHaveText('Code SAVE10 applied.');
  await expect(summary(page).locator('[data-discount-row]')).toHaveText('Discount (SAVE10)−€4.00');
  await expect(total).toHaveText('€35.98');
  await page.locator('[data-line="toy-sword"] [data-inc]').click(); // 3 мечі — сервер перераховує знижку
  await expect(total).toHaveText('€53.97');
  await page.reload(); // код живе до кінця сесії вкладки
  await expect(summary(page).locator('[data-discount-row]')).toBeVisible();

  const form = await fill(page);
  await form.getByRole('button', { name: 'Send request' }).click();
  await expect(page).toHaveURL(/\/en\/thanks\/\?n=1050$/);
  expect(submitted[0]).toMatchObject({ promo: 'SAVE10', lines: [{ slug: 'toy-sword', qty: 3 }] });
  expect(await page.evaluate(() => sessionStorage.getItem('promo'))).toBeNull();
});

test('promo code: wrong code, minimum sum and no connection are explained; removing works', async ({ page }) => {
  await openCart(page, [{ slug: 'bobo-balloon', qty: 1 }]);
  const input = page.getByLabel('Promo code');
  const msg = summary(page).getByRole('status');
  const total = summary(page).locator('[data-sum-total]');
  await input.fill('NOPE');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(msg).toHaveText('This code does not exist or is no longer valid.');
  await input.fill('BIG50');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(msg).toHaveText('This code works for orders from €50.00.');
  await expect(summary(page).locator('[data-discount-row]')).toBeHidden();
  await input.fill('DOWN');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(msg).toHaveText('Could not check the code. Please try again.');
  await expect(total).toHaveText('€5.99');
  await input.fill('SAVE10');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(total).toHaveText('€5.39');
  await page.getByRole('button', { name: 'Remove code' }).click();
  await expect(total).toHaveText('€5.99');
  await expect(input).toHaveValue('');
});

test('promo code expired at the moment of sending: clear message, code removed, form kept', async ({ page }) => {
  await openCart(page, [{ slug: 'toy-sword', qty: 1 }]);
  await page.getByLabel('Promo code').fill('SAVE10');
  await page.getByRole('button', { name: 'Apply' }).click();
  const total = summary(page).locator('[data-sum-total]');
  await expect(total).toHaveText('€17.99');
  const form = await fill(page);
  await form.getByLabel('Comment (optional)').fill('expired');
  await form.getByRole('button', { name: 'Send request' }).click();
  await expect(form.getByRole('alert')).toContainText('The promo code is no longer valid');
  await expect(total).toHaveText('€19.99');
  await expect(form.getByLabel('Name')).toHaveValue('Anna');
});

test('discounted product shows the lowest price of the last 30 days (Omnibus)', async ({ page }) => {
  await page.goto('/en/product/toy-sword/');
  await expect(page.locator('.price-box')).toContainText('Lowest price in the 30 days before the discount: €21.99');
  await page.goto('/en/catalog/swords/');
  await expect(page.locator('article', { hasText: 'Toy sword' }).first()).toContainText('Lowest price in the 30 days before the discount: €21.99');
});
