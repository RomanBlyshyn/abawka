// Текст повідомлення про заявку для Telegram (HTML-розмітка). Без Deno API — тестується в Node.
export interface RequestRow {
  id: number; locale: string; name: string; method: string; contact: string; country: string; delivery: string;
  comment: string; currency: string; total: number;
  items: { slug: string; name: Record<string, string>; price: number; qty: number }[];
}

const METHOD: Record<string, string> = { call: 'Дзвінок', telegram: 'Telegram', viber: 'Viber', whatsapp: 'WhatsApp', email: 'Email' };
const DELIVERY: Record<string, string> = {
  discuss: 'обговорити', inpost: 'InPost', dpd: 'DPD', dhl: 'DHL', orlen: 'Orlen Paczka', 'poczta-polska': 'Poczta Polska',
  'nova-poshta': 'Нова пошта', ukrposhta: 'Укрпошта', 'courier-wroclaw': "кур'єр по Вроцлаву",
};

/** Текст покупця не повинен ламати розмітку Telegram. */
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function requestMessage(r: RequestRow): string {
  const money = (cents: number) => new Intl.NumberFormat('uk', { style: 'currency', currency: r.currency, currencyDisplay: 'narrowSymbol' }).format(cents / 100);
  const title = (n: Record<string, string>, slug: string) => n.uk ?? n.en ?? Object.values(n)[0] ?? slug;
  let country = r.country;
  try { country = new Intl.DisplayNames(['uk'], { type: 'region' }).of(r.country) ?? r.country; } catch { /* лишаємо код */ }
  const lines = [
    `🧸 <b>Нова заявка №${r.id}</b>`,
    '',
    ...r.items.map((i) => `• ${esc(title(i.name, i.slug))} × ${i.qty} — ${money(i.price * i.qty)}`),
    `<b>Разом: ${money(r.total)}</b>`,
    '',
    `👤 ${esc(r.name)}`,
    `📞 ${METHOD[r.method] ?? esc(r.method)}: ${esc(r.contact)}`,
    // Доставку власник узгоджує з покупцем сам; старі заявки могли мати вибраного перевізника.
    `📦 ${esc(country)}${r.delivery === 'discuss' ? '' : ` · ${esc(DELIVERY[r.delivery] ?? r.delivery)}`}`,
  ];
  if (r.comment) lines.push(`💬 ${esc(r.comment)}`);
  lines.push(`🌐 мова сайту: ${r.locale.toUpperCase()}`);
  return lines.join('\n');
}
