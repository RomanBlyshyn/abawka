// Юридичні документи: HTML з src/legal/<мова>/<документ>.html (англійська — оригінал, решта — переклад DeepL)
// з підстановками <var>…</var>, які заповнюємо даними продавця (src/data/shop.json).
import type { Locale } from '../i18n/config';
import { BASE_CURRENCY } from './data';
import { hours, shop } from './shop';

export type LegalDoc = 'terms' | 'privacy' | 'returns';
const files = import.meta.glob('../legal/*/*.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Labels { todo: string; email: string; phone: string }

export function legalHtml(doc: LegalDoc, locale: Locale, labels: Labels): string {
  const raw = files[`../legal/${locale}/${doc}.html`] ?? files[`../legal/en/${doc}.html`];
  if (!raw) throw new Error(`Немає документа ${doc}`);
  const todo = `<mark class="todo" data-todo>[${esc(labels.todo)}]</mark>`;
  const country = new Intl.DisplayNames([locale], { type: 'region' }).of('PL') ?? shop.address.country;
  const a = shop.address;
  const address = `${esc(a.street)}, ${a.postcode ? esc(a.postcode) : todo} ${esc(a.city)}, ${esc(country)}`;
  const email = shop.email ? `<a href="mailto:${esc(shop.email)}">${esc(shop.email)}</a>` : todo;
  const phone = shop.phone ? `<a href="tel:${esc(shop.phone.replace(/\s/g, ''))}">${esc(shop.phone)}</a>` : todo;
  const vars: Record<string, string> = {
    seller: esc(shop.seller),
    address,
    city: esc(a.city),
    country: esc(country),
    hours: esc(hours),
    currency: esc(BASE_CURRENCY),
    email,
    phone,
    updated: `<time datetime="${shop.legalUpdated}">${esc(new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(shop.legalUpdated)))}</time>`,
    'seller-block': `<address class="seller"><b>${esc(shop.seller)}</b><br>${address}<br>${esc(labels.email)}: ${email}<br>${esc(labels.phone)}: ${phone}</address>`,
  };
  return raw
    .replace(/^<!--[\s\S]*?-->\s*/, '')
    .replace(/<var>([a-z-]+)<\/var>/g, (_, name: string) => {
      if (!(name in vars)) throw new Error(`Невідома підстановка <var>${name}</var> у ${locale}/${doc}`);
      return vars[name]!;
    })
    .replace(/href="([a-z0-9-]+\/)"/g, `href="/${locale}/$1"`);
}
