import { DEFAULT_LOCALE, type Locale } from './config';

// Усі словники підвантажуються під час збірки; відсутній ключ падає на англійську, потім на польську.
const dictionaries = import.meta.glob<Record<string, string>>('./*.json', { eager: true, import: 'default' });

function dict(locale: string): Record<string, string> {
  return dictionaries[`./${locale}.json`] ?? {};
}

export function useTranslations(locale: Locale) {
  return (key: string): string => dict(locale)[key] ?? dict('en')[key] ?? dict(DEFAULT_LOCALE)[key] ?? key;
}

/** Множина за правилами мови: ключі `<key>.one|few|many|other` → «1 відгук», «3 відгуки», «5 відгуків». */
export function plural(locale: Locale, key: string, n: number): string {
  const t = useTranslations(locale);
  const form = new Intl.PluralRules(locale).select(n);
  const text = t(`${key}.${form}`);
  return `${n} ${text === `${key}.${form}` ? t(`${key}.other`) : text}`;
}
