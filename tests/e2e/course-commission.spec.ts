/** Exercise the course-specific price editor on the real browser and PostgreSQL. */
import {expect, test} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {actor, api, checked, login} from "./helpers/accounts-support";

test.skip(process.env.PORTAL_TEST_MODE !== "1", "Requires the isolated portal fixtures.");

test("management prices its own offer and edits it before acceptance", async ({page}) => {
    const manager = await actor("Fictional course pricing manager", "management");
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const organisation = randomUUID();
    const name = `Fictional pricing academy ${organisation.slice(0, 8)}`;
    const title = `Fictional priced course ${organisation.slice(0, 8)}`;
    await checked(service.from("organisations").insert({id: organisation, name}));
    await login(page, manager.email);
    await page.goto("/admin?create=job");
    const percentage = "Plattformanteil für diesen Auftrag (%)";
    await page.getByLabel(percentage, {exact: true}).fill("25");
    await page.locator("#job-organisation").selectOption(organisation);
    await page.getByLabel("Titel", {exact: true}).fill(title);
    await page.getByLabel("Voller Auftragspreis je Einheit", {exact: true}).fill("400");
    await page.getByLabel("Voller Auftragspreis gesamt", {exact: true}).fill("2000");
    await page.getByLabel("Konditionen", {exact: true}).fill("Fiktive Testkonditionen.");
    for (const [index, date] of ["12", "13", "14", "15", "16"].entries()) {
        await page.getByLabel(`Beginn ${index + 1}`, {exact: true}).fill(`2033-02-${date}T09:00`);
        await page.getByLabel(`Ende ${index + 1}`, {exact: true}).fill(`2033-02-${date}T15:00`);
    }
    const totalPreview = page.getByRole("group", {name: "Vorschau der Vergütung", exact: true}).last();
    await expect(totalPreview).toContainText("1.500,00");
    await expect(totalPreview).toContainText("500,00");
    await expect(page.getByText("Senior-Dozent:in – Standardanteil", {exact: false})).toHaveCount(0);
    const create = page.waitForResponse(
        (response) => response.request().method() === "POST" &&
            new URL(response.url()).pathname.endsWith("/rest/v1/rpc/training_offer_creator_draft_action") &&
            response.request().postDataJSON()?.p_action === "commit",
    );
    await page.getByRole("button", {name: "Auftrag speichern", exact: true}).click();
    const created = await create;
    expect(created.ok()).toBe(true);
    const {job_id: id} = await created.json();

    const managerApi = api(process.env.SUPABASE_ANON_KEY!);
    await checked(managerApi.auth.signInWithPassword({email: manager.email, password: process.env.E2E_PASSWORD!}));
    const policy = () => checked(managerApi.rpc("commission_offer_policy", {p_job_id: id}));
    expect(await policy()).toMatchObject({platform_percent_override: 25});
    await page.goto(`/jobs/${id}`);
    await page.getByRole("button", {name: "Preisaufteilung bearbeiten", exact: true}).click();
    const editor = page.getByRole("dialog", {name: "Auftragspreis & Aufteilung", exact: true});
    await expect(editor.getByLabel(percentage, {exact: true})).toHaveValue("25");
    await editor.getByLabel(percentage, {exact: true}).fill("40");
    await expect(editor.getByRole("group", {name: "Vorschau der Vergütung", exact: true}).last())
        .toContainText("1.200,00");
    await editor.getByRole("button", {name: "Preisaufteilung speichern", exact: true}).click();
    await expect(editor).toBeHidden();
    expect(await policy()).toMatchObject({platform_percent_override: 40});
    await expect(page.getByRole("heading", {name: title, exact: true})).toBeVisible();
});
