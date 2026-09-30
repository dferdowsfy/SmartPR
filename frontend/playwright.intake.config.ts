import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/intake',
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:3110',
    viewport: { width: 1440, height: 1024 },
    channel: 'chrome',
    permissions: ['microphone'],
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
    screenshot: 'only-on-failure',
  },
  webServer: { command: 'npm run dev -- --hostname 127.0.0.1 --port 3110', url: 'http://127.0.0.1:3110', reuseExistingServer: true, timeout: 120000 },
});
