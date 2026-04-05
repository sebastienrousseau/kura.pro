import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'scripts/tests/visual',
  snapshotDir: 'scripts/tests/visual/snapshots',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8788',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } },
    },
  ],
});
