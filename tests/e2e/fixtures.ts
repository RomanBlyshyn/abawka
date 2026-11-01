// Спільна основа для всіх e2e: тестова збірка дивиться на фальшивий https://abawka-test.supabase.co,
// тож будь-який запит туди має бути підмінений. Картинки сховища віддаємо крихітним PNG,
// а все, що конкретний тест не підмінив сам, відхиляємо — жоден тест не вийде в мережу.
import { test as base, expect } from '@playwright/test';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

export const test = base.extend({
  page: async ({ page }, use) => {
    // Маршрути, додані пізніше в самих тестах, мають пріоритет над цими.
    await page.route(/abawka-test\.supabase\.co/, (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"not mocked in this test"}' }));
    await page.route(/abawka-test\.supabase\.co\/storage\/v1\/object\/public\//, (route) =>
      route.fulfill({ contentType: 'image/png', body: PNG }));
    // Курсів за замовчуванням немає (перемикач валют схований); тести валют підставляють свої.
    await page.route(/abawka-test\.supabase\.co\/rest\/v1\/exchange_rates/, (route) => route.fulfill({ json: [] }));
    await use(page);
  },
});
export { expect };
