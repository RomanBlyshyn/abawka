// Телефон і країна у формі заявки: правила нумерації країни, код з прапорцем, вибір країни з пошуком.
import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { pickCountry } from './helpers/form';

const sent: Record<string, unknown>[] = [];
test.beforeEach(async ({ page }) => {
  sent.length = 0;
  await page.route(/\/rest\/v1\/rpc\/submit_request/, (route) => {
    sent.push(route.request().postDataJSON().payload);
    return route.fulfill({ json: { id: 1077 } });
  });
  await page.goto('/en/');
  await page.evaluate(() => { localStorage.setItem('cart', JSON.stringify([{ slug: 'toy-sword', qty: 1 }])); sessionStorage.clear(); });
});

const fillRest = async (page: Page) => {
  await page.getByLabel('Name').fill('Anna');
  await pickCountry(page, /^Country/, 'Poland');
  await page.getByRole('checkbox').check();
};
const send = (page: Page) => page.getByRole('button', { name: 'Send request' }).click();
const contactError = (page: Page) => page.locator('[data-request-form] [data-err="contact"]');

test('Polish number with 8 digits is refused; 9 digits is sent in international format', async ({ page }) => {
  await page.goto('/en/cart/');
  await fillRest(page);
  await expect(page.getByRole('button', { name: /Phone country code/ })).toContainText('+48'); // Польща — за замовчуванням
  await page.getByLabel('Phone number').fill('60000000');
  await send(page);
  await expect(contactError(page)).toHaveText('This number does not match the +48 country code. Check the number of digits or choose another country.');
  expect(sent).toHaveLength(0);
  await page.getByLabel('Phone number').fill('600 000 000');
  await expect(contactError(page)).toBeHidden(); // помилка зникає під час виправлення
  await send(page);
  await expect(page).toHaveURL(/thanks\/\?n=1077/);
  expect(sent[0]).toMatchObject({ contact: '+48600000000', country: 'PL' });
  expect(sent[0]).not.toHaveProperty('rawContact');
});

test('Ukrainian number: choose +380 or paste it with the code — the code switches by itself', async ({ page }) => {
  await page.goto('/en/cart/');
  await fillRest(page);
  await pickCountry(page, /Phone country code/, 'Ukraine');
  await expect(page.getByRole('button', { name: /Phone country code/ })).toContainText('+380');
  await page.getByLabel('Phone number').fill('67 123 45');
  await send(page);
  await expect(contactError(page)).toContainText('+380');
  await pickCountry(page, /Phone country code/, 'Poland');
  await page.getByLabel('Phone number').fill('+380 67 123 45 67'); // вставили повний номер
  await expect(page.getByRole('button', { name: /Phone country code/ })).toContainText('+380');
  await send(page);
  await expect(page).toHaveURL(/thanks/);
  expect(sent[0]).toMatchObject({ contact: '+380671234567' });
});

test('country of delivery suggests the phone code until the buyer picks it', async ({ page }) => {
  await page.goto('/en/cart/');
  await pickCountry(page, /^Country/, 'Germany');
  await expect(page.getByRole('button', { name: /Phone country code/ })).toContainText('+49');
  await pickCountry(page, /Phone country code/, 'Ukraine');
  await pickCountry(page, /^Country/, 'Czechia');
  await expect(page.getByRole('button', { name: /Phone country code/ })).toContainText('+380'); // вибір покупця не чіпаємо
});

test('country list: popular on top, search without diacritics, keyboard, Escape', async ({ page }) => {
  await page.goto('/pl/cart/');
  const btn = page.getByRole('button', { name: /^Kraj/ });
  await expect(btn).toContainText('Polska'); // польська мова — Польща за замовчуванням
  await btn.click();
  const list = page.getByRole('listbox').filter({ visible: true });
  await expect(list.getByRole('option').nth(0)).toContainText('Polska');
  await expect(list.getByRole('option').nth(1)).toContainText('Ukraina');
  await page.keyboard.type('niem');
  await expect(list.getByRole('option').filter({ visible: true })).toHaveCount(1);
  await expect(list.getByRole('option').filter({ visible: true })).toContainText('Niemcy');
  await page.keyboard.press('Enter');
  await expect(btn).toContainText('Niemcy');
  await expect(btn).toBeFocused();
  await btn.press('ArrowDown');
  await page.keyboard.type('zzz');
  await expect(page.getByText('Nic nie znaleziono').filter({ visible: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(btn).toContainText('Niemcy');
});

test('email and Telegram username do not need a phone code', async ({ page }) => {
  await page.goto('/en/cart/');
  const dial = page.getByRole('button', { name: /Phone country code/ });
  await page.getByRole('radio', { name: 'Email' }).check();
  await expect(dial).toBeHidden();
  await page.getByRole('radio', { name: 'Telegram' }).check();
  await expect(dial).toBeVisible();
  await page.getByLabel('Telegram: @username or number').fill('@abawka_fan');
  await expect(dial).toBeHidden();
});

test('country picker fits a 320 px phone screen when open', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/en/cart/');
  await page.getByRole('button', { name: /Phone country code/ }).click();
  await expect(page.getByRole('listbox').filter({ visible: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});
