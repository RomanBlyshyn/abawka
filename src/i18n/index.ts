import { DEFAULT_LOCALE, type Locale } from './config';

// Усі словники підвантажуються під час збірки; відсутній ключ падає на англійську, потім на польську.
const dictionaries = import.meta.glob<Record<string, string>>('./*.json', { eager: true, import: 'default' });

function dict(locale: string): Record<string, string> {
  return dictionaries[`./${locale}.json`] ?? {};
}

export function useTranslations(locale: Locale) {
  return (key: string): string => dict(locale)[key] ?? dict('en')[key] ?? dict(DEFAULT_LOCALE)[key] ?? key;
}
