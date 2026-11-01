import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

const visibleNames = (page: Page) => page.locator('[data-item]:not([hidden]) .name').allInnerTexts();

test.describe('catalog filters', () => {
  test('shows all 7 products, out-of-stock last', async ({ page }) => {
    await page.goto('/en/catalog/');
    await expect(page.locator('[data-found]')).toHaveText('Found: 7 items');
    const names = await visibleNames(page);
    expect(names.at(-1)).toContain('rabbit');
  });

  test('age link from home page filters, empty state, reset', async ({ page }) => {
    await page.goto('/en/');
    await page.locator('.age', { hasText: '0–2' }).click();
    await expect(page).toHaveURL(/catalog\/\?age=0-2$/);
    await expect(page.locator('[data-empty]')).toBeVisible();
    await expect(page.locator('[data-found]')).toHaveText('Found: 0 items');
    await page.locator('[data-empty] [data-reset]').click();
    await expect(page.locator('[data-found]')).toHaveText('Found: 7 items');
    await expect(page).toHaveURL(/catalog\/$/);
  });

  test('age 6–8 includes toys from age 3 and 6', async ({ page }) => {
    await page.goto('/en/catalog/?age=6-8');
    await expect(page.locator('[data-found]')).toHaveText('Found: 7 items');
    await page.goto('/en/catalog/?age=3-5');
    const names = await visibleNames(page);
    expect(names).not.toContain('Chess set');
    expect(names).not.toContain('Slingshot helicopter');
  });

  test('sale link from slider shows only discounted', async ({ page }) => {
    await page.goto('/en/catalog/?sale=1');
    expect((await visibleNames(page)).sort()).toEqual(['Slingshot helicopter', 'Toy sword']);
  });

  test('price range and in-stock filter update URL', async ({ page }) => {
    await page.goto('/en/catalog/');
    await page.fill('input[name=max]', '10');
    expect((await visibleNames(page)).sort()).toEqual(['Bobo balloon', 'Slingshot helicopter']);
    await page.fill('input[name=max]', '');
    await page.check('input[name=stock]');
    expect(await visibleNames(page)).not.toContain('Walking rabbit (battery)');
    await expect(page).toHaveURL(/\?stock=1$/);
  });

  test('sort by price ascending', async ({ page }) => {
    await page.goto('/en/catalog/');
    await page.selectOption('[data-sort]', 'price-asc');
    const names = await visibleNames(page);
    expect(names[0]).toBe('Bobo balloon');
    await expect(page).toHaveURL(/sort=price-asc/);
  });

  test('search works across languages and without diacritics', async ({ page }) => {
    await page.goto('/uk/');
    await page.fill('#q', 'kapibara');
    await page.press('#q', 'Enter');
    await expect(page).toHaveURL(/\/uk\/catalog\/\?q=kapibara/);
    // poll: фільтр застосовує скрипт сторінки вже після переходу
    await expect.poll(() => visibleNames(page)).toEqual(['Капібара, що ходить, на батарейках']);
    await expect(page.locator('[data-search-line]')).toContainText('kapibara');
    await expect(page.locator('#q')).toHaveValue('kapibara');
    await page.goto('/cs/catalog/?q=mec');
    await expect.poll(async () => (await visibleNames(page)).length).toBe(2); // «Meč» без háčku
  });

  test('category page lists only its products and marks itself', async ({ page }) => {
    await page.goto('/en/catalog/swords/');
    await expect(page.locator('h1')).toHaveText('Swords');
    expect((await visibleNames(page)).sort()).toEqual(['Knight sword', 'Toy sword']);
    await expect(page.locator('.cat-list [aria-current=page]')).toHaveText(/Swords/);
  });

  test('mobile: filters open from button and close on show results', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/en/catalog/');
    const panel = page.locator('[data-filters-panel]');
    await expect(panel).toBeHidden();
    await page.getByRole('button', { name: 'Filters' }).click();
    await expect(panel).toBeVisible();
    await page.getByText('On sale only').click();
    await expect(page.locator('[data-active-count]')).toHaveText('1');
    await page.getByRole('button', { name: 'Show results' }).click();
    await expect(panel).toBeHidden();
    expect((await visibleNames(page)).length).toBe(2);
  });
});

test.describe('product page and cart button', () => {
  test('quantity stepper stays within 1..stock', async ({ page }) => {
    await page.goto('/en/product/chess/'); // stock 4
    const qty = page.locator('#qty');
    await page.getByRole('button', { name: 'Decrease' }).click();
    await expect(qty).toHaveValue('1');
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Increase' }).click();
    await expect(qty).toHaveValue('4');
    await qty.fill('50');
    await qty.blur();
    await expect(qty).toHaveValue('4');
  });

  test('add to cart: header count, toast, persists, never above stock', async ({ page }) => {
    await page.goto('/en/product/chess/');
    await page.locator('#qty').fill('3');
    await page.locator('.info [data-add-to-cart]').click();
    await expect(page.locator('[data-cart-count]')).toHaveText('3');
    await expect(page.locator('[data-toast]')).toBeVisible();
    await page.locator('.info [data-add-to-cart]').click(); // ще 3, але на складі лише 4
    await expect(page.locator('[data-cart-count]')).toHaveText('4');
    await page.goto('/de/');
    await expect(page.locator('[data-cart-count]')).toHaveText('4');
  });

  test('card button adds one item', async ({ page }) => {
    await page.goto('/en/catalog/');
    await page.getByRole('button', { name: 'Add to cart: Bobo balloon' }).click();
    await expect(page.locator('[data-cart-count]')).toHaveText('1');
  });

  test('out-of-stock product has no buy buttons', async ({ page }) => {
    await page.goto('/en/product/walking-rabbit/');
    await expect(page.locator('.info [data-add-to-cart]')).toHaveCount(0);
    await expect(page.locator('.stock')).toHaveText('Out of stock');
  });

  test('related products exclude itself and out-of-stock', async ({ page }) => {
    await page.goto('/en/product/walking-capybara/');
    const related = await page.locator('section:has(#rel-h) .name').allInnerTexts();
    expect(related).not.toContain('Walking capybara (battery)');
    expect(related).not.toContain('Walking rabbit (battery)');
    expect(related.length).toBeGreaterThan(0);
  });

  test('breadcrumbs link back to category', async ({ page }) => {
    await page.goto('/uk/product/toy-sword/');
    await page.locator('.crumbs').getByRole('link', { name: 'Мечі' }).click();
    await expect(page).toHaveURL(/\/uk\/catalog\/swords\/$/);
  });
});

test('catalog and product pages: no overflow or errors in any language', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const locale of ['pl', 'en', 'uk', 'de', 'cs', 'lt', 'es', 'fr', 'ru']) {
    for (const path of ['catalog/', 'catalog/interactive/', 'product/walking-capybara/']) {
      for (const width of [320, 768, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/${locale}/${path}`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        expect(overflow, `${locale}/${path} at ${width}px`).toBe(0);
      }
    }
  }
  expect(errors).toEqual([]);
});

test.describe('photos and description from the admin', () => {
  // Сховище Supabase у тестах підміняємо крихітною картинкою: перевіряємо розмітку, а не мережу.
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  test.beforeEach(async ({ page }) => {
    await page.route('**/storage/v1/object/public/catalog/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  });

  test('card shows the first photo; products without photos keep the placeholder', async ({ page }) => {
    await page.goto('/en/catalog/');
    const sword = page.locator('.card', { hasText: 'Toy sword' });
    await expect(sword.locator('img.photo')).toHaveAttribute('src', /a1-400\.webp$/);
    await expect(page.locator('.card', { hasText: 'Chess set' }).locator('.ph')).toBeVisible();
  });

  test('product gallery switches photos; description keeps line breaks', async ({ page }) => {
    await page.goto('/en/product/toy-sword/');
    const main = page.locator('[data-main-photo]');
    await expect(main).toHaveAttribute('src', /a1-800\.webp$/);
    await page.locator('[data-thumb]').nth(1).click();
    await expect(main).toHaveAttribute('src', /a2-800\.webp$/);
    await expect(main).toHaveAttribute('srcset', /a2-1600\.webp 1600w/);
    await expect(page.locator('[data-thumb]').nth(1)).toHaveAttribute('aria-current', '');
    await expect(page.locator('.desc')).toHaveText('A light foam sword.\nSafe to play with.');
    await page.goto('/en/product/chess/');
    await expect(page.locator('.thumbs')).toHaveCount(0);
    await expect(page.getByText('Description coming soon.')).toBeVisible();
  });

  test('cart thumbnail uses the photo', async ({ page }) => {
    await page.goto('/en/');
    await page.evaluate(() => localStorage.setItem('cart', JSON.stringify([{ slug: 'toy-sword', qty: 1 }])));
    await page.goto('/en/cart/');
    await expect(page.locator('[data-line="toy-sword"] .thumb img')).toHaveAttribute('src', /a1-400\.webp$/);
  });
});
