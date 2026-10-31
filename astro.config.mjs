// @ts-check
import { defineConfig } from 'astro/config';
import { LOCALES, DEFAULT_LOCALE } from './src/i18n/config.ts';

export default defineConfig({
  site: 'https://abawka.example', // TODO: справжній домен на етапі 8
  trailingSlash: 'always',
  i18n: {
    locales: [...LOCALES],
    defaultLocale: DEFAULT_LOCALE,
    // корінь "/" обробляє src/pages/index.astro (мова з браузера)
    routing: { prefixDefaultLocale: true, redirectToDefaultLocale: false },
  },
});
