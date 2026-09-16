import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/voice",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: process.env.VOICE_TEST_URL || "http://localhost:3107",
    viewport: { width: 1280, height: 900 },
    permissions: ["microphone"],
    launchOptions: {
      ...(process.env.VOICE_TEST_CHROME ? { executablePath: process.env.VOICE_TEST_CHROME } : {}),
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 3107",
    url: "http://localhost:3107",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
