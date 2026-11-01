import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { mockAdmin, sampleDb } from './helpers/supabase-mock';

// Підмінена submit_review: ім'я «Busy» → ліміт частоти; «Offline» → немає мережі; інакше ok.
const sent: Record<string, unknown>[] = [];
const mockSubmit = (page: Page) => page.route(/\/rest\/v1\/rpc\/submit_review/, (route) => {
  const { payload } = route.request().postDataJSON();
  sent.push(payload);
  if (payload.name === 'Offline') return route.abort('internetdisconnected');
  if (payload.name === 'Busy') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'rate_limited' }) });
  return route.fulfill({ json: { ok: true } });
});
test.beforeEach(() => { sent.length = 0; });

test.describe('review form (no accounts)', () => {
  test('home: review about the shop is checked in the browser, sent, and the buyer is told it awaits moderation', async ({ page }) => {
    await mockSubmit(page);
    await page.goto('/uk/');
    await page.locator('#reviews').getByRole('button', { name: 'Залишити відгук' }).click();
    const dlg = page.getByRole('dialog', { name: 'Ваш відгук' });
    await dlg.getByRole('button', { name: 'Надіслати відгук' }).click();
    await expect(dlg.getByText('Вкажіть ім’я (2–40 символів).')).toBeVisible();
    await expect(dlg.getByText('Поставте оцінку.')).toBeVisible();
    await expect(dlg.getByText('Потрібна ваша згода на публікацію.')).toBeVisible();
    expect(sent).toHaveLength(0);

    await dlg.getByLabel('Про що відгук').selectOption({ label: 'Про магазин загалом' });
    await dlg.getByLabel('Ваше ім’я').fill('Олена');
    await dlg.getByRole('radio', { name: '4 з 5' }).check();
    await dlg.getByLabel('Відгук', { exact: true }).fill('Швидко відповіли й усе пояснили.');
    await dlg.getByRole('checkbox').check();
    await dlg.getByRole('button', { name: 'Надіслати відгук' }).click();
    await expect(dlg.getByRole('status')).toHaveText('Дякуємо! Відгук з’явиться на сайті після перевірки.');
    expect(sent[0]).toEqual({ product: '', name: 'Олена', rating: 4, text: 'Швидко відповіли й усе пояснили.', consent: true, website: '', locale: 'uk' });
  });

  test('product page: review is about this product; errors keep what was typed', async ({ page }) => {
    await mockSubmit(page);
    await page.goto('/en/product/toy-sword/');
    await page.locator('#reviews').getByRole('button', { name: 'Write a review' }).click();
    const dlg = page.getByRole('dialog', { name: 'Your review' });
    await expect(dlg.getByLabel('What is it about')).toHaveCount(0); // товар уже відомий
    await dlg.getByLabel('Your name').fill('Offline');
    await dlg.getByRole('radio', { name: '5 of 5' }).check();
    await dlg.getByLabel('Review', { exact: true }).fill('Great sword, my son loves it.');
    await dlg.getByRole('checkbox').check();
    await dlg.getByRole('button', { name: 'Send review' }).click();
    await expect(dlg.getByRole('alert')).toHaveText('Not sent. Please try again — what you typed is kept.');
    await expect(dlg.getByLabel('Review', { exact: true })).toHaveValue('Great sword, my son loves it.');
    await dlg.getByLabel('Your name').fill('Busy');
    await dlg.getByRole('button', { name: 'Send review' }).click();
    await expect(dlg.getByRole('alert')).toHaveText('Too many reviews in a row. Please try again in a few minutes.');
    expect(sent.at(-1)).toMatchObject({ product: 'toy-sword', rating: 5 });
  });

  test('home shows published reviews at the bottom', async ({ page }) => {
    await page.goto('/en/');
    await expect(page.locator('#reviews .review').first()).toBeVisible(); // тестові відгуки з fixture
  });
});

test.describe('admin: reviews moderation', () => {
  test('pending review can be published, hidden and deleted', async ({ page }) => {
    const db = sampleDb();
    db.reviews.push(
      { id: 'r1', author: 'Olena', rating: 5, body: { uk: 'Супер меч!' }, locale: 'uk', approved: false, created_at: '2026-11-01T10:00:00Z', product_id: 'p-sword' },
      { id: 'r2', author: 'Jan', rating: 3, body: { pl: 'Dobry sklep' }, locale: 'pl', approved: true, created_at: '2026-10-20T10:00:00Z', product_id: null },
    );
    await mockAdmin(page, db, { role: 'manager' }); // модерують і менеджери
    await page.goto('/admin/reviews/');
    const row = page.locator('[data-review-id="r1"]');
    await expect(row).toContainText('★★★★★Olena');
    await expect(row).toContainText('Іграшковий меч');
    await expect(row).toContainText('Супер меч!');
    await expect(page.locator('[data-tab-count="pending"]')).toHaveText('(1)');
    await row.getByRole('button', { name: 'Опублікувати: Olena' }).click();
    await expect(page.locator('[data-msg]')).toHaveText('Відгук від Olena опубліковано ✓');
    expect(db.reviews.find((r) => r.id === 'r1')!.approved).toBe(true);
    await expect(page.locator('[data-state="empty"]')).toBeVisible();

    await page.getByRole('tab', { name: /Опубліковані/ }).click();
    await expect(page.locator('[data-review-id="r2"]')).toContainText('про магазин');
    await page.getByRole('button', { name: 'Сховати: Jan' }).click();
    expect(db.reviews.find((r) => r.id === 'r2')!.approved).toBe(false);
    await page.getByRole('tab', { name: /На перевірці/ }).click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Видалити: Jan' }).click();
    await expect(page.locator('[data-msg]')).toHaveText('Відгук видалено.');
    expect(db.reviews.map((r) => r.id)).toEqual(['r1']);
  });
});
