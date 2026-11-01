import { type Page, type Route } from '@playwright/test';
import { expect, test } from './fixtures';

// Supabase у тестах підміняємо: перевіряємо поведінку адмінки, не чіпаючи справжню базу й пошту.
const USER = { id: '11111111-1111-1111-1111-111111111111', email: 'owner@abawka.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const session = () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, email: USER.email, role: 'authenticated', aud: 'authenticated', exp })}.sig`,
    token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'refresh', user: USER,
  };
};
const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) =>
  route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });

interface Mock { role?: 'owner' | 'manager' | null; offline?: boolean; recover?: string[]; passwordUpdates?: string[] }

async function mockSupabase(page: Page, m: Mock = {}) {
  const role = m.role === undefined ? 'owner' : m.role;
  await page.route(/\/auth\/v1\/token\?grant_type=password/, async (route) => {
    if (m.offline) return route.abort('internetdisconnected');
    const { password } = route.request().postDataJSON();
    if (password !== 'right-password') return json(route, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
    return json(route, session());
  });
  await page.route(/\/auth\/v1\/user/, async (route) => {
    if (route.request().method() === 'PUT') {
      m.passwordUpdates?.push(route.request().postDataJSON().password);
      return json(route, USER);
    }
    return json(route, USER);
  });
  await page.route(/\/auth\/v1\/recover/, async (route) => {
    m.recover?.push(route.request().url());
    return json(route, {});
  });
  await page.route(/\/auth\/v1\/logout/, (route) => route.fulfill({ status: 204 }));
  await page.route(/\/rest\/v1\/staff\?/, async (route) => {
    if (route.request().method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': '0-1/2', 'access-control-expose-headers': 'content-range' } });
    return json(route, role ? [{ role }] : []);
  });
  await page.route(/\/rest\/v1\/(products|categories|banners)\?/, (route) =>
    route.fulfill({ status: 200, headers: { 'content-range': '0-6/7', 'access-control-expose-headers': 'content-range' } }));
}

async function login(page: Page, password = 'right-password') {
  await page.goto('/admin/');
  await page.locator('#email').fill('owner@abawka.test');
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Увійти' }).click();
}

test.describe('admin login', () => {
  test('wrong password: clear message, email stays', async ({ page }) => {
    await mockSupabase(page);
    await login(page, 'wrong');
    await expect(page.getByRole('alert')).toHaveText('Невірний email або пароль.');
    await expect(page.locator('#email')).toHaveValue('owner@abawka.test');
  });

  test('no connection: "try again", nothing lost', async ({ page }) => {
    await mockSupabase(page, { offline: true });
    await login(page);
    await expect(page.getByRole('alert')).toContainText('Не вдалося з\'єднатися');
    await expect(page.getByLabel('Пароль', { exact: true })).toHaveValue('right-password');
  });

  test('owner logs in, sees the dashboard, stays logged in after reload, logs out', async ({ page }) => {
    await mockSupabase(page, { role: 'owner' });
    await login(page);
    await expect(page.getByRole('heading', { name: /Вітаємо/ })).toBeVisible();
    await expect(page.locator('[data-role]')).toHaveText('власник');
    await expect(page.locator('[data-count="products"]')).toHaveText('7');
    await expect(page.getByRole('link', { name: /Команда/ })).toBeVisible();
    await expect(page.locator('[data-who-email]')).toHaveText('owner@abawka.test');
    await page.reload();
    await expect(page.locator('[data-role]')).toHaveText('власник');
    await page.getByRole('button', { name: 'Вийти' }).click();
    await expect(page.getByRole('heading', { name: 'Вхід в адмінку' })).toBeVisible();
  });

  test('manager does not see the team section', async ({ page }) => {
    await mockSupabase(page, { role: 'manager' });
    await login(page);
    await expect(page.locator('[data-role]')).toHaveText('менеджер');
    await expect(page.getByRole('link', { name: /Команда/ })).toBeHidden();
  });

  test('logged-in user outside the team gets "no access"', async ({ page }) => {
    await mockSupabase(page, { role: null });
    await login(page);
    await expect(page.getByRole('heading', { name: 'Немає доступу' })).toBeVisible();
    await expect(page.locator('[data-denied-email]')).toHaveText('owner@abawka.test');
  });

  test('forgot password: link goes to /admin/reset/, answer does not reveal if the email exists', async ({ page }) => {
    const recover: string[] = [];
    await mockSupabase(page, { recover });
    await page.goto('/admin/');
    await page.locator('#email').fill('someone@abawka.test');
    await page.getByRole('button', { name: 'Забули пароль?' }).click();
    await expect(page.locator('#forgot-email')).toHaveValue('someone@abawka.test'); // email перенесено
    await page.getByRole('button', { name: 'Надіслати лист' }).click();
    await expect(page.getByRole('status')).toContainText('Якщо цей email є в команді');
    expect(decodeURIComponent(recover[0]!)).toContain('/admin/reset/');
  });

  test('admin pages are hidden from search engines', async ({ page }) => {
    for (const path of ['/admin/', '/admin/reset/']) {
      await page.goto(path);
      await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', /noindex/);
    }
  });
});

test.describe('set a new password', () => {
  test('without a valid link: explains and offers a new email', async ({ page }) => {
    await mockSupabase(page);
    await page.goto('/admin/reset/');
    await expect(page.getByRole('heading', { name: 'Посилання не спрацювало' })).toBeVisible();
    await page.getByRole('link', { name: 'Надіслати новий лист' }).click();
    await expect(page.getByRole('heading', { name: 'Відновлення пароля' })).toBeVisible();
  });

  test('checks length and match, then saves and opens the admin', async ({ page }) => {
    const passwordUpdates: string[] = [];
    await mockSupabase(page, { passwordUpdates });
    await login(page); // сесія, як після переходу з листа
    await expect(page.locator('[data-role]')).toBeVisible();
    await page.goto('/admin/reset/');
    await page.getByLabel('Новий пароль').fill('short');
    await page.getByLabel('Повторіть пароль').fill('short');
    await page.getByRole('button', { name: 'Зберегти пароль' }).click();
    await expect(page.getByRole('alert')).toHaveText('Пароль має бути щонайменше 8 символів.');
    await page.getByLabel('Новий пароль').fill('long-enough-1');
    await page.getByLabel('Повторіть пароль').fill('long-enough-2');
    await page.getByRole('button', { name: 'Зберегти пароль' }).click();
    await expect(page.getByRole('alert')).toHaveText('Паролі не збігаються.');
    await page.getByLabel('Повторіть пароль').fill('long-enough-1');
    await page.getByRole('button', { name: 'Зберегти пароль' }).click();
    await expect(page.getByRole('heading', { name: 'Готово!' })).toBeVisible();
    expect(passwordUpdates).toEqual(['long-enough-1']);
    await expect(page).toHaveURL(/\/admin\/$/);
  });
});
