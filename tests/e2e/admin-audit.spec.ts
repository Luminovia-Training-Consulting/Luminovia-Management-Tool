/**
 * Browser workflows for password-only authentication-restricted audit filters and revoked access.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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
  "Audit fixtures require the canonical disposable stack.",
);
/** Checks the current rendered browser state for the selected axe violations. */
async function accessible(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations.map(({ id, nodes }) => ({
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
test("password-only authentication administrator filters and pages a redacted real audit trail; other roles and revoked access remain denied", async ({
  page,
  browser,
  context,
}, testInfo) => {
  test.setTimeout(120000);
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
    suffix = randomUUID().slice(0, 8),
    label = `Fictional audit actor ${suffix} <script>literal</script>`,
    secret = `PRIVATE audit detail ${suffix}`,
    administrator = await actor(`Fictional audit admin ${suffix}`, "admin"),
    teacher = await actor(label, "lecturer"),
    ids = Array.from({ length: 45 }, randomUUID),
    at = new Date(Date.now() - 3600000).toISOString();
  let readerContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    await checked(
      service.from("audit_events").insert(
        ids.map((id) => ({
          id,
          actor_id: teacher.id,
          action: "taxonomy.created",
          resource_id: randomUUID(),
          created_at: at,
          details: { notes: secret },
        })),
      ),
    );
    await checked(
      service.from("audit_events").insert(
        [
          "chat.member_added",
          "availability.created",
          "contract.executed_version_registered",
          "invoice.submitted",
          "job.lifecycle.private_unknown",
        ].map((action) => ({
          actor_id: teacher.id,
          action,
          resource_id: randomUUID(),
          details: { body: secret },
        })),
      ),
    );
    await adminLogin(page, administrator);
    await page.goto("/admin/audit");
    await expect(
      page.getByRole("heading", {
        name: "Administrationsprotokoll",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel("Im Protokoll suchen", { exact: true }).fill(suffix);
    await page
      .getByLabel("Aktion", { exact: true })
      .selectOption("taxonomy.created");
    await page
      .getByRole("button", { name: "Filter anwenden", exact: true })
      .click();
    await expect(page.getByRole("article")).toHaveCount(40);
    await expect(page.getByText(label, { exact: true })).toHaveCount(40);
    await expect(page.getByText(secret, { exact: true })).toHaveCount(0);
    expect(
      await page.locator("script").filter({ hasText: "literal" }).count(),
    ).toBe(0);
    await page
      .getByRole("button", { name: "Ältere Seite", exact: true })
      .click();
    await expect(page.getByRole("article")).toHaveCount(5);
    await expect(
      page.getByRole("button", { name: "Ältere Seite", exact: true }),
    ).toBeDisabled();
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await expect(
      page.getByLabel("Search audit trail", { exact: true }),
    ).toHaveValue(suffix);
    await expect(
      page.getByRole("heading", {
        name: "Administration audit trail",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Newer page", exact: true }).click();
    await expect(page.getByRole("article")).toHaveCount(40);
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await accessible(page);
    await page.screenshot({
      path: `.local/screenshots/${testInfo.project.name}-admin-audit.png`,
      fullPage: true,
    });
    readerContext = await browser.newContext();
    const reader = await readerContext.newPage();
    await login(reader, teacher.email);
    await reader.goto("/admin/audit");
    await expect(reader.getByText(/Das Protokoll erfordert/)).toBeVisible();
    await expect(reader.getByRole("article")).toHaveCount(0);
    await context.setOffline(true);
    await expect(
      page.getByRole("button", { name: "Apply filters", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Refresh", exact: true }),
    ).toBeDisabled();
    await context.setOffline(false);
    await checked(
      service.from("user_roles").delete().eq("user_id", administrator.id),
    );
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("alert")).toBeVisible();
  } finally {
    await context.setOffline(false);
    await readerContext?.close();
    for (const user of [administrator, teacher]) {
      await checked(
        service.from("audit_events").delete().eq("actor_id", user.id),
      );
      await checked(service.auth.admin.deleteUser(user.id));
    }
  }
});
