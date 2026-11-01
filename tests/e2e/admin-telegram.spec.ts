import { expect, test } from './fixtures';
import { mockAdmin, sampleDb } from './helpers/supabase-mock';

test.describe('admin: Telegram notifications', () => {
  test('connect: link to the bot, then the page notices Start by itself', async ({ page }) => {
    const db = sampleDb();
    await mockAdmin(page, db);
    await page.goto('/admin/');
    const box = page.getByRole('region', { name: 'Сповіщення в Telegram' });
    await expect(box).toContainText('Нові заявки можуть приходити');
    await box.getByRole('button', { name: 'Підключити Telegram' }).click();
    const open = box.getByRole('link', { name: 'Відкрити бота ↗' });
    await expect(open).toHaveAttribute('href', /^https:\/\/t\.me\/abawka_test_bot\?start=[a-f0-9]{32}$/);
    await expect(open).toHaveAttribute('target', '_blank');
    db.telegram.chatId = 555; // людина натиснула Start у боті
    await expect(box).toContainText('✅ Підключено', { timeout: 6000 });
    await box.getByRole('button', { name: 'Надіслати перевірку' }).click();
    await expect(box.getByRole('status')).toHaveText('Надіслано — перевірте Telegram.');
    expect(db.telegram.actions).toEqual(['link', 'test']);
  });

  test('connected: disconnect asks first', async ({ page }) => {
    const db = sampleDb();
    db.telegram.chatId = 555;
    await mockAdmin(page, db);
    await page.goto('/admin/');
    const box = page.getByRole('region', { name: 'Сповіщення в Telegram' });
    await expect(box).toContainText('✅ Підключено');
    page.once('dialog', (d) => d.dismiss());
    await box.getByRole('button', { name: 'Відключити' }).click();
    expect(db.telegram.actions).toEqual([]);
    page.once('dialog', (d) => d.accept());
    await box.getByRole('button', { name: 'Відключити' }).click();
    await expect(box.getByRole('status')).toHaveText('Сповіщення відключено.');
    await expect(box.getByRole('button', { name: 'Підключити Telegram' })).toBeVisible();
  });

  test('bot unavailable: clear message, can try again', async ({ page }) => {
    const db = sampleDb();
    await mockAdmin(page, db, { telegram: 'fail' });
    await page.goto('/admin/');
    const box = page.getByRole('region', { name: 'Сповіщення в Telegram' });
    await box.getByRole('button', { name: 'Підключити Telegram' }).click();
    await expect(box.getByRole('status')).toHaveText('Не вдалося отримати посилання. Спробуйте ще раз за хвилину.');
    await expect(box.getByRole('button', { name: 'Підключити Telegram' })).toBeEnabled();
  });
});
