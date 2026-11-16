import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

if (existsSync(".env.test.local")) process.loadEnvFile(".env.test.local");

if (process.env.PORTAL_TEST_MODE !== "1")
  throw new Error(
    "Browser integration tests require the isolated ./portal test command; development data are preserved.",
  );

const stage = process.env.PORTAL_BROWSER_STAGE;
if (stage && !["application", "pwa"].includes(stage))
  throw new Error("Unknown isolated browser acceptance stage.");
const reportRoot = stage ? `.local/browser/${stage}` : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  failOnFlakyTests: true,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: reportRoot ? `${reportRoot}/results` : "test-results",
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        ...(reportRoot ? { outputFolder: `${reportRoot}/html` } : {}),
      },
    ],
    ...(reportRoot
      ? ([["json", { outputFile: `${reportRoot}/report.json` }]] as [
          string,
          { outputFile: string },
        ][])
      : []),
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
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
    ? undefined
    : {
        command: "npm run dev -- --port 5173 --strictPort",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
});
