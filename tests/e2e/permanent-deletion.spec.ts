/** Native browser confirmation of permanent account deletion. Fictional identities
 * live only in the random canonical QA project; both Chromium layouts exercise
 * cancel, explicit confirmation, bilingual feedback, contrast and actual absence. */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { actor, adminLogin, api, checked } from "./helpers/accounts-support";

test("permanent account deletion requires reviewed confirmation and removes native identity", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  const suffix = randomUUID().slice(0, 8);
  const admin = await actor(`Deletion Admin ${suffix}`, "admin");
  const target = await actor(`Deletion Target ${suffix}`, "lecturer");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  let targetDeleted = false;
  try {
    await adminLogin(page, admin);
    await page.goto("/admin/accounts");
    await page.getByLabel("Farbschema", { exact: true }).selectOption("light");
    await page
      .getByRole("searchbox", { name: "Konten suchen", exact: true })
      .fill(target.name);
    const action = page.getByRole("button", {
      name: `Endgültig löschen: ${target.name}`,
      exact: true,
    });
    await action.click();
    let dialog = page.getByRole("dialog", {
      name: "Endgültig löschen",
      exact: true,
    });
    await expect(
      dialog.getByText(
        "Diese Löschung ist unwiderruflich. Es gibt keinen Papierkorb und keine Wiederherstellung.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: "Jetzt unwiderruflich löschen",
        exact: true,
      }),
    ).toBeDisabled();
    await page.evaluate(() => document.fonts.ready);
    const lightAccessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(lightAccessibility.violations.map((value) => value.id)).toEqual([]);
    await page.screenshot({
      path: `.local/screenshots/${testInfo.project.name}-permanent-deletion-light-de.png`,
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "Schließen", exact: true })
      .last()
      .click();
    await expect(action).toBeVisible();
    expect(
      (await checked(service.auth.admin.getUserById(target.id))).user?.id,
    ).toBe(target.id);
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await page
      .getByRole("button", {
        name: `Delete permanently: ${target.name}`,
        exact: true,
      })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Delete permanently",
      exact: true,
    });
    await expect(
      dialog.getByRole("button", {
        name: "Delete irreversibly now",
        exact: true,
      }),
    ).toBeDisabled();
    await dialog
      .getByLabel(
        "I reviewed the displayed impact and want to permanently delete these records.",
        { exact: true },
      )
      .check();
    await dialog
      .getByLabel("Type DELETE to confirm", { exact: true })
      .fill("DELETE");
    await expect(
      dialog.getByRole("button", {
        name: "Delete irreversibly now",
        exact: true,
      }),
    ).toBeEnabled();
    await page.evaluate(() => document.fonts.ready);
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      accessibility.violations.map((value) => ({
        id: value.id,
        nodes: value.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/screenshots/${testInfo.project.name}-permanent-deletion-dark-en.png`,
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "Delete irreversibly now", exact: true })
      .click();
    await expect(
      dialog.getByText("Permanent deletion has been fully confirmed.", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 30000 });
    expect((await service.auth.admin.getUserById(target.id)).error?.code).toBe(
      "user_not_found",
    );
    expect(
      await checked(service.from("profiles").select("id").eq("id", target.id)),
    ).toEqual([]);
    targetDeleted = true;
    await dialog
      .getByRole("button", { name: "Close", exact: true })
      .last()
      .click();
    await expect(
      page.getByRole("button", {
        name: `Delete permanently: ${target.name}`,
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    const ids = [admin.id, ...(!targetDeleted ? [target.id] : [])];
    await checked(service.from("audit_events").delete().in("actor_id", ids));
    for (const id of ids)
      await checked(service.auth.admin.deleteUser(id, false));
  }
});
