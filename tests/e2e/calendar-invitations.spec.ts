import { expect, test } from "@playwright/test";
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
  "Requires the disposable calendar fixture stack.",
);

test("a calendar invitation reaches its recipient, supports a reply and disappears after withdrawal", async ({
  page,
  browser,
}, testInfo) => {
  const suffix = randomUUID().slice(0, 8);
  const title = `Fictional calendar invitation ${suffix}`;
  const name = `Fictional instructor ${suffix}`;
  const manager = await actor(
    "Fictional calendar invitations manager",
    "admin",
  );
  const recipient = await actor(name, "lecturer");
  const event = randomUUID();
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const recipientContext = await browser.newContext({
    viewport: page.viewportSize() ?? undefined,
    isMobile: testInfo.project.name === "mobile-chromium",
    hasTouch: testInfo.project.name === "mobile-chromium",
  });
  const viewer = await recipientContext.newPage();
  try {
    await checked(
      service.from("global_events").insert({
        id: event,
        title,
        published: true,
        starts_at: new Date(Date.now() + 1800000).toISOString(),
        ends_at: new Date(Date.now() + 5400000).toISOString(),
        time_zone: "Australia/Brisbane",
      }),
    );
    await adminLogin(page, manager);
    await page.goto("/calendar");
    await page
      .getByRole("button", { name: "Globale Termine", exact: true })
      .click();
    const management = page.getByRole("region", {
      name: "Globale Termine verwalten",
    });
    const card = management.getByRole("article").filter({ hasText: title });
    await card.getByRole("button", { name: "Einladungen verwalten" }).click();
    const dialog = page.getByRole("dialog", { name: "Einladungen verwalten" });
    await dialog
      .getByRole("searchbox", { name: "Person nach Namen suchen" })
      .fill(suffix);
    await dialog.getByRole("button", { name: "Suchen", exact: true }).click();
    await dialog
      .getByRole("button", { name: `${name} einladen`, exact: true })
      .click();
    await expect(
      dialog.getByText("Antwort offen", { exact: true }),
    ).toBeVisible();

    await login(viewer, recipient.email);
    await viewer.goto("/notifications");
    const notification = viewer
      .locator(".notification-row")
      .filter({ hasText: "Neue Kalendereinladung" });
    await notification.getByRole("link").click();
    await expect(viewer).toHaveURL(
      new RegExp(`/calendar\\?invitation=${event}#calendar-invitations$`),
    );
    const panel = viewer.locator("#calendar-invitations");
    await expect(
      panel.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(panel.getByText(/Australia\/Brisbane/)).toBeVisible();
    await viewer.getByLabel("Sprache", { exact: true }).selectOption("en");
    await viewer.getByLabel("Theme", { exact: true }).selectOption("dark");
    const englishPanel = viewer.locator("#calendar-invitations");
    await englishPanel
      .getByRole("button", { name: "Accept", exact: true })
      .click();
    await expect(
      englishPanel.getByRole("button", { name: "Accept", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      await viewer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);

    await page.reload();
    await page
      .getByRole("button", { name: "Globale Termine", exact: true })
      .click();
    await card.getByRole("button", { name: "Einladungen verwalten" }).click();
    await expect(dialog.getByText("Zugesagt", { exact: true })).toBeVisible();
    await dialog
      .getByRole("button", { name: "Einladung zurückziehen" })
      .click();
    await expect(
      dialog.getByText("Einladung zurückgezogen.", { exact: true }),
    ).toBeVisible();
    await viewer.reload();
    await expect(
      englishPanel.getByText("This invitation is no longer available."),
    ).toBeVisible();
  } finally {
    await recipientContext.close();
    await checked(
      service.from("notifications").delete().eq("resource_id", event),
    );
    await checked(service.from("global_events").delete().eq("id", event));
    await checked(service.auth.admin.deleteUser(manager.id));
    await checked(service.auth.admin.deleteUser(recipient.id));
  }
});
