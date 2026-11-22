import { expect, test, type Locator } from "@playwright/test";
import { actor, api, checked, login } from "./helpers/accounts-support";

async function expectInsideViewport(panel: Locator) {
  await expect(panel).toBeVisible();
  const position = await panel.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      left: bounds.left,
      right: window.innerWidth - bounds.right,
      top: bounds.top,
      bottom: window.innerHeight - bounds.bottom,
    };
  });
  for (const [edge, distance] of Object.entries(position))
    expect(distance, `${edge} edge stays in view`).toBeGreaterThanOrEqual(-1);
}

test("mobile header panels fit a wrapped toolbar and return keyboard focus", async ({
  page,
}) => {
  const admin = await actor("Fictional mobile administrator", "admin");
  try {
    await page.setViewportSize({ width: 320, height: 600 });
    await login(page, admin.email);
    const skipLink = page.locator(".skip-link");
    await expect(skipLink).toHaveCSS("clip-path", "inset(50%)");
    await page.keyboard.press("Tab");
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toHaveCSS("clip-path", "none");
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
    const header = page.locator(".topbar");
    const language = header.getByLabel(/^(Sprache|Language)$/);
    const theme = header.getByLabel(/^(Farbschema|Theme)$/);
    const account = header.locator(".account-menu");
    const more = header.locator(".mobile-more");
    const bell = header.locator(".notification-menu");

    for (const [locale, appearance] of [
      ["de", "light"],
      ["en", "dark"],
    ]) {
      await language.selectOption(locale);
      await theme.selectOption(appearance);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        appearance,
      );

      const accountTrigger = account.locator("summary");
      await accountTrigger.click();
      await expectInsideViewport(account.locator(".account-menu-panel"));
      await account.getByRole("link").first().focus();
      await page.keyboard.press("Escape");
      await expect(accountTrigger).toBeFocused();
      await expect(account).toHaveJSProperty("open", false);

      await expect(
        header.getByRole("combobox", {
          name: /^(Navigationsvorschau|Navigation preview)$/,
        }),
      ).toHaveCount(0);

      await bell.locator("summary").click();
      await expectInsideViewport(bell.locator(".notification-popover"));
      await more.locator("summary").click();
      await expect(bell).toHaveJSProperty("open", false);
      await expectInsideViewport(more.locator(".mobile-menu-panel"));
      await expect(header.getByRole("search")).toHaveCount(1);
      await expect(header.locator(".notification-menu")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(more).toHaveJSProperty("open", false);
    }

    await page.goto("/admin/people");
    const peopleSearch = page.locator("#people-search");
    await expect(peopleSearch).toBeVisible();
    const widths = await peopleSearch.evaluate((element) => ({
      field: element.getBoundingClientRect().right,
      page: document.documentElement.scrollWidth,
    }));
    expect(widths.field).toBeLessThanOrEqual(320);
    expect(widths.page).toBeLessThanOrEqual(320);
  } finally {
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    await checked(service.auth.admin.deleteUser(admin.id));
  }
});
