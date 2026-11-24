/** Public sign-in controls keep their contrast and position when installation is offered. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("sign-in language and theme remain readable below the install offer", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    localStorage.setItem("luminovia.language", "de");
    localStorage.setItem("luminovia.theme", "system");
  });
  if (testInfo.project.name === "mobile-chromium") {
    await page.setViewportSize({ width: 320, height: 740 });
  }
  await page.goto("/login");
  const language = page.getByRole("combobox", { name: "Sprache" });
  const theme = page.getByRole("combobox", { name: "Farbschema" });
  const installation = page.getByRole("group", { name: "App-Installation" });
  const html = page.locator("html");
  await expect(theme).toHaveValue("system");
  await expect(html).toHaveAttribute("data-theme", "dark");

  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.defineProperty(event, "prompt", { value: async () => undefined });
    window.dispatchEvent(event);
  });
  await expect(installation).toBeVisible();
  const banner = (await installation.boundingBox())!;
  for (const control of [language, theme]) {
    const bounds = (await control.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(banner.y + banner.height);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerWidth),
    );
    await expect(control).toHaveCSS("color-scheme", "dark");
    expect(
      await control.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).not.toBe("rgba(0, 0, 0, 0)");
  }
  expect(
    (
      await new AxeBuilder({ page })
        .include(".login-preferences")
        .withRules(["color-contrast"])
        .analyze()
    ).violations,
  ).toEqual([]);

  await language.press("Tab");
  await expect(theme).toBeFocused();
  await theme.selectOption("light");
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(theme).toHaveCSS("color-scheme", "light");
  await language.selectOption("en");
  await expect(page.getByRole("combobox", { name: "Language" })).toHaveValue(
    "en",
  );
  await page.getByRole("button", { name: "Later", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "App installation" }),
  ).toBeHidden();
  await expect(page.getByRole("combobox", { name: "Theme" })).toBeVisible();
});
