// Текст заявки для Telegram (функція supabase/functions/telegram) — без браузера.
import { expect, test } from '@playwright/test';
import { requestMessage, type RequestRow } from '../../supabase/functions/telegram/message';

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

test('request message: buyer text cannot break the markup', () => {
  const text = requestMessage(row({ name: '<b>Bob</b> & Co', comment: 'Подзвоніть <після 18>' }));
  expect(text).toContain('👤 &lt;b&gt;Bob&lt;/b&gt; &amp; Co');
  expect(text).toContain('💬 Подзвоніть &lt;після 18&gt;');
});
