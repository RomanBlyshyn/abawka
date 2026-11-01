// Вибір у CountryPicker (країна доставки або код телефону) так, як це робить людина: кнопка → пошук → варіант.
import type { Locator, Page } from '@playwright/test';

export async function pickCountry(scope: Page | Locator, label: string | RegExp, option: string) {
  await scope.getByRole('button', { name: label }).first().click();
  const list = scope.getByRole('listbox').filter({ visible: true });
  await list.getByRole('option', { name: new RegExp(option) }).first().click();
}
