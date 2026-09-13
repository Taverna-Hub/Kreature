import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", fullyParallel: true, workers: 2,
  use: { baseURL: "http://127.0.0.1:4174", screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium", channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || undefined } }, { name: "webkit", use: { browserName: "webkit" } }],
  webServer: { command: "npx vite --config e2e/vite.config.ts --host 127.0.0.1 --port 4174", url: "http://127.0.0.1:4174", reuseExistingServer: !process.env.CI },
});
