// Текст заявки для Telegram (функція supabase/functions/telegram) — без браузера.
import { expect, test } from '@playwright/test';
import { requestMessage, reviewMessage, type RequestRow } from '../../supabase/functions/telegram/message';

const row = (over: Partial<RequestRow> = {}): RequestRow => ({
  id: 1007, locale: 'pl', name: 'Anna', method: 'telegram', contact: '@anna_k', country: 'PL', delivery: 'inpost', comment: '',
  currency: 'EUR', total: 7497,
  items: [
    { slug: 'toy-sword', name: { uk: 'Іграшковий меч', en: 'Toy sword' }, price: 1999, qty: 2 },
    { slug: 'chess', name: { en: 'Chess set' }, price: 3499, qty: 1 },
  ],
  ...over,
});

test('request message: items, total, contact and delivery in Ukrainian', () => {
  const text = requestMessage(row());
  expect(text).toContain('<b>Нова заявка №1007</b>');
  expect(text).toMatch(/• Іграшковий меч × 2 — 39,98\s€/);
  expect(text).toContain('• Chess set × 1'); // немає української назви — англійська
  expect(text).toMatch(/<b>Разом: 74,97\s€<\/b>/);
  expect(text).toContain('📞 Telegram: @anna_k');
  expect(text).toContain('📦 Польща · InPost');
  expect(text).toContain('мова сайту: PL');
  expect(text).not.toContain('💬');
});

test('request message: delivery arranged personally shows just the country', () => {
  expect(requestMessage(row({ delivery: 'discuss' }))).toContain('📦 Польща\n');
});

test('request message: promo code and discount before the total', () => {
  const text = requestMessage(row({ promo_code: 'SAVE10', discount: 750, total: 6747 }));
  expect(text).toMatch(/🎟 Промокод SAVE10: −7,50\s€\n<b>Разом: 67,47\s€<\/b>/);
});

test('request message: buyer text cannot break the markup', () => {
  const text = requestMessage(row({ name: '<b>Bob</b> & Co', comment: 'Подзвоніть <після 18>' }));
  expect(text).toContain('👤 &lt;b&gt;Bob&lt;/b&gt; &amp; Co');
  expect(text).toContain('💬 Подзвоніть &lt;після 18&gt;');
});

test('review message: stars, product or shop, author and text, safe markup', () => {
  const text = reviewMessage({ author: 'Olena <3', rating: 4, body: { uk: 'Супер & швидко' }, locale: 'uk', product: { name: { uk: 'Шахи', en: 'Chess' } } });
  expect(text).toContain('★★★★☆ · Шахи');
  expect(text).toContain('👤 Olena &lt;3');
  expect(text).toContain('💬 Супер &amp; швидко');
  expect(reviewMessage({ author: 'A', rating: 5, body: { pl: 'Świetny sklep' }, locale: 'pl', product: null })).toContain('★★★★★ · про магазин');
});
