// Перевірка телефону за правилами нумерації кожної країни (libphonenumber-js, повні дані).
// Бібліотека важка (~150 КБ), тож вантажимо її лише коли покупець почав заповнювати форму.
import type { CountryCode } from 'libphonenumber-js/max';

type Lib = typeof import('libphonenumber-js/max');
let lib: Lib | null = null;
let loading: Promise<Lib> | null = null;

export const loadPhone = (): Promise<Lib> => (loading ??= import('libphonenumber-js/max').then((m) => (lib = m)));
export const phoneReady = () => lib !== null;

/** Номер у міжнародному форматі (+48600000000) або null, якщо такого номера в цій країні не буває. */
export function toE164(raw: string, dial: string): string | null {
  if (!lib || !raw.trim()) return null;
  const n = lib.parsePhoneNumberFromString(raw, (dial || undefined) as CountryCode | undefined);
  return n?.isValid() ? n.number : null;
}

/** Країна з номера, введеного з «+» (вставили «+380 67…» — перемикаємо код на Україну). */
export function countryOf(raw: string): string | undefined {
  if (!lib || !raw.trim().startsWith('+')) return undefined;
  return lib.parsePhoneNumberFromString(raw)?.country;
}
