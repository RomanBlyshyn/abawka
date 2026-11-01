// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { LOCALES, DEFAULT_LOCALE } from './src/i18n/config.ts';

export default defineConfig({
  // Справжній домен задається змінною SITE_URL на хостингу; заглушка — для локальної збірки й тестів.
  site: process.env.SITE_URL || 'https://abawka.example',
  trailingSlash: 'always',
  // Збірка на тестових даних іде в окрему папку, щоб її не можна було випадково задеплоїти замість справжньої.
  outDir: process.env.ABAWKA_TEST_DATA === '1' ? 'dist-test' : 'dist',
  integrations: [
    sitemap({
      // У пошук — лише сторінки для покупців: без адмінки, кошика, «Дякуємо», 404 і перекладних копій англійських документів.
      filter: (page) => {
        const path = new URL(page).pathname;
        if (/^\/admin\/|\/(cart|thanks|404)\/$/.test(path)) return false;
        if (/^\/(?!en\/)[a-z]{2}\/(terms|privacy|returns)\/$/.test(path)) return false;
        return path !== '/';
      },
      i18n: { defaultLocale: DEFAULT_LOCALE, locales: Object.fromEntries(LOCALES.map((l) => [l, l])) },
    }),
  ],
  i18n: {
    locales: [...LOCALES],
    defaultLocale: DEFAULT_LOCALE,
    // корінь "/" обробляє src/pages/index.astro (мова з браузера)
    routing: { prefixDefaultLocale: true, redirectToDefaultLocale: false },
  },
});
