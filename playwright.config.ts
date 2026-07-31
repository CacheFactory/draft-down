import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e-playwright',
  timeout: 30000,
  globalTimeout: 600000,
  retries: 0,
  workers: 1,
  expect: {
    timeout: 5000,
  },
});
