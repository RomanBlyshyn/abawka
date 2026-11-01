// Показ цін у вибраній валюті (браузер). Ціни й заявки — у базовій валюті; інші валюти — орієнтовно,
// за курсом з таблиці exchange_rates (оновлює функція rates щодня). Без курсів перемикач схований.
export const CURRENCIES = ['EUR', 'PLN', 'UAH', 'USD'] as const;
export const CURRENCY_EVENT = 'currency:change';
const CACHE = 'rates-cache';
const MAX_AGE_DAYS = 10; // старіший курс не показуємо — краще ціна в базовій валюті, ніж неправдива

export interface Rates { [currency: string]: { perEur: number; date: string; source: string } }

const URL_ = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;
let rates: Rates | null = null;
let base = 'EUR';

/** Курси: з кешу вкладки (до години) або з бази. null — курсів немає (тоді лише базова валюта). */
export async function loadRates(baseCurrency: string): Promise<Rates | null> {
  base = baseCurrency;
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE) ?? 'null');
    if (cached && Date.now() - cached.at < 3600e3) return (rates = cached.rates);
  } catch { /* немає доступу до сховища */ }
  if (!URL_ || !KEY) return null;
  try {
    const res = await fetch(`${URL_}/rest/v1/exchange_rates?select=currency,per_eur,rate_date,source`, {
      headers: { apikey: KEY, authorization: `Bearer ${KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { currency: string; per_eur: number; rate_date: string; source: string }[];
    const fresh = rows.filter((r) => r.source === 'fixed' || Date.now() - Date.parse(r.rate_date) < MAX_AGE_DAYS * 86400e3);
    rates = Object.fromEntries(fresh.map((r) => [r.currency, { perEur: Number(r.per_eur), date: r.rate_date, source: r.source }]));
    try { sessionStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), rates })); } catch { /* не страшно */ }
    return rates;
  } catch {
    return null;
  }
}

/** Валюти, у які зараз можна перерахувати ціни. */
export const available = (): string[] => (rates && rates[base] ? CURRENCIES.filter((c) => rates![c]) : [base]);

export function selected(): string {
  let c: string | null = null;
  try { c = localStorage.getItem('currency'); } catch { /* приватний режим */ }
  return c && available().includes(c) ? c : base;
}

export function select(currency: string): void {
  try { localStorage.setItem('currency', currency); } catch { /* приватний режим */ }
  window.dispatchEvent(new CustomEvent(CURRENCY_EVENT, { detail: currency }));
}

/** Сума в базовій валюті (центи) → текст у вибраній валюті. */
export function formatMoney(minor: number, locale: string, currency = selected()): string {
  // Немає курсу — показуємо базову валюту, а не неправильне число з чужим символом.
  const rate = currency !== base && rates?.[currency] && rates[base] ? rates[currency]!.perEur / rates[base]!.perEur : null;
  return new Intl.NumberFormat(locale, { style: 'currency', currency: rate ? currency : base, minimumFractionDigits: 2 })
    .format((rate ? Math.round(minor * rate) : minor) / 100);
}

/** Дата й джерело курсу для примітки «орієнтовно». */
export const rateInfo = (currency = selected()) => (currency === base ? null : rates?.[currency] ?? null);

/** Перемалювати всі ціни сторінки: елементи з data-price (центи в базовій валюті). */
export function applyPrices(locale: string, root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-price-minor]').forEach((el) => {
    el.textContent = formatMoney(Number(el.dataset.priceMinor), locale);
  });
}
