import type { RequestInput, RequestLine } from './request';

export interface SubmitResult { id: string; demo: boolean }
export type SubmitFailure = 'stock' | 'rate' | 'promo' | 'network';
export class SubmitError extends Error {
  constructor(public kind: SubmitFailure) { super(kind); }
}

const URL_ = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;
export const requestsLive = Boolean(URL_ && KEY);

/**
 * Надсилає заявку у функцію бази submit_request: вона ще раз перевіряє поля, бере ціни з бази
 * й резервує товар. Звичайний fetch замість supabase-js — щоб не тягнути бібліотеку на сторінки покупців.
 * Без ключів Supabase (локально) — демо-режим.
 */
export async function submitRequest(input: RequestInput & { locale: string; website: string }): Promise<SubmitResult> {
  if (!requestsLive) {
    await new Promise((r) => setTimeout(r, 400));
    if (!navigator.onLine) throw new SubmitError('network');
    return { id: `D-${Math.floor(100000 + Math.random() * 900000)}`, demo: true };
  }

  let res: Response;
  try {
    res = await fetch(`${URL_}/rest/v1/rpc/submit_request`, {
      method: 'POST',
      headers: { apikey: KEY!, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ payload: input }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new SubmitError('network');
  }
  if (res.ok) {
    const data = await res.json();
    return { id: String(data.id), demo: false };
  }
  const message = String((await res.json().catch(() => ({}))).message ?? '');
  if (message.startsWith('stock:')) throw new SubmitError('stock');
  if (message === 'rate_limited') throw new SubmitError('rate');
  if (message.startsWith('promo:')) throw new SubmitError('promo');
  throw new SubmitError('network'); // інші помилки покупцю пояснюємо як «не надіслано, спробуйте ще раз»
}

export interface PromoResult { code: string; subtotal: number; discount: number; total: number }
export class PromoError extends Error {
  /** min — мінімальна сума замовлення в центах, якщо код діє лише від неї. */
  constructor(public kind: 'invalid' | 'min' | 'network', public min = 0) { super(kind); }
}

/** Перевірити промокод для кошика: суму й знижку рахує функція бази check_promo. */
export async function checkPromo(code: string, lines: RequestLine[]): Promise<PromoResult> {
  if (!requestsLive) throw new PromoError('network');
  let res: Response;
  try {
    res = await fetch(`${URL_}/rest/v1/rpc/check_promo`, {
      method: 'POST',
      headers: { apikey: KEY!, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { promo: code, lines } }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new PromoError('network');
  }
  if (res.ok) return res.json();
  const message = String((await res.json().catch(() => ({}))).message ?? '');
  if (message === 'promo:invalid') throw new PromoError('invalid');
  if (message.startsWith('promo:min:')) throw new PromoError('min', Number(message.slice('promo:min:'.length)));
  throw new PromoError('network');
}

export interface ReviewInput { product: string; name: string; rating: number; text: string; consent: boolean; website: string; locale: string }

/** Надіслати відгук на перевірку (функція бази submit_review). Без ключів Supabase — демо-режим. */
export async function submitReview(input: ReviewInput): Promise<void> {
  if (!requestsLive) {
    await new Promise((r) => setTimeout(r, 300));
    if (!navigator.onLine) throw new SubmitError('network');
    return;
  }
  let res: Response;
  try {
    res = await fetch(`${URL_}/rest/v1/rpc/submit_review`, {
      method: 'POST',
      headers: { apikey: KEY!, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ payload: input }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new SubmitError('network');
  }
  if (res.ok) return;
  const message = String((await res.json().catch(() => ({}))).message ?? '');
  throw new SubmitError(message === 'rate_limited' ? 'rate' : 'network');
}
