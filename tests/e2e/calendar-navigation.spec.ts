/** Exercise native date jumps across display zones without an event mutation. */
import { expect, test } from "@playwright/test";
import { withApiFixture } from "../../scripts/testing/api.mjs";
import { login } from "./helpers/accounts-support";

test("calendar jumps to a civil date, keeps the view and restores keyboard focus", async ({
  page,
}) => {
  await withApiFixture(async ({ actor }) => {
    const lecturer = await actor("fictional-calendar-navigation", "lecturer");
    await login(page, lecturer.email);
    await page.goto("/calendar");

    const dayView = page
      .getByRole("group", { name: "Kalenderansicht" })
      .getByRole("button", { name: "Tag", exact: true });
    await dayView.click();
    const choose = page.getByRole("button", { name: "Datum wählen" });
    await choose.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Datum wählen" });
    const date = dialog.getByLabel("Datum", { exact: true });
    await expect(date).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    // Berlin switches clocks on this day. Navigation uses a civil date, so
    // selecting another display zone must not move the calendar to another day.
    await date.fill("2030-10-27");
    await dialog.getByRole("button", { name: "Datum anzeigen" }).click();
    await expect(dialog).toBeHidden();
    await expect(choose).toBeFocused();
    await expect(dayView).toHaveAttribute("aria-pressed", "true");
    const column = page.locator('.fc-timegrid-col[data-date="2030-10-27"]');
    await expect(column).toBeVisible();
    await page
      .locator("#calendar-display-zone")
      .selectOption("Australia/Brisbane");
    await expect(column).toBeVisible();
    await expect(dayView).toHaveAttribute("aria-pressed", "true");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });
});
