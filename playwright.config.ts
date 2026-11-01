import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:8765/Ian-s-Angels/',
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --port 8765',
    url: 'http://127.0.0.1:8765/Ian-s-Angels/index.html',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
