// @ts-check
import { defineConfig } from 'astro/config';
import { LOCALES, DEFAULT_LOCALE } from './src/i18n/config.ts';

export default defineConfig({
  site: 'https://abawka.example', // TODO: справжній домен на етапі 8
  trailingSlash: 'always',
  // Збірка на тестових даних іде в окрему папку, щоб її не можна було випадково задеплоїти замість справжньої.
  outDir: process.env.ABAWKA_TEST_DATA === '1' ? 'dist-test' : 'dist',
  i18n: {
    locales: [...LOCALES],
    defaultLocale: DEFAULT_LOCALE,
    // корінь "/" обробляє src/pages/index.astro (мова з браузера)
    routing: { prefixDefaultLocale: true, redirectToDefaultLocale: false },
  },
});
