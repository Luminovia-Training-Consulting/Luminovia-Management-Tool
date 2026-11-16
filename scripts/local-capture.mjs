/**
 * Erzeugt lokale Browseraufnahmen für die visuelle Entwicklungsprüfung.
 * Zugänge stammen aus der privaten Testkonfiguration; Aufnahmen sind keine Produktionsabnahme.
 */
import { chromium, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";

process.loadEnvFile(".env.test.local");
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(baseURL).hostname)) {
  throw new Error(
    "Local screenshot capture only permits loopback frontend URLs.",
  );
}
mkdirSync("docs/screenshots", { recursive: true });
const browser = await chromium.launch();
try {
  for (const [name, device] of [
    ["desktop-chromium", { viewport: { width: 1440, height: 1000 } }],
    ["mobile-chromium", devices["Pixel 7"]],
  ]) {
    const context = await browser.newContext({ ...device, baseURL });
    const page = await context.newPage();
    await page.goto("/login");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `docs/screenshots/${name}-login.png`,
      fullPage: true,
    });
    await page
      .getByLabel("E-Mail", { exact: true })
      .fill(process.env.E2E_LECTURER_EMAIL);
    await page
      .getByLabel("Passwort", { exact: true })
      .fill(process.env.E2E_PASSWORD);
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    await page
      .getByRole("heading", { name: /Schön, dass du da bist/ })
      .waitFor();
    await page
      .getByText("Python – Grundlagen in fünf Tagen", { exact: true })
      .first()
      .waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `docs/screenshots/${name}-dashboard.png`,
      fullPage: true,
    });
    await page.goto("/jobs");
    await page
      .getByRole("searchbox", { name: "Stellen durchsuchen", exact: true })
      .waitFor();
    await page
      .getByRole("link", {
        name: "Python – Grundlagen in fünf Tagen",
        exact: true,
      })
      .waitFor();
    await page.screenshot({
      path: `docs/screenshots/${name}-jobs.png`,
      fullPage: true,
    });
    await page.goto("/calendar");
    await page
      .getByRole("button", { name: "Privaten Termin hinzufügen", exact: true })
      .waitFor();
    await page.locator(".fc").waitFor();
    await page.screenshot({
      path: `docs/screenshots/${name}-calendar.png`,
      fullPage: true,
    });
    await page.goto("/profile");
    await page.getByLabel("Über mich (Deutsch)", { exact: true }).waitFor();
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await page.evaluate(async () => {
      void getComputedStyle(document.documentElement).color;
      await Promise.all(
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect?.getTiming().iterations !== Infinity,
          )
          .map((animation) => animation.finished.catch(() => undefined)),
      );
    });
    await page.screenshot({
      path: `docs/screenshots/${name}-profile-dark-en.png`,
      fullPage: true,
    });
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(
  "Captured fresh local desktop/mobile login, dashboard, jobs, calendar and English dark profile. No profile, calendar or job records were changed.",
);
