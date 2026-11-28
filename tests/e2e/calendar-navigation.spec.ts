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
    const requestedWindows = {
      personal_events: [],
      assignment_sessions: [],
    } as Record<string, string[]>;
    page.on("request", (request) => {
      const url = new URL(request.url());
      const source = url.pathname.split("/").at(-1);
      const windowStart = url.searchParams.get("ends_at");
      if (source && windowStart && Object.hasOwn(requestedWindows, source)) {
        requestedWindows[source].push(windowStart);
      }
    });
    const firstWindow = Promise.all(
      Object.keys(requestedWindows).map((source) =>
        page.waitForResponse((response) => {
          const url = new URL(response.url());
          return (
            url.pathname.endsWith(`/rest/v1/${source}`) &&
            url.searchParams.has("ends_at") &&
            response.ok()
          );
        }),
      ),
    );
    await page.goto("/calendar");
    await firstWindow;
    expect(requestedWindows.personal_events).toHaveLength(1);
    expect(requestedWindows.assignment_sessions).toHaveLength(1);

    const tools = page.locator(".calendar-tools");
    const toolsToggle = tools.locator("summary").first();
    await expect(tools.locator("details")).toHaveCount(0);
    if (page.viewportSize()!.width <= 640) {
      expect((await toolsToggle.boundingBox())!.height).toBeGreaterThanOrEqual(
        44,
      );
    }
    await toolsToggle.press("Enter");
    await expect(
      tools.locator(".calendar-tools-content > details"),
    ).toHaveCount(5);
    await toolsToggle.press("Enter");
    await expect(tools).not.toHaveAttribute("open");
    await expect(
      tools.locator(".calendar-tools-content > details"),
    ).toHaveCount(5);

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
