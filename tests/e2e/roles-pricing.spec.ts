import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { actor, api, checked, adminLogin } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Delegated roles require the isolated ./portal test project.",
);

test("management assigns only subordinate roles while only administration sees and confirms private policy", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8);
  const manager = await actor(`Delegated Manager ${suffix}`, "management");
  const peer = await actor(`Peer Manager ${suffix}`, "management");
  const admin = await actor(`Policy Admin ${suffix}`, "admin");
  const teacher = await actor(`Delegated Teacher ${suffix}`, "lecturer");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const orgRequests: string[] = [];
  page.on("request", (request) => {
    if (
      /\/rest\/v1\/(?:organisations|client_organisation_memberships)(?:\?|$)/.test(
        request.url(),
      )
    )
      orgRequests.push(request.url());
  });
  try {
    await adminLogin(page, manager);
    await page.goto("/admin/accounts");
    await expect(
      page.getByRole("heading", { name: "Konten & Zugänge", exact: true }),
    ).toBeVisible();
    const search = page.getByRole("searchbox", {
      name: "Konten suchen",
      exact: true,
    });
    for (const protectedAccount of [manager, peer, admin]) {
      await search.fill(protectedAccount.name);
      await expect(
        page.getByText(protectedAccount.email, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: `Rollen bearbeiten: ${protectedAccount.name}`,
          exact: true,
        }),
      ).toHaveCount(0);
    }
    await search.fill(teacher.name);
    await page
      .getByRole("button", {
        name: `Rollen bearbeiten: ${teacher.name}`,
        exact: true,
      })
      .click();
    const roles = page.getByRole("dialog", {
      name: "Rollen bearbeiten",
      exact: true,
    });
    await expect(
      roles.getByRole("checkbox", { name: "Administration", exact: true }),
    ).toHaveCount(0);
    await expect(
      roles.getByRole("checkbox", { name: "Management", exact: true }),
    ).toHaveCount(0);
    await expect(
      roles.getByRole("checkbox", {
        name: "Inhaberin / Plattformleitung",
        exact: true,
      }),
    ).toHaveCount(0);
    await roles
      .getByRole("checkbox", { name: "Senior-Dozent:in", exact: true })
      .check();
    await roles.getByRole("checkbox", { name: "Gast", exact: true }).check();
    await roles
      .getByRole("button", { name: "Rollen speichern", exact: true })
      .click();
    const confirmation = page.getByRole("dialog", {
      name: `Rollen für ${teacher.name} ändern?`,
      exact: true,
    });
    await confirmation
      .getByRole("button", { name: "Rollen speichern", exact: true })
      .click();
    await expect(confirmation).not.toBeVisible();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Rollen wurden gespeichert." }),
    ).toBeVisible();
    const committed = await checked(
      service.from("user_roles").select("role").eq("user_id", teacher.id),
    );
    expect(committed.map((row) => row.role).sort()).toEqual([
      "guest",
      "lecturer",
      "senior_lecturer",
    ]);
    await page.getByLabel("Kontorolle", { exact: true }).selectOption("client");
    await expect(
      page.getByLabel("Auftraggeber-Organisation", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Organisation zuordnen", exact: true }),
    ).toHaveCount(0);
    expect(orgRequests).toEqual([]);
    const managerApi = api(process.env.SUPABASE_ANON_KEY!);
    await checked(
      managerApi.auth.signInWithPassword({
        email: manager.email,
        password: process.env.E2E_PASSWORD!,
      }),
    );
    const reduced = await checked(managerApi.rpc("commission_access"));
    expect(reduced.can_manage_gross).toBe(false);
    expect(reduced.can_manage_client_memberships).toBe(false);
    expect("regular_lecturer_percent" in reduced).toBe(false);
    expect("senior_lecturer_percent" in reduced).toBe(false);
    expect("policy_version" in reduced).toBe(false);
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", {
        name: "Kurse & Aufträge verwalten",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Vergütungsregeln", exact: true }),
    ).toHaveCount(0);
    await page.goto("/admin/accounts");
    await page
      .getByRole("combobox", { name: "Sprache", exact: true })
      .selectOption("en");
    await expect(
      page.getByRole("heading", { name: "Accounts & access", exact: true }),
    ).toBeVisible();
    const managerScan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(managerScan.violations).toEqual([]);
    await testInfo.attach("delegated-manager-accounts", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await page
      .getByRole("combobox", { name: "Language", exact: true })
      .selectOption("de");
    await page.getByRole("button", { name: "Abmelden", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await adminLogin(page, admin);
    await page.goto("/admin");
    const policy = page.getByRole("region", {
      name: "Vergütungsregeln",
      exact: true,
    });
    await expect(policy).toBeVisible();
    await expect(
      policy.getByLabel("Dozent:in – Honorar vom Auftragspreis (%)", {
        exact: true,
      }),
    ).toHaveValue("31");
    await expect(
      policy.getByLabel("Senior-Dozent:in – Honorar vom Auftragspreis (%)", {
        exact: true,
      }),
    ).toHaveValue("73");
    // Reconfirm fictional seeded values; other suites retain the same policy semantics.
    const confirmed = page.waitForResponse(
      (response) =>
        response.url().endsWith("/rest/v1/rpc/configure_compensation_policy") &&
        response.request().method() === "POST",
    );
    await policy
      .getByRole("button", { name: "Vergütungsregeln speichern", exact: true })
      .click();
    const saved = await confirmed;
    expect(saved.ok()).toBe(true);
    const actual = await saved.json();
    expect(actual.regular_lecturer_percent).toBe(31);
    expect(actual.senior_lecturer_percent).toBe(73);
    expect(actual.policy_version).toBeGreaterThan(0);
    await expect(policy.getByRole("status")).toHaveText(
      "Vergütungsregeln wurden bestätigt.",
    );
    await page.reload();
    await expect(
      policy.getByLabel("Dozent:in – Honorar vom Auftragspreis (%)", {
        exact: true,
      }),
    ).toHaveValue("31");
    await expect(
      policy.getByLabel("Senior-Dozent:in – Honorar vom Auftragspreis (%)", {
        exact: true,
      }),
    ).toHaveValue("73");
    const policyScan = await new AxeBuilder({ page })
      .include('[aria-label="Vergütungsregeln"]')
      .analyze();
    expect(policyScan.violations).toEqual([]);
    await testInfo.attach("administration-private-policy", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  } finally {
    const ids = [manager.id, peer.id, admin.id, teacher.id];
    await checked(service.from("audit_events").delete().in("actor_id", ids));
    // The confirmed policy retains its administrator provenance FK. Its fictional
    // author is intentionally retained until the owned disposable stack cleanup.
    for (const id of [manager.id, peer.id, teacher.id])
      await checked(service.auth.admin.deleteUser(id));
  }
});
