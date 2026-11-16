/** Real browser workflows on the owned QA stack, isolated from development data. */
import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// The launcher creates this private per-environment file; it must stay out of Git.
if (existsSync(".env.test.local")) process.loadEnvFile(".env.test.local");

// Reject direct Playwright runs against a normal persistent development stack.
if (process.env.PORTAL_TEST_MODE !== "1")
  throw new Error(
    "Browser integration tests require the isolated ./portal test command; development data are preserved.",
  );

export default defineConfig({
  testDir: "./tests/e2e",
  // Scenarios mutate real fictional records. Sequential execution keeps resource
  // ownership traceable; failed cases are not hidden with retries.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    // Failure artifacts may contain private QA sessions and remain ignored.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Both Chromium layouts run the same journeys; this does not establish
    // physical PWA installation or Safari/iOS compatibility.
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? // The complete runner owns its supervised server. Playwright starts the
      // Vite process below only when no explicit URL was supplied.
      undefined
    : {
        command: "npm run dev -- --port 5173 --strictPort",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
});
