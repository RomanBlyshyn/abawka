import { expect, test } from '@playwright/test';
import { mockAdmin, sampleDb } from './helpers/supabase-mock';

test.describe('admin: product list', () => {
  test('shows products with status chips, searches and filters by category', async ({ page }) => {
    const db = sampleDb();
    await mockAdmin(page, db);
    await page.goto('/admin/products/');
    await expect(page.locator('[data-total]')).toHaveText('2');
    const sword = page.locator('.row', { hasText: 'Іграшковий меч' });
    await expect(sword).toContainText('хіт');
    await expect(sword).toContainText('−20%');
    await expect(sword).toContainText('19.99 €');
    const chess = page.locator('.row', { hasText: 'Шахи' });
    await expect(chess).toContainText('прихований');
    await expect(chess.locator('.stock')).toHaveText('немає');

    await page.getByPlaceholder('Пошук за назвою…').fill('chess');
    await expect(page.locator('.row')).toHaveCount(1);
    await page.getByPlaceholder('Пошук за назвою…').fill('');
    await page.getByLabel('Категорія').selectOption({ label: 'Мечі' });
    await expect(page.locator('.row')).toHaveCount(1);
    await expect(page.locator('.row')).toContainText('Іграшковий меч');
  });

  test('not logged in → login page', async ({ page }) => {
    await page.goto('/admin/products/');
    await expect(page).toHaveURL(/\/admin\/$/);
  });
});

test.describe('admin: product editor', () => {
  test('create: address from the name, money parsing, validation, then saved', async ({ page }) => {
    const db = sampleDb();
    await mockAdmin(page, db);
    await page.goto('/admin/products/');
    await page.getByRole('link', { name: '+ Додати товар' }).click();
    await expect(page.getByRole('heading', { name: 'Новий товар' })).toBeVisible();

    await page.getByRole('button', { name: 'Зберегти' }).click();
    await expect(page.getByRole('alert')).toHaveText('Перевірте поля, позначені червоним.');
    await expect(page.getByText('Вкажіть назву хоча б однією мовою.')).toBeVisible();
    await expect(page.getByText('Вкажіть ціну, наприклад 19,99.')).toBeVisible();

    await page.locator('#name').fill('Меч лицаря');
    await expect(page.locator('[data-slug]')).toHaveValue('mech-lytsaria');
    await page.getByLabel('Ціна, €', { exact: true }).fill('24,99');
    await page.getByLabel(/^Стара ціна/).fill('20');
    await page.getByRole('button', { name: 'Зберегти' }).click();
    await expect(page.getByText('Стара ціна має бути більшою за нову')).toBeVisible();
    await page.getByLabel(/^Стара ціна/).fill('29,99');
    await expect(page.getByText('знижка −17%')).toBeVisible();
    await page.locator('#category').selectOption({ label: 'Мечі' });
    await page.getByRole('button', { name: 'Зберегти' }).click();

    await expect(page).toHaveURL(/\/admin\/products\/edit\/\?id=new-3&created=1$/);
    await expect(page.locator('[data-saved]')).toHaveText('Товар створено ✓');
    const post = db.requests.find((r) => r.method === 'POST')!.body as Record<string, unknown>;
    expect(post).toMatchObject({ slug: 'mech-lytsaria', name: { uk: 'Меч лицаря' }, price: 2499, old_price: 2999, stock: 0, age_min: 3, published: true, category_id: 'cat-swords' });
  });

  test('edit: loads values, tracks unsaved changes, saves only the product', async ({ page }) => {
    const db = sampleDb();
    await mockAdmin(page, db);
    await page.goto('/admin/products/edit/?id=p-chess');
    await expect(page.getByRole('heading', { name: 'Шахи' })).toBeVisible();
    await expect(page.getByLabel('Ціна, €', { exact: true })).toHaveValue('34.99');
    await expect(page.getByLabel('Показувати на сайті')).not.toBeChecked();
    await expect(page.locator('#description')).toHaveValue('Дерев’яні');

    await page.getByLabel('Кількість на складі').fill('5');
    await expect(page.locator('[data-saved]')).toHaveText('Є незбережені зміни');
    await page.getByLabel('Показувати на сайті').check();
    await page.getByRole('button', { name: 'Зберегти' }).click();
    await expect(page.locator('[data-saved]')).toHaveText('Збережено ✓');
    const patch = db.requests.find((r) => r.method === 'PATCH')!;
    expect(patch.url).toContain('id=eq.p-chess');
    expect(patch.body).toMatchObject({ stock: 5, published: true, price: 3499 });
  });

  test('translate fills empty languages; manual edits in a language are kept', async ({ page }) => {
    const db = sampleDb();
    await mockAdmin(page, db);
    await page.goto('/admin/products/edit/?id=p-chess');
    await page.getByRole('button', { name: 'Перекласти на інші мови' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Готово' })).toHaveText('Готово: 7 мов. Перевірте й збережіть.');
    await page.getByRole('tab', { name: 'DE' }).click();
    await expect(page.locator('#name')).toHaveValue('[de] Шахи');
    await expect(page.locator('#description')).toHaveValue('[de] Дерев’яні');
    await page.getByRole('tab', { name: 'EN' }).click();
    await expect(page.locator('#name')).toHaveValue('Chess set'); // вже було — не чіпали
    await expect(page.getByRole('tab', { name: 'LT' })).toHaveClass(/filled/);
  });

  test('translation unavailable: clear message, nothing lost', async ({ page }) => {
    const db = sampleDb();
    await mockAdmin(page, db, { translate: 'fail' });
    await page.goto('/admin/products/edit/?id=p-chess');
    await page.getByRole('button', { name: /Перекласти/ }).click();
    await expect(page.getByText('Переклад зараз недоступний. Мови можна заповнити вручну.')).toBeVisible();
    await expect(page.locator('#name')).toHaveValue('Шахи');
  });

  test('database refuses (taken address): readable error, form keeps the input', async ({ page }) => {
    const db = sampleDb();
    await mockAdmin(page, db, { dbError: { code: '23505', status: 409 } });
    await page.goto('/admin/products/edit/?id=p-chess');
    await page.getByLabel('Кількість на складі').fill('7');
    await page.getByRole('button', { name: 'Зберегти' }).click();
    await expect(page.getByRole('alert')).toContainText('Така адреса (slug) вже зайнята');
    await expect(page.getByLabel('Кількість на складі')).toHaveValue('7');
  });

  test('delete asks first, then returns to the list', async ({ page }) => {
    const db = sampleDb();
    await mockAdmin(page, db);
    await page.goto('/admin/products/edit/?id=p-chess');
    page.once('dialog', (d) => d.dismiss());
    await page.getByRole('button', { name: 'Видалити товар' }).click();
    expect(db.requests.filter((r) => r.method === 'DELETE')).toHaveLength(0);
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Видалити товар' }).click();
    await expect(page).toHaveURL(/\/admin\/products\/\?deleted=1$/);
    expect(db.requests.find((r) => r.method === 'DELETE')!.url).toContain('id=eq.p-chess');
    await expect(page.locator('[data-total]')).toHaveText('1');
  });

  test('leaving with unsaved changes asks for confirmation', async ({ page }) => {
    const db = sampleDb();
    await mockAdmin(page, db);
    await page.goto('/admin/products/edit/?id=p-chess');
    await page.getByLabel('Кількість на складі').fill('9');
    let asked = false;
    page.once('dialog', (d) => { asked = d.type() === 'beforeunload'; d.dismiss(); });
    await page.getByRole('link', { name: '← Товари' }).click();
    await expect.poll(() => asked).toBe(true);
    await expect(page).toHaveURL(/edit\/\?id=p-chess$/);
  });

  test('unknown product id: "not found" with a way back', async ({ page }) => {
    await mockAdmin(page, sampleDb());
    await page.goto('/admin/products/edit/?id=nope');
    await expect(page.getByText('Товар не знайдено')).toBeVisible();
  });
});
