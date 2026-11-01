import { expect, test } from './fixtures';
import { mockAdmin, sampleDb } from './helpers/supabase-mock';

test.describe('admin: promotions', () => {
  test('sale: pick a category, start −20 %, then end it', async ({ page }) => {
    const db = sampleDb();
    db.products[0]!.old_price = null; // меч без знижки
    await mockAdmin(page, db);
    await page.goto('/admin/promotions/');
    await expect(page.getByRole('navigation', { name: 'Розділи адмінки' }).getByRole('link', { name: 'Акції' })).toBeVisible();
    const msg = page.locator('[data-sale-msg]');

    await page.getByRole('button', { name: 'Запустити знижку' }).click();
    await expect(msg).toHaveText('Спершу виберіть товари.');
    await page.getByLabel('Вибрати всю категорію').selectOption({ label: 'Мечі' });
    await expect(page.getByRole('checkbox', { name: /Іграшковий меч/ })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /Шахи/ })).not.toBeChecked();
    await page.getByLabel('Знижка, %').fill('95');
    await page.getByRole('button', { name: 'Запустити знижку' }).click();
    await expect(msg).toHaveText('Знижка — ціле число від 1 до 90 %.');
    await page.getByLabel('Знижка, %').fill('20');
    await page.getByRole('button', { name: 'Запустити знижку' }).click();
    await expect(msg).toHaveText('Знижку −20% запущено: 1 товар ✓');
    expect(db.products[0]).toMatchObject({ price: 1599, old_price: 1999 });
    const sword = page.locator('li', { has: page.getByRole('checkbox', { name: /Іграшковий меч/ }) });
    await expect(sword).toContainText('19.99 EUR 15.99 EUR −20%');

    await page.getByRole('checkbox', { name: /Іграшковий меч/ }).check();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Завершити знижку' }).click();
    await expect(msg).toHaveText('Знижку завершено: 1 товар ✓');
    expect(db.products[0]).toMatchObject({ price: 1999, old_price: null });
  });

  test('promo codes: create with checks, switch off, delete an unused one', async ({ page }) => {
    const db = sampleDb();
    db.promo_codes.push({ code: 'SPRING', kind: 'amount', value: 500, min_total: 3000, starts_at: null, ends_at: '2026-06-01T00:00:00Z', max_uses: 10, used: 10, active: true });
    await mockAdmin(page, db);
    await page.goto('/admin/promotions/');
    const spring = page.locator('[data-promo="SPRING"]');
    await expect(spring).toContainText('−5.00 EUR · від 30.00 EUR · до 31 трав. 2026 р. включно · використано 10 з 10 · вже не діє');
    await expect(spring.getByRole('button', { name: 'Видалити: SPRING' })).toHaveCount(0); // уже використаний — лише вимкнути

    await page.getByRole('button', { name: '+ Новий промокод' }).click();
    const dlg = page.getByRole('dialog', { name: 'Новий промокод' });
    await dlg.getByLabel('Код').fill('summer 10');
    await expect(dlg.getByLabel('Код')).toHaveValue('SUMMER10');
    await dlg.getByLabel('Скільки відсотків (1–90)').fill('150');
    await dlg.getByRole('button', { name: 'Створити промокод' }).click();
    await expect(dlg.getByRole('alert')).toHaveText('Знижка у відсотках — ціле число від 1 до 90.');
    await dlg.getByLabel('Скільки відсотків (1–90)').fill('10');
    await dlg.getByLabel('Діє до, включно (необов\'язково)').fill('2026-12-31');
    await dlg.getByLabel('Скільки разів можна використати (необов\'язково)').fill('100');
    await dlg.getByRole('button', { name: 'Створити промокод' }).click();
    await expect(page.locator('[data-promo-msg]')).toHaveText('Промокод SUMMER10 створено ✓');
    const post = db.requests.find((r) => r.method === 'POST')!.body as Record<string, unknown>;
    expect(post).toMatchObject({ code: 'SUMMER10', kind: 'percent', value: 10, min_total: 0, starts_at: null, max_uses: 100 });
    expect(new Date(post.ends_at as string).getDate()).toBe(1); // «до 31 грудня включно» = до початку 1 січня

    await page.getByRole('button', { name: '+ Новий промокод' }).click();
    await dlg.getByLabel('Код').fill('SUMMER10');
    await dlg.getByLabel('сумою').check();
    await dlg.getByLabel('Сума знижки, EUR').fill('5');
    await dlg.getByRole('button', { name: 'Створити промокод' }).click();
    await expect(dlg.getByRole('alert')).toHaveText('Промокод SUMMER10 уже є — придумайте інший.');
    await dlg.getByRole('button', { name: 'Закрити' }).click();

    await page.getByRole('button', { name: 'Вимкнути: SUMMER10' }).click();
    await expect(page.locator('[data-promo-msg]')).toHaveText('Промокод SUMMER10 вимкнено.');
    await expect(page.locator('[data-promo="SUMMER10"]')).toContainText('вимкнено');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Видалити: SUMMER10' }).click();
    await expect(page.locator('[data-promo="SUMMER10"]')).toHaveCount(0);
  });

  test('manager: no promotions in the menu, the page explains it is for the owner', async ({ page }) => {
    const db = sampleDb();
    await mockAdmin(page, db, { role: 'manager' });
    await page.goto('/admin/promotions/');
    await expect(page.getByText('Розділ «Акції» доступний лише власнику магазину.')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Розділи адмінки' }).getByRole('link', { name: 'Акції' })).toBeHidden();
  });
});
