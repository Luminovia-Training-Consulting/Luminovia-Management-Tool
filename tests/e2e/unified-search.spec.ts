/** Actual desktop/mobile discovery and navigation with isolated fictional owners. */
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { actor, api, checked, login } from "./helpers/accounts-support";
import { cleanupWorkbenchUsers } from "./helpers/workbench-cleanup";

test("universal search finds own tasks, keeps foreign tasks private and opens the selected result in DE/EN", async ({
  page,
}, testInfo) => {
  const owner = await actor("Fictional search owner", "lecturer"),
    peer = await actor("Fictional search peer", "lecturer"),
    service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
    clients = [
      api(process.env.SUPABASE_ANON_KEY!),
      api(process.env.SUPABASE_ANON_KEY!),
    ];
  const needle = `Search-${randomUUID()}`;
  try {
    const tasks = [];
    for (const [index, user] of [owner, peer].entries()) {
      await checked(
        clients[index].auth.signInWithPassword({
          email: user.email,
          password: process.env.E2E_PASSWORD!,
        }),
      );
      tasks.push(
        await checked(
          clients[index].rpc("save_work_task", {
            p_id: null,
            p_payload: {
              title: `${needle} ${index ? "peer private" : "own task"}`,
              description: "Fictional authored detail",
              state: "open",
              due_at: null,
              time_zone: "Europe/Berlin",
              scope: "private",
              assignee_id: user.id,
              source_message_id: null,
            },
            p_expected_version: 0,
            p_client_id: randomUUID(),
          }),
        ),
      );
    }
    await login(page, owner.email);
    await page.goto(`/search?q=${encodeURIComponent(needle)}&kind=tasks`);
    await expect(
      page.getByRole("heading", { name: "Universelle Suche", exact: true }),
    ).toBeVisible();
    const result = page.getByRole("link", {
      name: new RegExp(`${needle} own task`),
    });
    await expect(result).toHaveAttribute(
      "href",
      `/workbench?task=${tasks[0].id}`,
    );
    await expect(result.getByText("Offen", { exact: true })).toBeVisible();
    await expect(
      page.getByText(`${needle} peer private`, { exact: true }),
    ).toHaveCount(0);
    const field = page.getByRole("searchbox", {
      name: "Suchbegriff",
      exact: true,
    });
    await field.fill("Unsaved authored search");
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await expect(
      page.getByRole("searchbox", { name: "Search term", exact: true }),
    ).toHaveValue("Unsaved authored search");
    await expect(result.getByText("Open", { exact: true })).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("searchbox", { name: "Search term", exact: true }),
    ).toHaveValue(needle);
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
      path: testInfo.outputPath("universal-search.png"),
      fullPage: true,
    });
    await result.click();
    await expect(page).toHaveURL(
      new RegExp(`/workbench\\?task=${tasks[0].id}`),
    );
    await expect(
      page.getByText(`${needle} own task`, { exact: true }).first(),
    ).toBeVisible();
  } finally {
    for (const client of clients) await client.auth.signOut();
    cleanupWorkbenchUsers([owner.id, peer.id]);
    await checked(
      service.from("notifications").delete().in("user_id", [owner.id, peer.id]),
    );
    await checked(
      service.from("audit_events").delete().in("actor_id", [owner.id, peer.id]),
    );
    for (const user of [owner, peer])
      await checked(service.auth.admin.deleteUser(user.id));
  }
});
