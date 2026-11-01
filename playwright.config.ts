import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4390', locale: 'en-US' },
  webServer: {
    // Тести йдуть по зібраному сайту, як на проді. Окремий порт, щоб не заважати dev-серверу Романа (4321).
    command: 'npm run build && npx astro preview --port 4390',
    env: { ABAWKA_TEST_DATA: '1' }, // збірка на tests/fixtures/seed.json
    url: 'http://localhost:4390/en/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
