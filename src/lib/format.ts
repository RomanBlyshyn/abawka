import type { Locale } from '../i18n/config';

/** Ціна з мінорних одиниць (центи) у рядок за правилами мови. */
export function formatPrice(minor: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2 }).format(minor / 100);
}

/** Шлях у межах мови: href(locale, 'catalog/') → '/pl/catalog/'. */
export function href(locale: Locale, path = ''): string {
  return `/${locale}/${path.replace(/^\//, '')}`;
}
