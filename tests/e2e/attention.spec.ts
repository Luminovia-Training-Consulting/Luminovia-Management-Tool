import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { actor, api, checked, login } from "./helpers/accounts-support";
test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Quiet-hour fixtures require the canonical disposable project.",
);
test("saved quiet hours preserve20unread updates while the bell counts3critical receipts", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(90000);
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
    owner = await actor("Fictional quiet-hour owner", "lecturer"),
    peer = await actor("Fictional quiet-hour peer", "lecturer"),
    ownerApi = api(process.env.SUPABASE_ANON_KEY!);
  await checked(
    ownerApi.auth.signInWithPassword({
      email: owner.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  const snapshot = await checked(
      ownerApi.rpc("notification_inbox", { p_limit: 1 }),
    ),
    now = new Date(snapshot.as_of),
    minute = now.getUTCHours() * 60 + now.getUTCMinutes(),
    clock = (value: number) =>
      `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`,
    start = clock((minute + 1410) % 1440),
    end = clock((minute + 30) % 1440);
  const critical = Array.from({ length: 3 }, (_, i) => ({
    id: randomUUID(),
    user_id: owner.id,
    kind: ["claim_confirmed", "claim_cancelled", "contract_available"][i],
    resource_id: randomUUID(),
  }));
  await checked(
    service.from("notifications").insert([
      ...Array.from({ length: 17 }, () => ({
        user_id: owner.id,
        kind: "chat_message",
        resource_id: randomUUID(),
      })),
      ...critical,
      {
        user_id: peer.id,
        kind: "claim_confirmed",
        resource_id: randomUUID(),
      },
    ]),
  );
  try {
    await login(page, owner.email);
    await page.goto("/settings");
    await page
      .getByLabel("Tägliche Ruhezeit aktivieren", { exact: true })
      .check();
    await page.getByLabel("Beginn der Ruhezeit", { exact: true }).fill(start);
    await page.getByLabel("Ende der Ruhezeit", { exact: true }).fill(end);
    await page.getByLabel("Zeitzone der Ruhezeit", { exact: true }).fill("UTC");
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await expect(
      page.getByLabel("Quiet hours start", { exact: true }),
    ).toHaveValue(start);
    await expect(
      page.getByLabel("Quiet hours end", { exact: true }),
    ).toHaveValue(end);
    await expect(
      page.getByLabel("Quiet hours time zone", { exact: true }),
    ).toHaveValue("UTC");
    await page
      .getByRole("button", { name: "Save quiet hours", exact: true })
      .click();
    await expect(
      page.getByText("Quiet hours saved.", { exact: true }),
    ).toBeVisible();
    const bell = page.locator(".notification-menu > summary");
    await expect(bell).toHaveAttribute(
      "aria-label",
      /3 important unread updates.*Quiet hours active.*20 unread in total/,
    );
    await page.reload();
    await expect(
      page.getByLabel("Enable daily quiet hours", { exact: true }),
    ).toBeChecked();
    await expect(
      page.getByLabel("Quiet hours start", { exact: true }),
    ).toHaveValue(start);
    await expect(
      page.getByRole("button", { name: "Save quiet hours", exact: true }),
    ).toBeDisabled();
    await context.setOffline(true);
    await page
      .getByLabel("Enable daily quiet hours", { exact: true })
      .uncheck();
    await expect(
      page.getByRole("button", { name: "Save quiet hours", exact: true }),
    ).toBeDisabled();
    await page.getByLabel("Enable daily quiet hours", { exact: true }).check();
    await context.setOffline(false);
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await page.goto("/notifications");
    await expect(page.locator(".inbox-list > li")).toHaveCount(20);
    await expect(
      page.locator(".inbox-list > li.notification-unread"),
    ).toHaveCount(20);
    await expect(page.getByText("20 unread", { exact: true })).toBeVisible();
    await expect(bell).toHaveAttribute(
      "aria-label",
      /3 important unread updates.*Quiet hours active.*20 unread in total/,
    );
    await page.evaluate(() => document.fonts.ready);
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      scan.violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map((node) => node.target),
      })),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `docs/screenshots/${testInfo.project.name}-quiet-hours.png`,
      fullPage: true,
    });
    const receipt = page
      .locator(".inbox-list > li")
      .filter({ has: page.getByText("Assignment confirmed", { exact: true }) });
    await receipt
      .getByRole("button", { name: "Mark as read", exact: true })
      .click();
    await expect(page.getByText("19 unread", { exact: true })).toBeVisible();
    await expect(bell).toHaveAttribute(
      "aria-label",
      /2 important unread updates.*19 unread in total/,
    );
    expect(
      (
        await checked(ownerApi.rpc("notification_inbox", { p_limit: 40 }))
      ).items.filter(
        (item: { read_at: string | null }) => item.read_at !== null,
      ),
    ).toHaveLength(1);
    await receipt
      .getByRole("button", { name: "Mark as unread", exact: true })
      .click();
    await expect(page.getByText("20 unread", { exact: true })).toBeVisible();
    await expect(bell).toHaveAttribute(
      "aria-label",
      /3 important unread updates.*20 unread in total/,
    );
    await page.goto("/settings");
    await page
      .getByLabel("Enable daily quiet hours", { exact: true })
      .uncheck();
    await page
      .getByRole("button", { name: "Save quiet hours", exact: true })
      .click();
    await expect(
      page.getByText("Quiet hours saved.", { exact: true }),
    ).toBeVisible();
    await expect(bell).toHaveAttribute(
      "aria-label",
      "Notifications: 20 unread",
    );
    const restored = await checked(
      ownerApi.rpc("notification_inbox", { p_limit: 40 }),
    );
    expect(restored.quiet_active).toBe(false);
    expect(Object.hasOwn(restored, "attention_count")).toBe(false);
    expect(restored.unread_count).toBe(20);
    expect(restored.items).toHaveLength(20);
  } finally {
    await context.setOffline(false);
  }
});
