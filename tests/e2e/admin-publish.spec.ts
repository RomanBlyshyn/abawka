import { expect, test } from './fixtures';
import { mockAdmin, sampleDb } from './helpers/supabase-mock';

test.describe('admin: update the live site', () => {
  test('button starts a rebuild and says when changes appear', async ({ page }) => {
    await mockAdmin(page, sampleDb());
    let calls = 0;
    await page.route(/\/functions\/v1\/publish/, (r) => { calls++; return r.fulfill({ json: calls === 1 ? { ok: true } : { ok: true, throttled: true } }); });
    await page.goto('/admin/products/');
    await page.getByRole('button', { name: 'Оновити сайт' }).click();
    await expect(page.locator('[data-publish-msg]')).toHaveText('Сайт оновлюється ✓ Зміни з’являться за 1–2 хвилини.');
    await page.getByRole('button', { name: 'Оновити сайт' }).click();
    await expect(page.locator('[data-publish-msg]')).toHaveText('Оновлення вже запущене щойно — зачекайте 1–2 хвилини.');
  });

  test('before hosting is connected: clear message instead of an error', async ({ page }) => {
    await mockAdmin(page, sampleDb());
    await page.route(/\/functions\/v1\/publish/, (r) => r.fulfill({ status: 503, json: { error: 'not configured' } }));
    await page.goto('/admin/');
    await page.getByRole('button', { name: 'Оновити сайт' }).click();
    await expect(page.locator('[data-publish-msg]')).toHaveText('Сайт ще не підключено до хостингу — оновлення запрацює після запуску.');
  });
});

test('admin header fits every screen: all sections, «Оновити сайт» and «Вийти» visible', async ({ page }) => {
  await mockAdmin(page, sampleDb());
  for (const width of [375, 768, 1024, 1180, 1280, 1366, 1600]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/admin/requests/');
    await expect(page.getByRole('button', { name: 'Вийти' })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Оновити сайт' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${width}px`).toBe(0);
  }
});
