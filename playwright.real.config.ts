import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests-real",
  timeout: 12 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:3200",
    launchOptions: { executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "real-customer-desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node --env-file-if-exists=.env.local scripts/test-stack.mjs --port=3200",
    url: "http://127.0.0.1:3200/login",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
