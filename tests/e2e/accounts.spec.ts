/**
 * Browserabläufe für Kontenrollen, gescopte Einladungen und bestätigte Statusänderungen.
 * Die Assertions prüfen tatsächliche Oberfläche und Serverantworten; ihre Ausführung ersetzt keine manuelle Plattformabnahme.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import {
  api,
  checked,
  actor,
  login,
  adminLogin,
} from "./helpers/accounts-support";
test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Account workflows only run in isolated ./portal test.",
);
test("individual account roles, scoped invitations and linked status management use real API confirmation", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8),
    admin = await actor(`Account Admin ${suffix}`, "admin"),
    teacher = await actor(`Account Teacher ${suffix}`, "lecturer");
  await adminLogin(page, admin);
  await page.goto("/admin/accounts");
  await expect(
    page.getByRole("heading", { name: "Konten & Zugänge", exact: true }),
  ).toBeVisible();
  const search = page.getByRole("searchbox", {
    name: "Konten suchen",
    exact: true,
  });
  await search.fill(teacher.name);
  await expect(search).toBeFocused();
  await page
    .getByRole("button", {
      name: `Rollen bearbeiten: ${teacher.name}`,
      exact: true,
    })
    .click();
  const roleDialog = page.getByRole("dialog", {
    name: "Rollen bearbeiten",
    exact: true,
  });
  await roleDialog.getByLabel("Kursteilnehmer:in", { exact: true }).check();
  await roleDialog
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
    page.getByRole("status").filter({ hasText: "Rollen wurden gespeichert." }),
  ).toBeVisible();
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const actualRoles = await checked(
    service.from("user_roles").select("role").eq("user_id", teacher.id),
  );
  expect(actualRoles.map((row) => row.role).sort()).toEqual([
    "lecturer",
    "participant",
  ]);
  await page
    .getByRole("link", {
      name: "Profil, Nachweise und Kontostatus verwalten",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/people\\?user=${teacher.id}`),
  );
  await expect(
    page.getByRole("heading", { name: teacher.name, exact: true }),
  ).toBeVisible();
  await page.goto("/admin/accounts");
  await page
    .getByLabel("Kontorolle", { exact: true })
    .selectOption("participant");
  const email = `account-ui-invite-${suffix}@example.invalid`;
  await page.getByLabel("E-Mail", { exact: true }).fill(email);
  await page
    .getByLabel("Anzeigename", { exact: true })
    .fill(`Invited Participant ${suffix}`);
  await page
    .getByRole("button", { name: "Einladung senden", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /Einladung.*versandt/ }),
  ).toBeVisible({ timeout: 30000 });
  const invited = (
    await checked(service.auth.admin.listUsers({ perPage: 1000 }))
  ).users.find((user) => user.email === email);
  expect(invited).toBeTruthy();
  expect(
    (
      await checked(
        service.from("user_roles").select("role").eq("user_id", invited!.id),
      )
    ).map((row) => row.role),
  ).toEqual(["participant"]);
  const lecturerContext = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL!,
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
  });
  try {
    const lecturerPage = await lecturerContext.newPage();
    await login(lecturerPage, teacher.email);
    await lecturerPage.goto("/admin/accounts");
    await expect(
      lecturerPage.getByText(
        "Für die Kontoverwaltung sind Verwaltungsrechte und eine bestätigte Mehrfaktor-Anmeldung erforderlich.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      lecturerPage.getByText(admin.email, { exact: true }),
    ).toHaveCount(0);
  } finally {
    await lecturerContext.close();
  }
  await page.getByLabel("Sprache", { exact: true }).selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Accounts & access", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Language", { exact: true }).selectOption("de");
  await page.evaluate(() => document.fonts.ready);
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    scan.violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `docs/screenshots/${testInfo.project.name}-accounts.png`,
    fullPage: true,
  });
});
