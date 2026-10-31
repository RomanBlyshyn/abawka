import type { RequestInput } from './request';

export interface SubmitResult { id: string; demo: boolean }

/**
 * Надсилає заявку. Поки немає сервера (етап 3), працює демо-режим: нічого не відправляє,
 * але поводиться як справжній запит — з затримкою і помилкою, якщо немає мережі.
 */
export async function submitRequest(input: RequestInput & { locale: string; website: string }): Promise<SubmitResult> {
  const url = import.meta.env.PUBLIC_REQUEST_URL as string | undefined;
  if (url) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { id: String(data.id), demo: false };
  }

  await new Promise((r) => setTimeout(r, 400));
  if (!navigator.onLine) throw new Error('offline');
  return { id: `D-${Math.floor(100000 + Math.random() * 900000)}`, demo: true };
}
