import { expect, test } from './fixtures';
import { mockAdmin, sampleDb } from './helpers/supabase-mock';

test.describe('admin: categories', () => {
  test('list with product counts; reorder saves positions', async ({ page }) => {
    const db = sampleDb();
    await mockAdmin(page, db);
    await page.goto('/admin/categories/');
    const rows = page.locator('[data-category-id]');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Мечі');
    await expect(rows.first()).toContainText('1 товар · /catalog/swords/');
    await page.getByRole('button', { name: 'Мечі: нижче' }).click();
    await expect(page.locator('[data-msg]')).toHaveText('Порядок збережено ✓');
    await expect(rows.first()).toContainText('Настільні ігри');
    expect(db.categories.find((c) => c.id === 'cat-swords')!.position).toBe(1);
    expect(db.categories.find((c) => c.id === 'cat-games')!.position).toBe(0);
  });

  test('add: name → address, icon, colour; translation fills other languages', async ({ page }) => {
    const db = sampleDb();
    await mockAdmin(page, db);
    await page.goto('/admin/categories/');
    await page.getByRole('button', { name: '+ Додати категорію' }).click();
    const dlg = page.getByRole('dialog', { name: 'Нова категорія' });
    await dlg.getByRole('button', { name: 'Зберегти' }).click();
    await expect(dlg.getByRole('alert')).toContainText('Заповніть «Назва» хоча б однією мовою');
    await dlg.locator('#cat-name').fill('Машинки');
    await expect(dlg.locator('[data-slug]')).toHaveValue('mashynky');
    await dlg.getByRole('button', { name: 'Перекласти на інші мови' }).click();
    await expect(dlg.getByText('Готово: 8 мов')).toBeVisible();
    await dlg.getByRole('radio', { name: 'машинка' }).check();
    await dlg.getByRole('radio', { name: 'синій' }).check();
    await dlg.getByRole('button', { name: 'Зберегти' }).click();
    await expect(page.locator('[data-msg]')).toHaveText('Категорію додано ✓');
    const post = db.requests.find((r) => r.method === 'POST')!.body as Record<string, unknown>;
    // Після перекладу адреса береться з англійської назви (у житті «Toy cars» → toy-cars).
    expect(post).toMatchObject({ slug: 'en-mashynky', icon: 'car', tint: 'blue', position: 2 });
    expect((post.name as Record<string, string>).de).toBe('[de] Машинки');
  });

  test('a category with products cannot be deleted; an empty one can', async ({ page }) => {
    const db = sampleDb();
    db.categories.push({ id: 'cat-empty', slug: 'empty', name: { uk: 'Порожня' }, icon: 'star', tint: 'green', position: 2 });
    await mockAdmin(page, db);
    await page.goto('/admin/categories/');
    await page.getByRole('button', { name: 'Змінити: Мечі' }).click();
    await page.getByRole('button', { name: 'Видалити' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Спершу перенесіть їх');
    expect(db.requests.filter((r) => r.method === 'DELETE')).toHaveLength(0);
    await page.getByRole('button', { name: 'Закрити' }).click();

    await page.getByRole('button', { name: 'Змінити: Порожня' }).click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Видалити' }).click();
    await expect(page.locator('[data-msg]')).toHaveText('Категорію видалено.');
    expect(db.requests.find((r) => r.method === 'DELETE')!.url).toContain('id=eq.cat-empty');
  });
});

test.describe('admin: banners', () => {
  test('edit a banner: link to a category, hide it, texts saved', async ({ page }) => {
    const db = sampleDb();
    await mockAdmin(page, db);
    await page.goto('/admin/banners/');
    await expect(page.locator('[data-banner-id]')).toContainText('показується · кнопка → /catalog/swords/');
    await page.getByRole('button', { name: 'Змінити: Мечі — наш хіт' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.locator('#b-link')).toHaveValue('catalog/swords/');
    await expect(dlg.locator('#banner-title')).toHaveValue('Мечі — наш хіт');
    await dlg.locator('#banner-body').fill('Нова колекція');
    await dlg.locator('#b-link').selectOption({ label: 'Каталог — тільки зі знижкою' });
    await dlg.getByLabel('Показувати на сайті').uncheck();
    await dlg.getByRole('button', { name: 'Зберегти' }).click();
    await expect(page.locator('[data-msg]')).toHaveText('Банер збережено ✓');
    expect(db.requests.find((r) => r.method === 'PATCH')!.body).toMatchObject({ href: 'catalog/?sale=1', active: false, body: { uk: 'Нова колекція' } });
    await expect(page.locator('[data-banner-id]')).toHaveClass(/inactive/);
  });

  test('own link is checked before saving', async ({ page }) => {
    const db = sampleDb();
    await mockAdmin(page, db);
    await page.goto('/admin/banners/');
    await page.getByRole('button', { name: '+ Додати банер' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.locator('#banner-title').fill('Літній розпродаж');
    await dlg.locator('#b-link').selectOption({ label: 'Своя адреса…' });
    await dlg.getByLabel('Своя адреса').fill('javascript:alert(1)');
    await dlg.getByRole('button', { name: 'Зберегти' }).click();
    await expect(dlg.getByRole('alert')).toContainText('Своя адреса');
    expect(db.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
    await dlg.getByLabel('Своя адреса').fill('/catalog/flying/');
    await dlg.getByRole('button', { name: 'Зберегти' }).click();
    await expect(page.locator('[data-msg]')).toHaveText('Банер додано ✓');
    expect(db.requests.find((r) => r.method === 'POST')!.body).toMatchObject({ title: { uk: 'Літній розпродаж' }, href: 'catalog/flying/', position: 1, active: true });
  });
});
