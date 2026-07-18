import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  webServer: {
    command: "pnpm db:migrate && pnpm dev --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { AI_PROVIDER: "mock", DATABASE_PATH: "./data/e2e-intervaiew.db" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
