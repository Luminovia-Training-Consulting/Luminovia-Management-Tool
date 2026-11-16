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

test("email channel and IANA quiet hours persist across language, reload and offline edits", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const owner = await actor(
    "Fictional email notification lecturer",
    "lecturer",
  );
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const reader = api(process.env.SUPABASE_ANON_KEY!);
  try {
    await checked(
      reader.auth.signInWithPassword({
        email: owner.email,
        password: process.env.E2E_PASSWORD!,
      }),
    );
    await login(page, owner.email);
    await page.goto("/settings");
    const email = page.getByRole("checkbox", {
      name: "Zusätzliche Hinweise per E-Mail erhalten",
      exact: true,
    });
    await expect(email).not.toBeChecked();
    await email.check();
    await page
      .getByRole("checkbox", {
        name: "Ruhezeiten für E-Mails verwenden",
        exact: true,
      })
      .check();
    await page.getByLabel("Ruhezeit von", { exact: true }).fill("23:15");
    await page.getByLabel("Ruhezeit bis", { exact: true }).fill("06:45");
    await page
      .getByLabel("Zeitzone der Ruhezeiten", { exact: true })
      .fill("Australia/Brisbane");
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await expect(
      page.getByRole("checkbox", {
        name: "Receive additional alerts by email",
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      page.getByLabel("Quiet hours from", { exact: true }),
    ).toHaveValue("23:15");
    await page
      .getByRole("button", { name: "Save email preferences", exact: true })
      .click();
    await expect(
      page.getByText("Email preferences saved.", { exact: true }),
    ).toBeVisible();
    const saved = await checked(reader.rpc("delivery_preferences"));
    expect(saved).toEqual({
      email_enabled: true,
      quiet_start: "23:15",
      quiet_end: "06:45",
      time_zone: "Australia/Brisbane",
      version: 2,
    });
    await page.reload();
    await expect(
      page.getByRole("checkbox", {
        name: "Receive additional alerts by email",
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      page.getByLabel("Quiet hours from", { exact: true }),
    ).toHaveValue("23:15");
    await expect(
      page.getByLabel("Quiet hours until", { exact: true }),
    ).toHaveValue("06:45");
    await expect(
      page.getByLabel("Quiet hours time zone", { exact: true }),
    ).toHaveValue("Australia/Brisbane");
    await page.screenshot({
      path: testInfo.outputPath("email-quiet-hours.png"),
      fullPage: true,
    });
    await page.context().setOffline(true);
    await page
      .getByRole("checkbox", {
        name: "Receive additional alerts by email",
        exact: true,
      })
      .uncheck();
    await expect(
      page.getByRole("button", { name: "Save email preferences", exact: true }),
    ).toBeDisabled();
    expect(
      (await checked(reader.rpc("delivery_preferences"))).email_enabled,
    ).toBe(true);
    await page.context().setOffline(false);
    await expect(
      page.getByRole("button", { name: "Save email preferences", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Save email preferences", exact: true })
      .click();
    await expect(
      page.getByText("Email preferences saved.", { exact: true }),
    ).toBeVisible();
    expect(
      (await checked(reader.rpc("delivery_preferences"))).email_enabled,
    ).toBe(false);
    await page.reload();
    await expect(
      page.getByRole("checkbox", {
        name: "Receive additional alerts by email",
        exact: true,
      }),
    ).not.toBeChecked();
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
