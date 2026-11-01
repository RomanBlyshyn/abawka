// Правила перевірки заявки. Чистий модуль без DOM; сервер (submit_request) перевіряє те саме ще раз.
export const METHODS = ['call', 'telegram', 'viber', 'whatsapp', 'email'] as const;
export type Method = (typeof METHODS)[number];

export interface RequestLine { slug: string; qty: number }
export interface RequestInput {
  name: string;
  method: Method;
  /** Телефон — у міжнародному форматі (+48600000000), або @нік / email. */
  contact: string;
  country: string;
  delivery: string;
  comment: string;
  consent: boolean;
  lines: RequestLine[];
  /** Промокод з кошика; знижку рахує сервер. */
  promo?: string;
}

export type FieldError = 'name' | 'phone' | 'phoneCountry' | 'telegram' | 'email' | 'country' | 'consent' | 'empty';
export type Errors = Partial<Record<'name' | 'contact' | 'country' | 'consent' | 'lines', FieldError>>;

export const LIMITS = { name: 60, contact: 80, comment: 500 } as const;

const TG_USER = /^@?[A-Za-z0-9_]{5,32}$/;
// Email латиницею, як його приймає пошта власника: без кирилиці, двох крапок підряд і крапок на краях.
const EMAIL = /^(?!\.)(?!.*\.\.)[A-Za-z0-9._%+-]+(?<!\.)@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

/** Яким видом контакту має бути поле для обраного способу зв'язку. */
export const contactKind = (m: Method): 'phone' | 'telegram' | 'email' =>
  m === 'email' ? 'email' : m === 'telegram' ? 'telegram' : 'phone';

/** Схоже на телеграм-нік, а не на номер (є «@» або літери). */
export const looksLikeUsername = (s: string) => /^@|[A-Za-z_]/.test(s.trim());

/**
 * phoneOk — перевірка номера за правилами країни (src/lib/phone.ts): у браузері це libphonenumber,
 * у тестах — будь-яка функція. Порожній номер — «вкажіть номер», неправильний — «не підходить для країни».
 */
export function validateRequest(input: RequestInput & { rawContact?: string }, countries: readonly string[], phoneOk: (raw: string) => boolean): Errors {
  const errors: Errors = {};
  const name = input.name.trim();
  if (name.length < 2 || name.length > LIMITS.name) errors.name = 'name';

  const raw = (input.rawContact ?? input.contact).trim();
  const kind = contactKind(input.method);
  if (kind === 'email') {
    if (!EMAIL.test(raw) || raw.length > LIMITS.contact) errors.contact = 'email';
  } else if (kind === 'telegram' && looksLikeUsername(raw)) {
    if (!TG_USER.test(raw)) errors.contact = 'telegram';
  } else if (!/\d/.test(raw)) {
    errors.contact = kind === 'telegram' ? 'telegram' : 'phone';
  } else if (!phoneOk(raw)) {
    errors.contact = 'phoneCountry';
  }

  if (!countries.includes(input.country)) errors.country = 'country';
  if (!input.consent) errors.consent = 'consent';
  if (!input.lines.some((l) => l.qty > 0)) errors.lines = 'empty';
  return errors;
}
