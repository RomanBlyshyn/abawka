import { expect, test } from './fixtures';
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

test.describe('admin: product photos', () => {
  // Справжня картинка 2400×1200, намальована в браузері, щоб перевірити зменшення до трьох розмірів.
  async function bigPng(page: import('@playwright/test').Page) {
    const b64 = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 2400; c.height = 1200;
      const g = c.getContext('2d')!;
      const grad = g.createLinearGradient(0, 0, 2400, 1200);
      grad.addColorStop(0, '#d6246e'); grad.addColorStop(1, '#ffc94d');
      g.fillStyle = grad; g.fillRect(0, 0, 2400, 1200);
      for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${i * 7} 80% 50%)`; g.fillRect((i * 97) % 2400, (i * 53) % 1200, 40, 40); }
      const blob = await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), 'image/png'));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = ''; bytes.forEach((x) => (s += String.fromCharCode(x)));
      return btoa(s);
    });
    return { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
  }

  test('new product: photos become available after the first save', async ({ page }) => {
    await mockAdmin(page, sampleDb());
    await page.goto('/admin/products/edit/');
    await expect(page.getByText('Спершу збережіть товар')).toBeVisible();
    await expect(page.locator('[data-file-input]')).toBeHidden();
  });

  test('upload: three compressed WebP sizes, then a database row; first photo is the cover', async ({ page }) => {
    const db = sampleDb();
    await mockAdmin(page, db);
    await page.goto('/admin/products/edit/?id=p-chess');
    await page.locator('[data-file-input]').setInputFiles(await bigPng(page));
    await expect(page.locator('[data-photo-status]')).toHaveText('Додано фото: 1.');

    const uploads = db.requests.filter((r) => r.method === 'STORAGE-UPLOAD');
    expect(uploads.map((u) => u.url.replace(/[0-9a-f-]{36}-/, 'ID-'))).toEqual([
      'products/p-chess/ID-400.webp', 'products/p-chess/ID-800.webp', 'products/p-chess/ID-1600.webp',
    ]);
    const sizes = uploads.map((u) => (u.body as { bytes: number; contentType: string }));
    expect(sizes.every((s) => s.contentType === 'image/webp')).toBe(true);
    expect(sizes[0]!.bytes).toBeLessThan(sizes[2]!.bytes);
    const row = db.product_images[0]!;
    expect(row).toMatchObject({ product_id: 'p-chess', position: 0 });
    expect(String(row.path)).toMatch(/^products\/p-chess\/[0-9a-f-]{36}$/);
    await expect(page.locator('.photo').first().locator('.cover')).toHaveText('обкладинка');
  });

  test('a file the browser cannot open (e.g. HEIC): clear advice, nothing uploaded', async ({ page }) => {
    const db = sampleDb();
    await mockAdmin(page, db);
    await page.goto('/admin/products/edit/?id=p-chess');
    await page.locator('[data-file-input]').setInputFiles({ name: 'IMG_0001.heic', mimeType: 'image/heic', buffer: Buffer.from('not really an image') });
    await expect(page.locator('[data-photo-error]')).toContainText('надішліть його як JPG');
    expect(db.requests.filter((r) => r.method === 'STORAGE-UPLOAD')).toHaveLength(0);
    expect(db.product_images).toHaveLength(0);
  });

  test('storage failure: "not uploaded, try again", no half-saved photo', async ({ page }) => {
    const db = sampleDb();
    await mockAdmin(page, db, { storageError: true });
    await page.goto('/admin/products/edit/?id=p-chess');
    await page.locator('[data-file-input]').setInputFiles(await bigPng(page));
    await expect(page.locator('[data-photo-error]')).toContainText('не завантажено');
    expect(db.product_images).toHaveLength(0);
  });

  test('reorder with arrows: positions rewritten, new first photo becomes the cover', async ({ page }) => {
    const db = sampleDb();
    db.product_images.push(
      { id: 'img-a', product_id: 'p-chess', path: 'products/p-chess/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', position: 0 },
      { id: 'img-b', product_id: 'p-chess', path: 'products/p-chess/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', position: 1 },
    );
    await mockAdmin(page, db);
    await page.goto('/admin/products/edit/?id=p-chess');
    await expect(page.locator('.photo')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Фото 1: раніше' })).toBeDisabled();
    await page.getByRole('button', { name: 'Фото 2: раніше' }).click();
    await expect(page.locator('[data-photo-status]')).toHaveText('Порядок збережено.');
    expect(db.product_images.find((i) => i.id === 'img-b')!.position).toBe(0);
    expect(db.product_images.find((i) => i.id === 'img-a')!.position).toBe(1);
    await expect(page.locator('.photo').first()).toHaveAttribute('data-photo-id', 'img-b');
    await expect(page.locator('.photo').first().locator('.cover')).toBeVisible();
  });

  test('delete asks first, removes the row and all three files', async ({ page }) => {
    const db = sampleDb();
    db.product_images.push({ id: 'img-a', product_id: 'p-chess', path: 'products/p-chess/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', position: 0 });
    await mockAdmin(page, db);
    await page.goto('/admin/products/edit/?id=p-chess');
    page.once('dialog', (d) => d.dismiss());
    await page.getByRole('button', { name: 'Видалити фото 1' }).click();
    expect(db.product_images).toHaveLength(1);
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Видалити фото 1' }).click();
    await expect(page.locator('[data-photo-status]')).toHaveText('Фото видалено.');
    expect(db.product_images).toHaveLength(0);
    const removed = db.requests.find((r) => r.method === 'STORAGE-DELETE')!.body as string[];
    expect(removed.map((k) => k.split('-').pop())).toEqual(['400.webp', '800.webp', '1600.webp']);
  });
});
