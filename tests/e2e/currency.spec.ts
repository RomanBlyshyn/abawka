import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { parseEcb, parseNbuEur } from '../../supabase/functions/rates/parse';

const today = new Date().toISOString().slice(0, 10);
const RATES = [
  { currency: 'EUR', per_eur: 1, rate_date: today, source: 'fixed' },
  { currency: 'PLN', per_eur: 4.4038, rate_date: today, source: 'ECB' },
  { currency: 'USD', per_eur: 1.1172, rate_date: today, source: 'ECB' },
  { currency: 'UAH', per_eur: 50.6843, rate_date: today, source: 'NBU' },
];
const withRates = (page: Page, rows: unknown[] = RATES) =>
  page.route(/\/rest\/v1\/exchange_rates/, (r) => r.fulfill({ json: rows }));
const pick = async (page: Page, currency: string) => {
  await page.locator('[data-currency-switch] summary').click();
  await page.getByRole('button', { name: currency, exact: true }).click();
};

test('currency: prices are converted everywhere and the choice is remembered', async ({ page }) => {
  await withRates(page);
  await page.goto('/en/product/toy-sword/');
  const box = page.locator('.price-box');
  await expect(box.locator('.price')).toHaveText('€19.99');
  await pick(page, 'PLN');
  await expect(box.locator('.price')).toHaveText('PLN 88.03'); // 1999 × 4.4038 = 8803 гроші
  await expect(box.locator('.old')).toContainText('PLN 110.05');
  await expect(box).toContainText('Lowest price in the 30 days before the discount: PLN 96.84');
  await expect(box.locator('[data-currency-note]')).toHaveText(`Prices in PLN are approximate: ECB rate of ${new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(today))}. Requests are calculated in EUR.`);

  await page.goto('/en/');
  await page.evaluate(() => localStorage.setItem('cart', JSON.stringify([{ slug: 'toy-sword', qty: 2 }])));
  await page.goto('/en/cart/');
  await expect(page.locator('[data-sum-total]')).toHaveText('PLN 176.06');
  await expect(page.locator('.summary [data-currency-note]')).toBeVisible();
  await pick(page, 'UAH');
  await expect(page.locator('[data-sum-total]')).toHaveText('UAH 2,026.36'); // 3998 × 50.6843
  await pick(page, 'EUR');
  await expect(page.locator('[data-sum-total]')).toHaveText('€39.98');
  await expect(page.locator('.summary [data-currency-note]')).toBeHidden();
});

test('currency: without fresh rates the switch stays hidden and prices stay in EUR', async ({ page }) => {
  await withRates(page, [RATES[0], { ...RATES[1], rate_date: '2026-01-01' }]);
  await page.addInitScript(() => localStorage.setItem('currency', 'PLN'));
  await page.goto('/en/product/toy-sword/');
  await expect(page.locator('.price-box .price')).toHaveText('€19.99');
  await expect(page.locator('[data-currency-switch]')).toBeHidden();
});

test('rates: ECB and NBU responses are parsed', () => {
  const ecb = `<gesmes:Envelope><Cube><Cube time='2026-10-30'>
    <Cube currency='USD' rate='1.1172'/><Cube currency='JPY' rate='175.68'/><Cube currency='PLN' rate='4.4038'/>
  </Cube></Cube></gesmes:Envelope>`;
  expect(parseEcb(ecb, ['PLN', 'USD'])).toEqual([
    { currency: 'USD', per_eur: 1.1172, source: 'ECB', rate_date: '2026-10-30' },
    { currency: 'PLN', per_eur: 4.4038, source: 'ECB', rate_date: '2026-10-30' },
  ]);
  expect(parseNbuEur([{ r030: 978, txt: 'Євро', rate: 50.6843, cc: 'EUR', exchangedate: '02.11.2026' }]))
    .toEqual({ currency: 'UAH', per_eur: 50.6843, source: 'NBU', rate_date: '2026-11-02' });
  expect(() => parseEcb('<html>maintenance</html>', ['PLN'])).toThrow();
  expect(() => parseNbuEur({ error: 'x' })).toThrow();
});
