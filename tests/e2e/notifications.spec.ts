/**
 * Browserabläufe für eigene Inbox und dauerhaft bestätigte DE-/EN-Einstellungen.
 * Die Assertions prüfen tatsächliche Oberfläche und Serverantworten; ihre Ausführung ersetzt keine manuelle Plattformabnahme.
 */
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { actor, api, checked, login } from "./helpers/accounts-support";

test("personal inbox, safe bulk read and DE/EN notification preferences persist", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const owner = await actor("Fictional inbox lecturer", "lecturer");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const reader = api(process.env.SUPABASE_ANON_KEY!);
  try {
    await checked(
      reader.auth.signInWithPassword({
        email: owner.email,
        password: process.env.E2E_PASSWORD!,
      }),
    );
    const notes = Array.from({ length: 45 }, () => ({
      user_id: owner.id,
      kind: "activity",
      resource_id: randomUUID(),
    }));
    await checked(service.from("notifications").insert(notes));
    await login(page, owner.email);
    await page.goto("/notifications");
    await expect(page.locator(".inbox-toolbar").getByRole("status")).toHaveText(
      "45 ungelesen",
    );
    await expect(page.locator(".inbox-list>.notification-row")).toHaveCount(40);
    await page
      .getByRole("button", { name: "Weitere Meldungen laden", exact: true })
      .click();
    await expect(page.locator(".inbox-list>.notification-row")).toHaveCount(45);
    await page
      .getByRole("button", {
        name: "Alle bisher eingegangenen Meldungen lesen",
        exact: true,
      })
      .click();
    await expect(page.locator(".inbox-toolbar").getByRole("status")).toHaveText(
      "0 ungelesen",
    );
    await page
      .getByRole("combobox", { name: "Benachrichtigungen", exact: true })
      .selectOption("unread");
    await expect(
      page.getByText("Hier gibt es gerade keine Meldungen.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Benachrichtigungen einstellen", exact: true })
      .click();
    const chat = page.getByRole("checkbox", {
      name: "Neue Chatnachrichten",
      exact: true,
    });
    await expect(chat).toBeChecked();
    await chat.uncheck();
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await expect(
      page.getByRole("checkbox", { name: "New chat messages", exact: true }),
    ).not.toBeChecked();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText("Preferences saved.", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("checkbox", { name: "New chat messages", exact: true }),
    ).not.toBeChecked();
    expect((await checked(reader.rpc("notification_preferences"))).chat).toBe(
      false,
    );
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await page.evaluate(() => document.fonts.ready);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("notification-settings.png"),
      fullPage: true,
    });
    await page.goto("/notifications");
    await page
      .getByRole("button", { name: "Check due reminders", exact: true })
      .click();
    await expect(
      page.getByText("Reminders checked.", { exact: true }),
    ).toBeVisible();
    await page.context().setOffline(true);
    await expect(
      page.getByRole("button", { name: "Check due reminders", exact: true }),
    ).toBeDisabled();
    await page.context().setOffline(false);
  } finally {
    await page.context().setOffline(false);
    await reader.auth.signOut();
    await checked(
      service.from("notifications").delete().eq("user_id", owner.id),
    );
    await checked(
      service.from("audit_events").delete().eq("actor_id", owner.id),
    );
    await checked(service.auth.admin.deleteUser(owner.id));
  }
});
