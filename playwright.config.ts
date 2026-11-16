/** Reale Browserabläufe für den eigenen QA-Stack, getrennt von Entwicklungsdaten. */
import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// Die private Datei erzeugt der Launcher pro Umgebung; sie gehört nicht in Git.
if (existsSync(".env.test.local")) process.loadEnvFile(".env.test.local");

// Direktes Playwright gegen einen normalen persistenten Stack wird abgewiesen.
if (process.env.PORTAL_TEST_MODE !== "1")
  throw new Error(
    "Browser integration tests require the isolated ./portal test command; development data are preserved.",
  );

export default defineConfig({
  testDir: "./tests/e2e",
  // Die Szenarien verändern echte fiktive Datensätze. Eine sequenzielle Suite
  // hält ihre Ressourcen nachvollziehbar; fehlgeschlagene Fälle werden nicht kaschiert.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    // Fehlerartefakte können private QA-Sessions enthalten und bleiben ignoriert.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Beide Chromium-Layouts laufen dieselben Abläufe; dies belegt keine
    // physische PWA-Installation oder Safari-/iOS-Kompatibilität.
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
    ? // Der Gesamtprüflauf betreibt seinen eigenen überwachten Server. Nur ohne
      // explizite URL startet Playwright den hier beschriebenen Vite-Prozess.
      undefined
    : {
        command: "npm run dev -- --port 5173 --strictPort",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
});
