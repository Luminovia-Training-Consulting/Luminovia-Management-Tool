/**
 * Browser workflows for private blocked time, own notes and reduced management sharing.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import {
  actor,
  adminLogin,
  api,
  checked,
  login,
} from "./helpers/accounts-support";
test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Only canonical isolated availability workflows are permitted.",
);
/** Checks the rendered state with axe; this does not replace manual accessibility acceptance. */
async function a11y(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const report = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    report.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
test("private blockout editing and explicit management sharing retain notes and draft privacy", async ({
  page,
  browser,
  context,
}, testInfo) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8),
    teacher = await actor(`Availability lecturer ${suffix}`, "lecturer"),
    admin = await actor(`Availability manager ${suffix}`, "admin"),
    service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
    note = `Fictional PRIVATE availability note ${suffix}`;
  let managerContext:
    Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    await login(page, teacher.email);
    await page.goto("/availability");
    await page
      .getByRole("button", { name: "Zeitfenster hinzufügen", exact: true })
      .click();
    await page
      .getByLabel("Status", { exact: true })
      .selectOption("unavailable");
    const day = DateTime.now()
      .setZone("Europe/Berlin")
      .startOf("month")
      .plus({ days: 2 })
      .toISODate()!;
    await page.getByLabel("Beginn", { exact: true }).fill(`${day}T08:00`);
    await page.getByLabel("Ende", { exact: true }).fill(`${day}T09:00`);
    await page.getByLabel("Notiz (nur für dich)", { exact: true }).fill(note);
    await expect(
      page.getByLabel(
        "Zeitraum und Status ausdrücklich mit dem Management teilen",
        { exact: true },
      ),
    ).not.toBeChecked();
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await expect(
      page.getByLabel("Note (only you)", { exact: true }),
    ).toHaveValue(note);
    await page
      .getByRole("button", { name: "Save time window", exact: true })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.getByText(note, { exact: true })).toBeVisible();
    managerContext = await browser.newContext();
    const manager = await managerContext.newPage();
    await adminLogin(manager, admin);
    await manager.goto("/availability");
    await expect(
      manager.getByRole("heading", {
        name: "Freigegebene Zeitfenster",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      manager.getByRole("heading", { name: teacher.name, exact: true }),
    ).toHaveCount(0);
    await expect(manager.getByText(note, { exact: true })).toHaveCount(0);
    await page
      .getByRole("button", { name: "Edit time window", exact: true })
      .click();
    await page
      .getByLabel("Explicitly share interval and status with management", {
        exact: true,
      })
      .check();
    await page
      .getByRole("button", { name: "Save time window", exact: true })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await manager
      .getByRole("button", { name: "Aktuellen Stand laden", exact: true })
      .click();
    await expect(
      manager.getByRole("heading", { name: teacher.name, exact: true }),
    ).toBeVisible();
    await expect(manager.getByText(note, { exact: true })).toHaveCount(0);
    await a11y(manager);
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await a11y(page);
    await page.screenshot({
      path: `.local/screenshots/${testInfo.project.name}-availability.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Edit time window", exact: true })
      .click();
    await page
      .getByLabel("Explicitly share interval and status with management", {
        exact: true,
      })
      .uncheck();
    await page
      .getByRole("button", { name: "Save time window", exact: true })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await manager
      .getByRole("button", { name: "Aktuellen Stand laden", exact: true })
      .click();
    await expect(
      manager.getByRole("heading", { name: teacher.name, exact: true }),
    ).toHaveCount(0);
    await context.setOffline(true);
    await expect(
      page.getByRole("button", { name: "Add time window", exact: true }),
    ).toBeDisabled();
    await context.setOffline(false);
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Remove", exact: true })
      .click();
    await expect(page.getByText(note, { exact: true })).toHaveCount(0);
  } finally {
    await context.setOffline(false);
    await managerContext?.close();
    await checked(
      service
        .from("lecturer_availability")
        .delete()
        .in("user_id", [teacher.id, admin.id]),
    );
    await checked(
      service
        .from("audit_events")
        .delete()
        .in("actor_id", [teacher.id, admin.id]),
    );
    for (const user of [teacher, admin])
      await checked(service.auth.admin.deleteUser(user.id));
  }
});
