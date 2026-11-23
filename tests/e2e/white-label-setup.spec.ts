/** Verify the shared portal generates a private Academy draft without changing customer roles. */
import {expect, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {actor, api, checked, login} from "./helpers/accounts-support";

test.skip(process.env.PORTAL_TEST_MODE !== "1", "Requires the isolated portal fixtures.");

test("admin exports the Academy draft only for an active company member", async ({page, browser}) => {
    test.setTimeout(90000);
    const admin = await actor("Fictional White Label operator", "admin");
    const manager = await actor("Fictional White Label manager", "management");
    const customer = await actor("Fictional Academy coordinator", "client");
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const organisation = randomUUID();
    const companyName = `Fictional Academy Company ${organisation.slice(0, 8)}`;
    try {
        await checked(service.from("organisations").insert({id: organisation, name: companyName}));
        await login(page, admin.email);
        await page.goto("/admin");
        await expect(page.getByRole("link", {name: "White Label", exact: true})).toBeVisible();
        await page.getByRole("link", {name: "White Label", exact: true}).click();
        const open = page.getByRole("switch", {name: "White-Label-Einrichtung öffnen"});
        await expect(open).not.toBeChecked();
        await open.press("Space");
        await expect(open).toBeChecked();
        await page.getByLabel("Unternehmen", {exact: true}).selectOption(organisation);
        await expect(page.getByLabel("Rechtlicher Firmenname")).toHaveValue(companyName);
        for (const [label, value] of [
            ["E-Mail des Firmenkontos", customer.email],
            ["Benutzername in der Akademie (optional)", "practice-admin"],
            ["Name der Akademie", "Fictional Training Academy"],
            ["Kurzname", "Training"],
            ["Referenz für geprüfte Logos und Icons", "FICTIONAL-APPROVED-ASSETS"],
            ["HTTPS-Adresse der Akademie", "https://academy.fictional-training.example.edu"],
            ["Installationsverzeichnis", "/opt/academies/fictional-training"],
            ["Serverreferenz", "FICTIONAL-HOST"],
            ["Datenregion", "eu-central"],
            ["Vertragsreferenz", "FICTIONAL-AGREEMENT"],
            ["Support-E-Mail", "support@example.invalid"],
            ["Geprüfter Git-Commit (SHA)", "1".repeat(40)],
            ["Kontoplätze", "40"],
            ["Speicherlimit in Byte", "3000000000"],
            ["API-Anfragen pro Minute", "130"],
        ]) {
            await page.getByLabel(label, {exact: true}).fill(value);
        }
        await page.getByLabel("Standarddarstellung", {exact: true}).selectOption("dark");
        const submit = page.getByRole("button", {name: "Privaten Entwurf herunterladen"});
        await submit.click();
        await expect(page.getByText("Die Adresse muss zu einem aktiven Firmenkonto dieses Unternehmens gehören.")).toBeVisible();

        await checked(service.from("client_organisation_memberships").insert({user_id: customer.id, organisation_id: organisation}));
        const result = page.waitForEvent("download");
        await submit.click();
        const download = await result;
        expect(download.suggestedFilename()).toBe("academy-customer-draft.json");
        const code = JSON.parse(await readFile((await download.path())!, "utf8"));
        expect(code).toMatchObject({
            version: 1,
            legal_customer_name: companyName,
            branding: {name: "Fictional Training Academy", theme: "dark"},
            initial_administrator: {email: customer.email, username: "practice-admin"},
            target: {edition: "customer-self-hosted"},
            licence: {limits: {seat_count: 40, storage_bytes: 3000000000}},
        });
        expect(await checked(service.from("user_roles").select("role").eq("user_id", customer.id)))
            .toEqual([{role: "client"}]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        const accessibility = await new AxeBuilder({page})
            .include(".white-label-draft").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(accessibility.violations).toEqual([]);

        const managerContext = await browser.newContext();
        try {
            const managerPage = await managerContext.newPage();
            await login(managerPage, manager.email);
            await managerPage.goto("/admin/white-label");
            await expect(managerPage.getByText(/nur für aktive Administratoren und Owner/)).toBeVisible();
            await expect(managerPage.getByRole("link", {name: "White Label", exact: true})).toHaveCount(0);
            await expect(managerPage.getByRole("switch", {name: "White-Label-Einrichtung öffnen"})).toHaveCount(0);
        } finally {
            await managerContext.close();
        }
    } finally {
        await service.from("client_organisation_memberships").delete().eq("organisation_id", organisation);
        await service.from("organisations").delete().eq("id", organisation);
        for (const person of [admin, manager, customer]) await service.auth.admin.deleteUser(person.id);
    }
});
