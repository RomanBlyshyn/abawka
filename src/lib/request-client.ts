import type { RequestInput } from './request';

export interface SubmitResult { id: string; demo: boolean }
export type SubmitFailure = 'stock' | 'rate' | 'network';
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
  throw new SubmitError('network'); // інші помилки покупцю пояснюємо як «не надіслано, спробуйте ще раз»
}
