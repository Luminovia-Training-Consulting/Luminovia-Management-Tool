/** Native browser confirmation of permanent account deletion. Fictional identities
 * live only in the random canonical QA project; both Chromium layouts exercise
 * cancel, explicit confirmation, bilingual feedback, contrast and actual absence. */
import {expect, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
import {actor, adminLogin, api, checked, login} from "./helpers/accounts-support";

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
        await page.getByLabel("Farbschema", {exact: true}).selectOption("light");
        await page
            .getByRole("searchbox", {name: "Konten suchen", exact: true})
            .fill(target.name);
        const action = page.getByRole("button", {
            name: `Endgültig löschen: ${target.name}`,
            exact: true,
        });
        await action.focus();
        await page.keyboard.press("Enter");
        let dialog = page.getByRole("dialog", {
            name: "Endgültig löschen",
            exact: true,
        });
        await expect(
            dialog.getByText(
                "Diese Löschung ist unwiderruflich. Es gibt keinen Papierkorb und keine Wiederherstellung.",
                {exact: true},
            ),
        ).toBeVisible();
        await expect(
            dialog.getByRole("button", {
                name: "Jetzt unwiderruflich löschen",
                exact: true,
            }),
        ).toBeDisabled();
        await page.evaluate(() => document.fonts.ready);
        const lightAccessibility = await new AxeBuilder({page})
            .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
            .analyze();
        expect(lightAccessibility.violations.map((value) => value.id)).toEqual([]);
        await page.screenshot({
            path: `.local/screenshots/${testInfo.project.name}-permanent-deletion-light-de.png`,
            fullPage: true,
        });
        await dialog
            .getByRole("button", {name: "Schließen", exact: true})
            .last()
            .click();
        await expect(action).toBeVisible();
        expect(
            (await checked(service.auth.admin.getUserById(target.id))).user?.id,
        ).toBe(target.id);
        await page.getByLabel("Sprache", {exact: true}).selectOption("en");
        await page.getByLabel("Theme", {exact: true}).selectOption("dark");
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
                {exact: true},
            )
            .check();
        await dialog
            .getByLabel("Type DELETE to confirm", {exact: true})
            .fill("DELETE");
        await expect(
            dialog.getByRole("button", {
                name: "Delete irreversibly now",
                exact: true,
            }),
        ).toBeEnabled();
        await page.evaluate(() => document.fonts.ready);
        const accessibility = await new AxeBuilder({page})
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
            .getByRole("button", {name: "Delete irreversibly now", exact: true})
            .click();
        await expect(
            dialog.getByText("Permanent deletion has been fully confirmed.", {
                exact: true,
            }),
        ).toBeVisible({timeout: 30000});
        expect((await service.auth.admin.getUserById(target.id)).error?.code).toBe(
            "user_not_found",
        );
        expect(
            await checked(service.from("profiles").select("id").eq("id", target.id)),
        ).toEqual([]);
        targetDeleted = true;
        await dialog
            .getByRole("button", {name: "Close", exact: true})
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
test("company management deletes only the selected organisation contact", async ({page}) => {
    const suffix = randomUUID().slice(0, 8);
    const manager = await actor(`Fictional company manager ${suffix}`, "management");
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const company = {id: randomUUID(), name: `Fictional company ${suffix}`};
    const contact = {id: randomUUID(), name: `Fictional contact ${suffix}`};
    const retained = {id: randomUUID(), name: `Fictional second contact ${suffix}`};
    await checked(service.from("organisations").insert(company));
    await checked(service.from("organisation_contacts").insert(
        [contact, retained].map((item) => ({...item, organisation_id: company.id})),
    ));

    await login(page, manager.email);
    await page.goto("/clients");
    await page.getByRole("button", {name: company.name, exact: true}).click();
    const action = page.getByRole("button", {name: `Löschen: ${contact.name}`, exact: true});
    await action.click();
    const confirmation = page.getByRole("dialog", {name: "Endgültig löschen", exact: true});
    await expect(confirmation.getByRole("heading", {name: contact.name, exact: true})).toBeVisible();
    await expect(confirmation.getByRole("button", {name: "Jetzt unwiderruflich löschen", exact: true})).toBeDisabled();
    await confirmation.getByLabel("Ich habe den angezeigten Umfang geprüft und möchte diese Daten endgültig löschen.", {exact: true}).check();
    await confirmation.getByLabel("Zur Bestätigung DELETE eingeben", {exact: true}).fill("DELETE");
    await confirmation.getByRole("button", {name: "Jetzt unwiderruflich löschen", exact: true}).click();
    await expect(confirmation.getByText("Die endgültige Löschung wurde vollständig bestätigt.", {exact: true})).toBeVisible();
    await confirmation.getByRole("button", {name: "Schließen", exact: true}).last().click();
    await expect(action).toHaveCount(0);
    await expect(page.getByRole("heading", {name: retained.name, exact: true})).toBeVisible();
    expect(await checked(service.from("organisation_contacts").select("id").eq("organisation_id", company.id))).toEqual([{id: retained.id}]);
});
