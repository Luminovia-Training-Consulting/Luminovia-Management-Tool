/** Verify the shared portal saves and reloads Academy settings without changing customer roles. */
import {expect, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {actor, api, checked, login} from "./helpers/accounts-support";

test.skip(process.env.PORTAL_TEST_MODE !== "1", "Requires the isolated portal fixtures.");

test("admin saves Academy settings only for an active company member", async ({page, browser}) => {
    test.setTimeout(90000);
    const project = /^project_id\s*=\s*"(luminovia-portal-test-[a-f0-9]{8})"$/m.exec(
        readFileSync("supabase/config.toml", "utf8"),
    )?.[1];
    if (!project || process.env.PORTAL_TEST_MODE !== "1") throw new Error("Disposable White Label fixture required");
    const admin = await actor("Fictional White Label operator", "admin");
    const manager = await actor("Fictional White Label manager", "management");
    const customer = await actor("Fictional Academy coordinator", "client");
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const organisation = randomUUID();
    const companyName = `Fictional Academy Company ${organisation.slice(0, 8)}`;
    try {
        await checked(service.from("organisations").insert({id: organisation, name: companyName}));
        await login(page, admin.email);
        await page.goto("/admin/platform");
        await expect(page.getByRole("link", {name: /^White Label(?: |$)/})).toBeVisible();
        await page.getByRole("link", {name: /^White Label(?: |$)/}).click();
        const open = page.getByRole("switch", {name: "White-Label-Einrichtung öffnen"});
        await expect(open).not.toBeChecked();
        await open.press("Space");
        await expect(open).toBeChecked();
        await page.getByLabel("Unternehmen", {exact: true}).selectOption(organisation);
        await expect(page.getByLabel("Rechtlicher Firmenname")).toHaveValue(companyName);
        await expect(page.getByLabel(/Benutzername in der Akademie/)).toHaveCount(0);
        for (const [label, value] of [
            ["E-Mail des Firmenkontos", customer.email],
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
        const submit = page.getByRole("button", {name: "Einstellungen speichern"});
        await submit.click();
        await expect(page.getByText("Die Adresse muss zu einem aktiven Firmenkonto dieses Unternehmens gehören.")).toBeVisible();

        await checked(service.from("client_organisation_memberships").insert({user_id: customer.id, organisation_id: organisation}));
        const downloads: string[] = [];
        page.on("download", (file) => downloads.push(file.suggestedFilename()));
        await submit.click();
        await expect(page.getByText("Einstellungen gespeichert.")).toBeVisible();
        await page.reload();
        await open.press("Space");
        await page.getByLabel("Unternehmen", {exact: true}).selectOption(organisation);
        await expect(page.getByLabel("Name der Akademie")).toHaveValue("Fictional Training Academy");
        await expect(page.getByLabel("Standarddarstellung")).toHaveValue("dark");
        await expect(page.getByLabel("Datenregion")).toHaveValue("eu-central");
        await expect(page.getByLabel("Kontoplätze")).toHaveValue("40");
        const adminApi = api(process.env.SUPABASE_ANON_KEY!);
        const managerApi = api(process.env.SUPABASE_ANON_KEY!);
        await checked(adminApi.auth.signInWithPassword({email: admin.email, password: process.env.E2E_PASSWORD!}));
        await checked(managerApi.auth.signInWithPassword({email: manager.email, password: process.env.E2E_PASSWORD!}));
        const current = await checked(adminApi.rpc("academy_customer_setup", {p_organisation_id: organisation}), {requireData: true});
        const conflicting = {...current.settings, legal_customer_name: "Older edit"};
        const stale = await adminApi.rpc("academy_customer_setup", {
            p_organisation_id: organisation, p_expected_revision: 0, p_settings: conflicting,
        });
        expect(stale.status).toBe(409);
        expect((await managerApi.rpc("academy_customer_setup", {p_organisation_id: organisation})).status).toBe(403);
        expect(downloads).toEqual([]);
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
            await expect(managerPage).toHaveURL(/\/admin\/white-label$/);
            await expect(managerPage.getByRole("heading", {name: "Diese Seite wurde nicht gefunden.", exact: true})).toBeFocused();
            await expect(managerPage.getByRole("link", {name: /^White Label(?: |$)/})).toHaveCount(0);
            await expect(managerPage.getByRole("switch", {name: "White-Label-Einrichtung öffnen"})).toHaveCount(0);
        } finally {
            await managerContext.close();
        }
    } finally {
        execFileSync("docker", ["exec", "-i", `supabase_db_${project}`, "psql", "-U", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
            input: `delete from private.academy_customer_settings where organisation_id = '${organisation}';`,
        });
        await service.from("client_organisation_memberships").delete().eq("organisation_id", organisation);
        await service.from("organisations").delete().eq("id", organisation);
        for (const person of [admin, manager, customer]) await service.auth.admin.deleteUser(person.id);
    }
});
