// Кошик у браузері (localStorage). Тільки для зручності покупця: суму й наявність перераховує сервер при заявці.
export interface CartLine { slug: string; qty: number }

const KEY = 'cart';
export const MAX_QTY = 99;
export const CART_EVENT = 'cart:change';

export function readCart(): CartLine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((l) => l && typeof l.slug === 'string' && Number.isInteger(l.qty) && l.qty > 0)
      .map((l) => ({ slug: l.slug, qty: Math.min(l.qty, MAX_QTY) }));
  } catch {
    return [];
  }
}

export function writeCart(lines: CartLine[]): void {
  const clean = lines.filter((l) => l.qty > 0);
  try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch { /* приватний режим: кошик живе до перезавантаження */ }
  window.dispatchEvent(new CustomEvent(CART_EVENT, { detail: clean }));
}

/** Додає товар; не більше, ніж є на складі (stock) і не більше MAX_QTY. Повертає нову кількість. */
export function addToCart(slug: string, qty: number, stock: number): number {
  const lines = readCart();
  const line = lines.find((l) => l.slug === slug);
  const limit = Math.min(stock, MAX_QTY);
  const next = Math.min((line?.qty ?? 0) + qty, limit);
  if (line) line.qty = next;
  else lines.push({ slug, qty: next });
  writeCart(lines);
  return next;
}

export function setQty(slug: string, qty: number): void {
  writeCart(readCart().map((l) => (l.slug === slug ? { ...l, qty: Math.max(0, Math.min(qty, MAX_QTY)) } : l)));
}

export const cartCount = (lines = readCart()) => lines.reduce((n, l) => n + l.qty, 0);

// Застосований промокод — до кінця сесії вкладки. Знижку все одно перераховує сервер.
const PROMO_KEY = 'promo';
export function readPromo(): string {
  try { return sessionStorage.getItem(PROMO_KEY) ?? ''; } catch { return ''; }
}
export function writePromo(code: string): void {
  try { if (code) sessionStorage.setItem(PROMO_KEY, code); else sessionStorage.removeItem(PROMO_KEY); } catch { /* приватний режим */ }
  window.dispatchEvent(new CustomEvent(CART_EVENT, { detail: readCart() }));
}
