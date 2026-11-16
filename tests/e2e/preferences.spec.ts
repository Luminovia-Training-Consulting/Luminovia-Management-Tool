/**
 * Browserabläufe für Sprach-/Theme-Bedienung bei blockierter Browserablage.
 * Die Assertions prüfen tatsächliche Oberfläche und Serverantworten; ihre Ausführung ersetzt keine manuelle Plattformabnahme.
 */
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Run through ./portal test in its isolated environment.",
);

test("blocked preference storage still permits boot, language and theme controls", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Fictional storage denial", "SecurityError");
      },
    });
  });
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "Anmelden", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("E-Mail", { exact: true })
    .fill("draft@example.invalid");
  await page.getByLabel("Sprache", { exact: true }).selectOption("en");
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "draft@example.invalid",
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(errors).toEqual([]);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations.map(({ id }) => id)).toEqual([]);
  await page.screenshot({
    path: `docs/screenshots/${testInfo.project.name}-storage-resilience.png`,
    fullPage: true,
  });
});
