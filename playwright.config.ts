import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4390', locale: 'en-US' },
  webServer: {
    // Тести йдуть по зібраному сайту, як на проді. Окремий порт, щоб не заважати dev-серверу Романа (4321).
    command: 'npm run build && npx astro preview --port 4390',
    // Збірка на tests/fixtures/seed.json і з фальшивою адресою Supabase: тести ніколи не зачеплять справжню базу,
    // а все, що йде в Supabase, підміняється в самих тестах (page.route).
    env: { ABAWKA_TEST_DATA: '1', PUBLIC_SUPABASE_URL: 'https://abawka-test.supabase.co', PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key' },
    url: 'http://localhost:4390/en/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
