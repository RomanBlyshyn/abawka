// Перевіряє, що кожна з 9 мов має всі ключі інтерфейсу, усі форми множини й усі тексти в даних.
import { readFileSync } from 'node:fs';

const LOCALES = ['pl', 'en', 'uk', 'de', 'cs', 'lt', 'es', 'fr', 'ru'];
const read = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
const dicts = Object.fromEntries(LOCALES.map((l) => [l, read(`src/i18n/${l}.json`)]));

const pluralKeys = new Set();
const keys = new Set();
for (const d of Object.values(dicts)) {
  for (const k of Object.keys(d)) {
    const m = k.match(/^(.*)\.(zero|one|two|few|many|other)$/);
    m ? pluralKeys.add(m[1]) : keys.add(k);
  }
}

const missing = [];
for (const l of LOCALES) {
  const d = dicts[l];
  for (const k of keys) if (!d[k]) missing.push(`${l}: ${k}`);
  const forms = new Set([0, 1, 2, 3, 5, 11, 21, 22, 25, 1.5].map((n) => new Intl.PluralRules(l).select(n)));
  for (const base of pluralKeys) for (const f of forms) if (!d[`${base}.${f}`]) missing.push(`${l}: ${base}.${f}`);
}

const seed = read('src/data/seed.json');
const texts = [
  ...seed.categories.map((c) => [`category ${c.slug}`, c.name]),
  ...seed.products.map((p) => [`product ${p.slug}`, p.name]),
  ...seed.reviews.map((r) => [`review ${r.product}`, r.text]),
];
for (const [what, t] of texts) for (const l of LOCALES) if (!t[l]) missing.push(`${l}: ${what}`);

if (missing.length) {
  console.error(`Missing translations (${missing.length}):\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log(`i18n OK: ${LOCALES.length} locales, ${keys.size} keys, ${pluralKeys.size} plural keys, ${texts.length} data texts`);
