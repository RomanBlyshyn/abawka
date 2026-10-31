import { expect, test } from '@playwright/test';

const LOCALES = ['pl', 'en', 'uk', 'de', 'cs', 'lt', 'es', 'fr', 'ru'];
const WIDTHS = [320, 375, 768, 1280];

test.describe('layout in every language', () => {
  for (const locale of LOCALES) {
    test(`${locale}: no horizontal overflow, no JS errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/${locale}/`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        expect(overflow, `${locale} at ${width}px`).toBe(0);
      }
      expect(errors).toEqual([]);
    });
  }
});

test('root redirects to the browser language', async ({ browser }) => {
  for (const [lang, expected] of [['uk-UA', '/uk/'], ['de-DE', '/de/'], ['ja-JP', '/pl/']]) {
    const page = await browser.newPage({ locale: lang });
    await page.goto('/');
    await expect(page).toHaveURL(new RegExp(`${expected}$`));
    await page.close();
  }
});

test('page has one h1 and a non-duplicated title', async ({ page }) => {
  await page.goto('/uk/');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page).toHaveTitle('Магазин іграшок · ABAWKA');
});

test('language menu: switches language, closes on Escape', async ({ page }) => {
  await page.goto('/pl/');
  const menu = page.locator('.dd').first();
  await menu.locator('summary').click();
  await page.keyboard.press('Escape');
  await expect(menu).not.toHaveAttribute('open');
  await expect(menu.locator('summary')).toBeFocused();
  await menu.locator('summary').click();
  await page.getByRole('link', { name: 'Deutsch' }).click();
  await expect(page).toHaveURL(/\/de\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
});

test('slider: fast clicks are not lost, wraps around', async ({ page }) => {
  await page.goto('/en/');
  await page.click('[data-next]');
  await page.click('[data-prev]');
  await page.click('[data-prev]');
  await expect(page.locator('[data-dot="2"]')).toHaveAttribute('aria-current', '');
  await expect.poll(() => page.evaluate(() => {
    const t = document.querySelector<HTMLElement>('[data-track]')!;
    return Math.round(t.scrollLeft / t.clientWidth);
  })).toBe(2);
});

test('bestsellers show only products that can be ordered', async ({ page }) => {
  await page.goto('/en/');
  const hits = page.locator('section:has(#hits-h)');
  await expect(hits.locator('.card')).not.toHaveCount(0);
  await expect(hits.getByText('Out of stock')).toHaveCount(0);
});

test('numbers follow the language: rating, price, plural', async ({ page }) => {
  await page.goto('/de/');
  const card = page.locator('.card', { hasText: 'Spielzeugschwert' });
  await expect(card.locator('.rating')).toContainText('4,8');
  await expect(card.locator('.rating')).toContainText('3 Bewertungen');
  await expect(card.locator('.price')).toHaveText(/19,99\s€/);
  await page.goto('/uk/');
  await expect(page.locator('.card', { hasText: 'Капібара' }).locator('.rating')).toContainText(/1 відгук$/);
});

test('badges are readable by screen readers', async ({ page }) => {
  await page.goto('/en/');
  await expect(page.locator('[aria-hidden="true"] .badge')).toHaveCount(0);
  await expect(page.locator('.badge').first()).toBeVisible();
});

test('skip link jumps to main content', async ({ page }) => {
  await page.goto('/en/');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});

test('cart and language controls have accessible names on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/uk/');
  await expect(page.getByRole('link', { name: 'Кошик' })).toBeVisible();
  await expect(page.locator('.dd summary').first()).toHaveAccessibleName(/UK/);
});

test.describe('dark theme', () => {
  test('follows the system before any choice', async ({ browser }) => {
    const page = await browser.newPage({ colorScheme: 'dark' });
    await page.goto('/en/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.close();
  });

  test('toggle switches, is remembered after reload and across languages', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/en/');
    const toggle = page.getByRole('button', { name: 'Dark theme' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(lightBg);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.goto('/uk/');
    await expect(page.getByRole('button', { name: 'Темна тема' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('theme is set before first paint (no white flash)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    // Зупиняємо всі скрипти-модулі: тема має стояти вже від inline-скрипта в <head>.
    await page.route('**/*.js', (route) => route.abort());
    await page.goto('/en/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('no layout overflow in dark mode', async ({ browser }) => {
    const page = await browser.newPage({ colorScheme: 'dark', viewport: { width: 320, height: 800 } });
    await page.goto('/ru/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.close();
  });
});

test('currency switch stays hidden until prices can be converted', async ({ page }) => {
  await page.goto('/en/');
  await expect(page.locator('[data-currency-label]')).toHaveCount(0);
});
