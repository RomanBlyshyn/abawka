// Правила перевірки заявки. Чистий модуль без DOM: на етапі 3 ті самі правила виконає сервер.
export const METHODS = ['call', 'telegram', 'viber', 'whatsapp', 'email'] as const;
export type Method = (typeof METHODS)[number];

export interface RequestLine { slug: string; qty: number }
export interface RequestInput {
  name: string;
  method: Method;
  contact: string;
  country: string;
  delivery: string;
  comment: string;
  consent: boolean;
  lines: RequestLine[];
}

export type FieldError = 'name' | 'phone' | 'telegram' | 'email' | 'country' | 'consent' | 'empty';
export type Errors = Partial<Record<'name' | 'contact' | 'country' | 'consent' | 'lines', FieldError>>;

export const LIMITS = { name: 60, contact: 80, comment: 500 } as const;

const PHONE = /^\+?\d{9,15}$/;
const TG_USER = /^@?[A-Za-z0-9_]{5,32}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Телефон без пробілів, дужок і дефісів: «+48 (600) 000-000» → «+48600000000». */
export const normalizePhone = (s: string) => s.replace(/[\s()\-.]/g, '');

/** Яким видом контакту має бути поле для обраного способу зв'язку. */
export const contactKind = (m: Method): 'phone' | 'telegram' | 'email' =>
  m === 'email' ? 'email' : m === 'telegram' ? 'telegram' : 'phone';

export function validateRequest(input: RequestInput, countries: readonly string[]): Errors {
  const errors: Errors = {};
  const name = input.name.trim();
  if (name.length < 2 || name.length > LIMITS.name) errors.name = 'name';

  const contact = input.contact.trim();
  const kind = contactKind(input.method);
  if (kind === 'email') {
    if (!EMAIL.test(contact) || contact.length > LIMITS.contact) errors.contact = 'email';
  } else if (kind === 'telegram') {
    if (!TG_USER.test(contact) && !PHONE.test(normalizePhone(contact))) errors.contact = 'telegram';
  } else if (!PHONE.test(normalizePhone(contact))) {
    errors.contact = 'phone';
  }

  if (!countries.includes(input.country)) errors.country = 'country';
  if (!input.consent) errors.consent = 'consent';
  if (!input.lines.some((l) => l.qty > 0)) errors.lines = 'empty';
  return errors;
}
