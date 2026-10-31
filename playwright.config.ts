import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4322', locale: 'en-US' },
  webServer: {
    // Тести йдуть по зібраному сайту, як на проді. Окремий порт, щоб не заважати dev-серверу.
    command: 'npm run build && npx astro preview --port 4322',
    url: 'http://localhost:4322/en/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
