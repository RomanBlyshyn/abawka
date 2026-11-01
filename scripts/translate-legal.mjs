// Перекласти юридичні документи з англійської (src/legal/en/*.html) на інші 8 мов через DeepL.
// Ключ DEEPL_API_KEY читає з .env і не виводить. Перекладає лише змінені документи (src/legal/hashes.json).
//   node scripts/translate-legal.mjs          — змінені документи
//   node scripts/translate-legal.mjs --all    — усе заново
// <var>…</var> — підстановки (ім'я продавця, адреса тощо): DeepL їх не чіпає.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const env = Object.fromEntries(
  readFileSync(new URL('.env', root), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const key = env.DEEPL_API_KEY;
if (!key) throw new Error('DEEPL_API_KEY порожній у .env');
const api = key.endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';
const TARGETS = { pl: 'PL', uk: 'UK', de: 'DE', cs: 'CS', lt: 'LT', es: 'ES', fr: 'FR', ru: 'RU' };

// DeepL інколи рве посилання посеред слова («розді<a>л …») чи на два поруч і з'їдає пробіл біля <var>.
const tidy = (html) => html
  .replace(/(\p{L}+)<a href="([^"]+)">/gu, '<a href="$2">$1')
  .replace(/<\/a>(\p{L}+)/gu, '$1</a>')
  .replace(/<\/a>(\s*)<a href="[^"]+">/g, '$1')
  .replace(/(\p{L})<var>/gu, '$1 <var>')
  .replace(/<\/var>(\p{L})/gu, '</var> $1');
const dir = (lang) => new URL(`src/legal/${lang}/`, root);
const hashFile = new URL('src/legal/hashes.json', root);
const hashes = existsSync(hashFile) ? JSON.parse(readFileSync(hashFile, 'utf8')) : {};
const all = process.argv.includes('--all');

for (const file of readdirSync(dir('en')).filter((f) => f.endsWith('.html'))) {
  const source = readFileSync(new URL(file, dir('en')), 'utf8');
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 16);
  if (!all && hashes[file] === hash && Object.keys(TARGETS).every((l) => existsSync(new URL(file, dir(l))))) {
    console.log(`${file}: без змін`);
    continue;
  }
  for (const [lang, target] of Object.entries(TARGETS)) {
    const res = await fetch(api, {
      method: 'POST',
      headers: { authorization: `DeepL-Auth-Key ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: [source], source_lang: 'EN', target_lang: target, tag_handling: 'html', ignore_tags: ['var'] }),
    });
    if (!res.ok) throw new Error(`DeepL ${lang}/${file}: HTTP ${res.status}`);
    const { translations } = await res.json();
    const out = tidy(translations[0].text);
    // Підстановки мають дійти цілими — інакше на сторінці зникне ім'я чи адреса продавця.
    const vars = (s) => [...s.matchAll(/<var>([a-z-]+)<\/var>/g)].map((m) => m[1]).sort().join(',');
    if (vars(out) !== vars(source)) throw new Error(`${lang}/${file}: DeepL змінив підстановки <var>`);
    mkdirSync(dir(lang), { recursive: true });
    writeFileSync(new URL(file, dir(lang)), `<!-- Машинний переклад з ../en/${file} (DeepL). Не редагувати вручну: npm run legal:translate -->\n${out}`);
    console.log(`${file} → ${lang}`);
  }
  hashes[file] = hash;
}
writeFileSync(hashFile, JSON.stringify(hashes, null, 2) + '\n');
