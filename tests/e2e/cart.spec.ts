import { expect, test, type Page } from '@playwright/test';

const setCart = async (page: Page, lines: { slug: string; qty: number }[]) => {
  await page.goto('/en/');
  await page.evaluate((c) => { localStorage.setItem('cart', JSON.stringify(c)); sessionStorage.clear(); }, lines);
};

const fillValid = async (page: Page, scope = page.locator('[data-request-form]').first()) => {
  await scope.getByLabel('Name').fill('Anna');
  await scope.getByLabel('Phone number').fill('+48 600 000 000');
  await scope.getByLabel('Country').selectOption('PL');
  await scope.getByRole('checkbox').check();
};

test.describe('cart page', () => {
  test('empty cart shows the bear and a link to the catalog', async ({ page }) => {
    await setCart(page, []);
    await page.goto('/en/cart/');
    await expect(page.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
    await page.getByRole('link', { name: 'Go to catalog' }).click();
    await expect(page).toHaveURL(/\/en\/catalog\/$/);
  });

  test('lines, quantities, totals and removal', async ({ page }) => {
    await setCart(page, [{ slug: 'toy-sword', qty: 2 }, { slug: 'bobo-balloon', qty: 1 }]);
    await page.goto('/en/cart/');
    await expect(page.locator('[data-sum-count]')).toHaveText('3 items');
    await expect(page.locator('[data-sum-total]')).toHaveText('€45.97'); // 2×19.99 + 5.99
    const bobo = page.locator('[data-line="bobo-balloon"]');
    await bobo.getByRole('button', { name: 'Increase' }).click();
    await expect(page.locator('[data-sum-total]')).toHaveText('€51.96');
    await expect(page.locator('[data-cart-count]')).toHaveText('4');
    await page.getByRole('button', { name: 'Remove: Toy sword' }).click();
    await expect(page.locator('[data-sum-total]')).toHaveText('€11.98');
    await expect(page.locator('[data-line="toy-sword"]')).toBeHidden();
  });

  test('quantity above stock is reduced with a notice; sold-out item is flagged and not counted', async ({ page }) => {
    await setCart(page, [{ slug: 'chess', qty: 6 }, { slug: 'walking-rabbit', qty: 1 }]);
    await page.goto('/en/cart/');
    await expect(page.locator('[data-line="chess"] [data-qty]')).toHaveValue('4');
    await expect(page.locator('[data-line="chess"] [data-warn]')).toHaveText('Only 4 available');
    await expect(page.locator('[data-line="walking-rabbit"] [data-warn]')).toContainText('no longer in stock');
    await expect(page.locator('[data-sum-count]')).toHaveText('4 items');
    await expect(page.locator('[data-sum-total]')).toHaveText('€139.96');
  });

  test('cart updates when another tab changes it', async ({ page, context }) => {
    await setCart(page, [{ slug: 'toy-sword', qty: 1 }]);
    await page.goto('/en/cart/');
    const other = await context.newPage();
    await other.goto('/en/catalog/');
    await other.getByRole('button', { name: 'Add to cart: Bobo balloon' }).click();
    await expect(page.locator('[data-line="bobo-balloon"]')).toBeVisible();
    await expect(page.locator('[data-cart-count]')).toHaveText('2');
  });
});

test.describe('request form', () => {
  test('shows clear errors, focuses the first one, and fixes them live', async ({ page }) => {
    await setCart(page, [{ slug: 'toy-sword', qty: 1 }]);
    await page.goto('/en/cart/');
    await page.getByLabel('Country').selectOption('');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByRole('alert')).toHaveText('Please check the fields marked in red.');
    await expect(page.getByLabel('Name')).toBeFocused();
    await expect(page.getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
    for (const msg of ['Enter your name', 'Enter a phone number', 'Choose a country.', 'We need your consent.']) {
      await expect(page.getByText(msg)).toBeVisible();
    }
    await page.getByLabel('Name').fill('Anna');
    await expect(page.getByLabel('Name')).toHaveAttribute('aria-invalid', 'false');
    await expect(page.getByText('Enter your name')).toBeHidden();
  });

  test('contact field follows the chosen method', async ({ page }) => {
    await setCart(page, [{ slug: 'toy-sword', qty: 1 }]);
    await page.goto('/en/cart/');
    await page.getByRole('radio', { name: 'Email' }).check();
    const contact = page.getByRole('textbox', { name: 'Email', exact: true });
    await expect(contact).toHaveAttribute('type', 'email');
    await contact.fill('not-an-email');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('Check the email')).toBeVisible();
    await page.getByRole('radio', { name: 'Telegram' }).check();
    await page.getByLabel('Telegram: @username or number').fill('@abawka_fan');
    await expect(page.getByText(/Enter a @username/)).toBeHidden();
  });

  test('delivery options depend on the country', async ({ page }) => {
    await setCart(page, [{ slug: 'toy-sword', qty: 1 }]);
    await page.goto('/en/cart/');
    const delivery = page.getByLabel('Preferred delivery');
    await page.getByLabel('Country').selectOption('PL');
    await expect(delivery.locator('option')).toContainText(['Discuss with the owner', 'InPost (Paczkomat)', 'Courier in Wrocław']);
    await delivery.selectOption('courier-wroclaw');
    await page.getByLabel('Country').selectOption('DE');
    await expect(delivery).toHaveValue('discuss'); // кур'єра по Вроцлаву в Німеччині немає
    await expect(delivery.locator('option', { hasText: 'Wrocław' })).toHaveCount(0);
  });

  test('network error: "not sent, try again", nothing typed is lost', async ({ page, context }) => {
    await setCart(page, [{ slug: 'toy-sword', qty: 1 }]);
    await page.goto('/en/cart/');
    await fillValid(page);
    await page.getByLabel('Comment (optional)').fill('Gift wrap please');
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByRole('alert')).toContainText('Not sent');
    await expect(page.getByLabel('Name')).toHaveValue('Anna');
    await expect(page.getByLabel('Comment (optional)')).toHaveValue('Gift wrap please');
    await expect(page.getByRole('button', { name: 'Send request' })).toBeEnabled();
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page).toHaveURL(/\/en\/thanks\/\?n=D-\d{6}&demo=1$/);
  });

  test('draft survives a page reload', async ({ page }) => {
    await setCart(page, [{ slug: 'toy-sword', qty: 1 }]);
    await page.goto('/en/cart/');
    await page.getByLabel('Name').fill('Olena');
    await page.getByRole('radio', { name: 'Viber' }).check();
    await page.getByLabel('Country').selectOption('UA');
    await page.getByLabel('Preferred delivery').selectOption('nova-poshta');
    await page.reload();
    await expect(page.getByLabel('Name')).toHaveValue('Olena');
    await expect(page.getByRole('radio', { name: 'Viber' })).toBeChecked();
    await expect(page.getByLabel('Preferred delivery')).toHaveValue('nova-poshta');
  });

  test('successful request empties the cart and shows the thank-you page', async ({ page }) => {
    await setCart(page, [{ slug: 'toy-sword', qty: 2 }]);
    await page.goto('/uk/cart/');
    await page.getByLabel("Ім’я").fill('Олена');
    await page.getByLabel('Номер телефону').fill('+380 67 000 00 00');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Надіслати заявку' }).click();
    await expect(page).toHaveURL(/\/uk\/thanks\//);
    await expect(page.getByRole('heading', { name: 'Дякуємо за заявку!' })).toBeVisible();
    await expect(page.getByText(/Номер заявки: D-\d{6}/)).toBeVisible();
    await expect(page.getByText(/Демо-режим/)).toBeVisible();
    await expect(page.locator('[data-cart-count]')).toBeHidden();
  });

  test('thank-you page ignores a malicious number in the URL', async ({ page }) => {
    await page.goto('/en/thanks/?n=<img src=x onerror=alert(1)>');
    await expect(page.locator('[data-number]')).toBeHidden();
    await expect(page.locator('img[src=x]')).toHaveCount(0);
  });
});

test.describe('quick order on the product page', () => {
  test('opens a dialog for this product only and keeps the cart untouched', async ({ page }) => {
    await setCart(page, [{ slug: 'chess', qty: 1 }]);
    await page.goto('/en/product/walking-capybara/');
    await page.getByRole('button', { name: 'Increase' }).click();
    await page.getByRole('button', { name: 'Quick order' }).click();
    const dialog = page.getByRole('dialog', { name: 'Quick order' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.quick-line')).toContainText('× 2');
    await expect(dialog.locator('[data-quick-total]')).toHaveText('€59.98');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Quick order' })).toBeFocused();

    await page.getByRole('button', { name: 'Quick order' }).click();
    await fillValid(page, dialog);
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(page).toHaveURL(/\/en\/thanks\//);
    await expect(page.locator('[data-cart-count]')).toHaveText('1'); // шахи лишились у кошику
  });
});

test('cart and thank-you pages: no overflow in any language', async ({ page }) => {
  await setCart(page, [{ slug: 'walking-capybara', qty: 12 }, { slug: 'slingshot-helicopter', qty: 3 }]);
  for (const locale of ['pl', 'en', 'uk', 'de', 'cs', 'lt', 'es', 'fr', 'ru']) {
    for (const path of ['cart/', 'thanks/?n=D-123456&demo=1']) {
      for (const width of [320, 768, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/${locale}/${path}`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        expect(overflow, `${locale}/${path} at ${width}px`).toBe(0);
      }
    }
  }
});

test('cart page does not jump while loading (layout shift)', async ({ page }) => {
  for (const lines of [[], [{ slug: 'toy-sword', qty: 2 }, { slug: 'chess', qty: 6 }]]) {
    await setCart(page, lines);
    await page.addInitScript(() => {
      (window as unknown as { cls: number }).cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
          if (!e.hadRecentInput) (window as unknown as { cls: number }).cls += e.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto('/en/cart/', { waitUntil: 'networkidle' });
    expect(await page.evaluate(() => (window as unknown as { cls: number }).cls)).toBeLessThan(0.05);
  }
});

test('text areas use the site font, not the browser monospace default', async ({ page }) => {
  await setCart(page, [{ slug: 'toy-sword', qty: 1 }]);
  await page.goto('/en/cart/');
  const [body, comment] = await Promise.all([
    page.evaluate(() => getComputedStyle(document.body).fontFamily),
    page.getByLabel('Comment (optional)').evaluate((e) => getComputedStyle(e).fontFamily),
  ]);
  expect(comment).toBe(body);
});
