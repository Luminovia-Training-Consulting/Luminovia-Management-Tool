/** Native operational navigation retains sensible destinations for retired module links. */
import { expect, test } from "@playwright/test";
import { withApiFixture } from "../../scripts/testing/api.mjs";
import { login } from "./helpers/accounts-support";

test("retired module links reach current operational pages and header search works with a collapsed rail", async ({
  page,
}) => {
  await withApiFixture(async ({ actor }) => {
    const teacher = await actor("Fictional operational navigation", "lecturer");
    await login(page, teacher.email);
    for (const [retired, destination] of [
      ["/availability", "/calendar"],
      ["/delivery", "/courses"],
      ["/timesheets", "/finance"],
      ["/workbench", "/"],
    ]) {
      await page.goto(retired);
      await expect(page).toHaveURL(
        new RegExp(`${destination === "/" ? "/" : destination}$`),
      );
      await expect(page.locator("main h1").first()).toBeVisible();
    }
    const collapse = page.getByRole("button", {
      name: /Navigation einklappen|Collapse navigation/,
    });
    if (await collapse.isVisible()) await collapse.click();
    await page.locator("#portal-global-search").fill("Fictional");
    await page.locator("#portal-global-search").press("Enter");
    await expect(page).toHaveURL(/\/search\?q=Fictional/);
    expect(await page.locator(".sidebar .global-search").count()).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });
});
