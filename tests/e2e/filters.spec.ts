// Фільтри каталогу: перевіряємо те, що бачить людина (видимість карток), а не атрибути.
// Тестові товари (tests/fixtures/seed.json), ціни в €:
//   toy-sword 19.99 (знижка, 3+), knight-sword 24.99 (3+), walking-capybara 29.99 (3+),
//   walking-rabbit 27.99 (3+, немає в наявності), slingshot-helicopter 8.99 (знижка, 6+), bobo-balloon 5.99 (3+), chess 34.99 (6+)
import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

type Card = { slug: string; price: number; age: number; stock: number; sale: boolean; visible: boolean };
const AGE_MAX: Record<string, number> = { '0-2': 2, '3-5': 5, '6-8': 8, '9-99': 99 };

async function cards(page: Page): Promise<Card[]> {
  const items = page.locator('[data-item]');
  const out: Card[] = [];
  for (let i = 0; i < await items.count(); i++) {
    const it = items.nth(i);
    const d = await it.evaluate((el) => ({ ...(el as HTMLElement).dataset }));
    const slug = (await it.locator('a[href*="/product/"]').first().getAttribute('href'))!.split('/product/')[1]!.replace(/\/$/, '');
    out.push({ slug, price: Number(d.price) / 100, age: Number(d.age), stock: Number(d.stock), sale: d.sale === '1', visible: await it.isVisible() });
  }
  return out;
}

/** «Знайдено: N» = видимі картки, і кожна картка видима тоді й лише тоді, коли проходить фільтр. */
async function expectConsistent(page: Page, f: { ages?: string[]; min?: number; max?: number; stock?: boolean; sale?: boolean }) {
  const lo = f.min !== undefined && f.max !== undefined ? Math.min(f.min, f.max) : f.min;
  const hi = f.min !== undefined && f.max !== undefined ? Math.max(f.min, f.max) : f.max;
  const pass = (c: Card) =>
    (!f.ages?.length || f.ages.some((a) => c.age <= AGE_MAX[a]!)) &&
    (lo === undefined || c.price >= lo) && (hi === undefined || c.price <= hi) &&
    (!f.stock || c.stock > 0) && (!f.sale || c.sale);
  await expect.poll(async () => {
    const list = await cards(page);
    const wrong = list.filter((c) => c.visible !== pass(c)).map((c) => `${c.slug}:${c.visible ? 'видно' : 'сховано'}`);
    const shown = list.filter((c) => c.visible).length;
    const found = Number((await page.locator('[data-found]').textContent())!.match(/\d+/)![0]);
    return { wrong, foundMatchesVisible: found === shown };
  }, { message: JSON.stringify(f) }).toEqual({ wrong: [], foundMatchesVisible: true });
}

test.describe('catalog filters — what the buyer actually sees', () => {
  test('price range from the client report: min 30, max 40 shows only chess', async ({ page }) => {
    await page.goto('/en/catalog/');
    await page.getByLabel('Price from').fill('30');
    await page.getByLabel('Price to').fill('40');
    await expectConsistent(page, { min: 30, max: 40 });
    await expect(page.locator('[data-item]').filter({ visible: true })).toHaveCount(1);
    await expect(page.locator('[data-item]').filter({ visible: true })).toContainText('Chess');
  });

  test('every single filter and combinations keep the count and the cards in sync', async ({ page }) => {
    const combos: { ages?: string[]; min?: number; max?: number; stock?: boolean; sale?: boolean }[] = [
      { ages: ['0-2'] }, { ages: ['3-5'] }, { ages: ['6-8'] }, { ages: ['9-99'] }, { ages: ['0-2', '6-8'] },
      { min: 20 }, { max: 10 }, { min: 9, max: 25 }, { min: 40, max: 9 }, { min: 19.99, max: 19.99 }, { min: 1000 },
      { stock: true }, { sale: true }, { sale: true, stock: true },
      { ages: ['3-5'], max: 25, stock: true }, { ages: ['6-8'], sale: true }, { min: 27, max: 30, stock: true },
    ];
    for (const f of combos) {
      const qs = new URLSearchParams();
      if (f.ages) qs.set('age', f.ages.join(','));
      if (f.min !== undefined) qs.set('min', String(f.min));
      if (f.max !== undefined) qs.set('max', String(f.max));
      if (f.stock) qs.set('stock', '1');
      if (f.sale) qs.set('sale', '1');
      await page.goto(`/en/catalog/?${qs}`);
      await expectConsistent(page, f);
    }
  });

  test('nothing matches: friendly empty state, reset brings everything back', async ({ page }) => {
    await page.goto('/en/catalog/?min=1000');
    await expect(page.getByRole('heading', { name: 'Nothing found' })).toBeVisible();
    await expect(page.locator('[data-item]').filter({ visible: true })).toHaveCount(0);
    await page.locator('[data-empty]').getByRole('button').click();
    await expect(page.locator('[data-item]').filter({ visible: true })).toHaveCount(7);
    await expect(page).toHaveURL(/\/en\/catalog\/$/);
  });

  test('ticking boxes works live and survives a reload through the address', async ({ page }) => {
    await page.goto('/en/catalog/');
    await page.getByLabel('On sale only').check();
    await page.getByLabel('In stock only').check();
    await expectConsistent(page, { sale: true, stock: true });
    await page.reload();
    await expect(page.getByLabel('On sale only')).toBeChecked();
    await expectConsistent(page, { sale: true, stock: true });
  });

  test('category page filters only its own products', async ({ page }) => {
    await page.goto('/en/catalog/interactive/?stock=1');
    await expect(page.locator('[data-item]').filter({ visible: true })).toHaveCount(1); // кролика немає в наявності
    await expect(page.locator('[data-found]')).toHaveText('Found: 1 item');
  });

  test('search and filters together', async ({ page }) => {
    await page.goto('/en/catalog/?q=sword&max=22');
    await expect(page.locator('[data-item]').filter({ visible: true })).toHaveCount(1);
    await expect(page.locator('[data-item]').filter({ visible: true })).toContainText('Toy sword');
  });

  test('sorting by price works on what is visible; out of stock stays last', async ({ page }) => {
    await page.goto('/en/catalog/?sort=price-asc');
    const prices = async () => page.locator('[data-item]').filter({ visible: true }).evaluateAll((els) => els.map((e) => [Number((e as HTMLElement).dataset.price), Number((e as HTMLElement).dataset.stock)]));
    let list = await prices();
    const inStock = list.filter(([, s]) => s > 0).map(([p]) => p);
    expect(inStock).toEqual([...inStock].sort((a, b) => a - b));
    expect(list.at(-1)![1]).toBe(0);
    await page.getByLabel('Sort by').selectOption('price-desc');
    list = await prices();
    const desc = list.filter(([, s]) => s > 0).map(([p]) => p);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
  });

  test('price filter uses the currency shown on the cards', async ({ page }) => {
    const today = new Date().toISOString().slice(0, 10);
    await page.route(/\/rest\/v1\/exchange_rates/, (r) => r.fulfill({ json: [
      { currency: 'EUR', per_eur: 1, rate_date: today, source: 'fixed' },
      { currency: 'PLN', per_eur: 4.4, rate_date: today, source: 'ECB' },
    ] }));
    await page.addInitScript(() => localStorage.setItem('currency', 'PLN'));
    await page.goto('/en/catalog/');
    await expect(page.locator('fieldset legend').filter({ hasText: 'Price' })).toContainText('PLN');
    // 100–120 zł ≈ 22.7–27.3 € → лише Knight sword (24.99 € = 109.96 zł); кролик 27.99 € = 123.16 zł — поза діапазоном.
    await page.getByLabel('Price from').fill('100');
    await page.getByLabel('Price to').fill('120');
    await expect(page.locator('[data-item]').filter({ visible: true })).toHaveCount(1);
    await expect(page.locator('[data-item]').filter({ visible: true })).toContainText('Knight sword');
  });
});

test('search from the header: only matching cards are on screen (client report: "sword")', async ({ page }) => {
  await page.goto('/en/');
  await page.locator('#q').fill('sword');
  await page.locator('#q').press('Enter');
  await expect(page.locator('[data-found]')).toHaveText('Found: 2 items');
  const visible = page.locator('[data-item]').filter({ visible: true });
  await expect(visible).toHaveCount(2);
  await expect(visible.nth(0)).toContainText('sword');
  await expect(visible.nth(1)).toContainText('sword');
  await page.getByRole('link', { name: /Clear search/ }).click();
  await expect(page.locator('[data-item]').filter({ visible: true })).toHaveCount(7);
});
