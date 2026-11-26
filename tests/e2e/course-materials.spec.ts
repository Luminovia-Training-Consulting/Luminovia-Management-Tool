/** Native course file sharing and catalogue discovery through Auth, the scanner and the protected download gateway. */
import {expect, type BrowserContext, type Page, test} from "@playwright/test";
import {createHash, randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {actor, api, checked, login} from "./helpers/accounts-support";

test.skip(process.env.PORTAL_TEST_MODE !== "1", "Course materials require canonical disposable services.");

async function signIn(email: string) {
    const client = api(process.env.SUPABASE_ANON_KEY!);
    const {session} = await checked(client.auth.signInWithPassword({email, password: process.env.E2E_PASSWORD!}), {
        requireData: true,
    });
    if (!session) throw new Error("Fictional actor has no authenticated session");
    return {client, accessToken: session.access_token};
}

async function fixture() {
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const manager = await actor("Fictional materials manager", "admin");
    const teacher = await actor("Fictional assigned lecturer", "lecturer");
    const learner = await actor("Fictional enrolled learner", "participant");
    const otherLearner = await actor("Fictional learner without enrolment", "participant");
    const otherTeacher = await actor("Fictional unassigned lecturer", "lecturer");
    const company = await actor("Fictional course company contact", "client");
    const organisation = randomUUID();
    const template = randomUUID();
    const run = randomUUID();
    const job = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    const title = `Fictional course materials ${suffix}`;
    await checked(service.from("organisations").insert({id: organisation, name: `Fictional academy ${suffix}`}));
    await checked(service.from("course_templates").insert({id: template, title}));
    await checked(service.from("course_runs").insert({id: run, template_id: template,
        organisation_id: organisation, time_zone: "Europe/Berlin"}));
    const stageForReuse = randomUUID();
    const reuseTemplate = randomUUID();
    const reuseTitle = `Fictional reuse course ${suffix}`;
    await checked(service.from("course_templates").insert({id: reuseTemplate, title: reuseTitle}));
    await checked(service.from("course_runs").insert({id: stageForReuse, template_id: reuseTemplate,
        organisation_id: organisation, time_zone: "Europe/Berlin"}));
    await checked(service.from("course_sessions").insert({course_run_id: run,
        starts_at: new Date(Date.now() + 86400000).toISOString(),
        ends_at: new Date(Date.now() + 90000000).toISOString()}));
    await checked(service.from("jobs").insert({id: job, course_run_id: run, title,
        customer_name: `Fictional academy ${suffix}`, delivery_type: "online", status: "filled",
        amount: 100, total_amount: 100, currency: "EUR", rate_unit: "fixed_total", terms: "Fictional terms"}));
    await checked(service.from("job_claims").insert({job_id: job, lecturer_id: teacher.id,
        idempotency_key: randomUUID(), amount: 100, total_amount: 100, currency: "EUR", rate_unit: "fixed_total",
        terms: "Fictional terms", terms_version: 1}));
    await checked(service.from("client_organisation_memberships").insert({user_id: company.id, organisation_id: organisation}));

    const {client: admin} = await signIn(manager.email);
    await checked(admin.rpc("set_company_premium", {p_organisation_id: organisation, p_enabled: true,
        p_expected_version: 0, p_request_id: randomUUID()}));
    for (const participant of [learner, otherLearner]) {
        const profile = await checked(service.from("profiles").select("luminovia_user_id").eq("id", participant.id).single(), {
            requireData: true,
        });
        await checked(admin.rpc("request_company_participant_link", {p_organisation_id: organisation,
            p_luminovia_user_id: profile.luminovia_user_id, p_request_id: randomUUID()}));
        const {client: participantClient} = await signIn(participant.email);
        const invites = await checked(participantClient.rpc("my_company_participant_invitations"), {requireData: true});
        const invite = invites.find((entry: {organisation_id: string}) => entry.organisation_id === organisation);
        expect(invite).toBeDefined();
        await checked(participantClient.rpc("accept_company_participant_invitation", {p_organisation_id: organisation,
            p_expected_version: invite.version, p_request_id: randomUUID()}));
    }
    await checked(admin.rpc("manage_course_enrolment", {p_course_run_id: run, p_user_id: learner.id, p_status: "enrolled"}));
    return {service, admin, manager, teacher, learner, otherLearner, otherTeacher, company, run, title, suffix, stageForReuse, reuseTitle};
}

const courseFiles = (page: Page) => page.getByRole("region", {name: "Kursdateien", exact: true});
const courseFile = (page: Page, name: string) => courseFiles(page).getByRole("listitem").filter({
    has: page.getByText(name, {exact: true}),
});
const materialsPath = "/learning?view=materials";
const materialLibrary = (page: Page) => page.getByRole("region", {name: "Kursmaterialien", exact: true});
const libraryFile = (page: Page, name: string) => materialLibrary(page).getByRole("listitem").filter({
    has: page.getByText(name, {exact: true}),
});
const editMetadataName = "Metadaten bearbeiten";
const withdrawName = "Aus Kurs entfernen";

/** Share fixtures only with audiences accepted by the course selector and server action. */
type CourseResourceAudience = "all" | "staff" | "client" | "participants";

async function upload(page: Page, name: string, bytes: Buffer, audience: CourseResourceAudience) {
    const files = courseFiles(page);
    await files.getByLabel("Datei auswählen", {exact: true}).setInputFiles({name, mimeType: "text/plain", buffer: bytes});
    await files.locator("#upload-resource-audience").selectOption(audience);
    await files.getByRole("button", {name: "Datei prüfen und freigeben", exact: true}).click();
    await expect(files.getByRole("status").filter({hasText: "Geprüfte Dateifassung für den Kurs freigegeben."}))
        .toBeVisible({timeout: 45_000});
    await expect(courseFile(page, name)).toBeVisible();
}

test("the assigned lecturer can scan, share, describe and withdraw their own course material within the audience", async ({page, browser}) => {
    test.setTimeout(150_000);
    const f = await fixture();
    const path = `/courses/${f.run}/workspace#course-materials`;
    const staffName = `Fictional-staff-${f.suffix}.txt`;
    const participantName = `Fictional-course-${f.suffix}.txt`;
    const participantBytes = Buffer.from(`Fictional reviewed course material ${f.suffix}.`);
    const materialTitle = "Fictional orbital map";
    const description = "Practice reading a fictional star chart.";
    const subject = `Orbital cartography ${f.suffix}`;
    const participantTag = `chart-exercise-${f.suffix}`;
    const staffTag = `tutor-notes-${f.suffix}`;
    const contexts: BrowserContext[] = [];

    async function openAs(email: string, landing = /\/$/) {
        const context = await browser.newContext({viewport: page.viewportSize() ?? undefined});
        contexts.push(context);
        const accountPage = await context.newPage();
        await login(accountPage, email, landing);
        await accountPage.goto(path);
        return accountPage;
    }

    async function unavailable(accountPage: Page, accessToken: string, id: string) {
        const response = await accountPage.request.post(`${process.env.SUPABASE_URL}/functions/v1/course-documents`, {
            headers: {origin: new URL(accountPage.url()).origin, apikey: process.env.SUPABASE_ANON_KEY!,
                authorization: `Bearer ${accessToken}`},
            data: {kind: "resource", id},
        });
        expect(response.status()).toBe(403);
        expect(await response.json()).toEqual({error: "document_unavailable"});
    }

    try {
        const adminPage = await openAs(f.manager.email);
        await upload(adminPage, staffName, Buffer.from("Fictional teaching team briefing."), "staff");
        await login(page, f.teacher.email);
        await page.goto(path);
        const staffFile = courseFile(page, staffName);
        await expect(staffFile.getByText("Verwaltung", {exact: false})).toBeVisible();
        await expect(staffFile.getByRole("button", {name: withdrawName, exact: true})).toHaveCount(0);
        await upload(page, participantName, participantBytes, "participants");
        const ownFile = courseFile(page, participantName);
        await expect(ownFile.getByText("Lehrkraft", {exact: false})).toBeVisible();

        const document = await checked(f.service.from("documents").select("id,owner_id,scope,current_version_id")
            .eq("original_name", participantName).single(), {requireData: true});
        expect(document).toMatchObject({owner_id: f.teacher.id, scope: "personal"});
        const version = await checked(f.service.from("document_versions").select("status,sha256")
            .eq("id", document.current_version_id).single(), {requireData: true});
        expect(version).toEqual({status: "clean", sha256: createHash("sha256").update(participantBytes).digest("hex")});
        const course = await checked(f.admin.rpc("course_workspace", {p_run_id: f.run}), {requireData: true});
        const staffResource = course.resources.find((entry: {name: string}) => entry.name === staffName);
        const participantResource = course.resources.find((entry: {name: string}) => entry.name === participantName);
        expect(staffResource).toMatchObject({audience: "staff", ownership_kind: "staff"});
        expect(participantResource).toMatchObject({audience: "participants", ownership_kind: "lecturer",
            version_id: document.current_version_id, sha256: version.sha256});
        const teacher = await signIn(f.teacher.email);
        const forbiddenWithdrawal = await teacher.client.rpc("course_workspace_action", {p_run_id: f.run,
            p_action: "resource_remove", p_payload: {id: staffResource.id}, p_expected_version: 0});
        expect(forbiddenWithdrawal.error?.code).toBe("42501");

        // Tag the existing staff share as its manager; no extra upload or browser setup.
        expect(await checked(f.admin.rpc("set_course_material_metadata", {
            p_resource_id: staffResource.id, p_expected_revision: 0,
            p_metadata: {title: "", description: "", subject: "", language: "", licence: "", tags: [staffTag]},
        }), {requireData: true})).toBe(1);

        await page.goto(materialsPath);
        await materialLibrary(page).getByRole("searchbox").fill(participantName);
        const editableMaterial = libraryFile(page, participantName);
        await editableMaterial.getByRole("button", {name: editMetadataName, exact: true}).click();
        await page.getByLabel("Titel", {exact: true}).fill(materialTitle);
        await page.getByLabel("Beschreibung", {exact: true}).fill(description);
        await page.getByLabel("Fachgebiet", {exact: true}).fill(subject);
        const objectives = `Fictional objectives ${f.suffix}`;
        await page.getByLabel("Lernziele", {exact: true}).fill(objectives);
        await page.getByLabel("Prüfdatum", {exact: true}).fill("2028-02-29");
        await page.getByLabel("Schlagwörter", {exact: true}).fill(`map-review, ${participantTag}`);
        await page.getByRole("button", {name: "Metadaten speichern", exact: true}).click();
        await expect(editableMaterial.getByText(materialTitle, {exact: true})).toBeVisible();
        await editableMaterial.getByText("Metadatenverlauf", {exact: true}).click();
        const history = editableMaterial.locator("details");
        await expect(history.getByText(objectives, {exact: false})).toBeVisible();
        await expect(history.locator('time[datetime="2028-02-29"]')).toBeVisible();
        // Reuse the manager-owned staff share without giving learners access in either course.
        await adminPage.goto(materialsPath);
        await materialLibrary(adminPage).getByRole("searchbox").fill(staffName);
        await libraryFile(adminPage, staffName).getByRole("button", {name: "In weiterem Kurs verwenden"}).click();
        const reuse = adminPage.getByRole("dialog", {name: "In weiterem Kurs verwenden"});
        await reuse.getByLabel("Zielkurs", {exact: true}).selectOption(f.stageForReuse);
        await reuse.getByLabel("Aktuelle Metadaten für den Zielkurs kopieren").check();
        await reuse.getByRole("button", {name: "Im Zielkurs freigeben"}).click();
        await expect(reuse.getByText("Material im Zielkurs freigegeben.")).toBeVisible();
        const target = await checked(f.admin.rpc("course_workspace",
            {p_run_id: f.stageForReuse}), {requireData: true});
        expect(target.resources[0]).toMatchObject({
            version_id: staffResource.version_id, audience: "staff", category: "material",
        });
        await page.goto(path);

        const learnerPage = await openAs(f.learner.email, /\/learning$/);
        const learner = await signIn(f.learner.email);
        const sharedFile = courseFile(learnerPage, participantName);
        await expect(sharedFile).toBeVisible();
        await expect(courseFile(learnerPage, staffName)).toHaveCount(0);
        await expect(courseFiles(learnerPage).getByLabel("Datei auswählen", {exact: true})).toHaveCount(0);
        await expect(sharedFile.getByRole("button", {name: withdrawName, exact: true})).toHaveCount(0);
        const download = learnerPage.waitForEvent("download");
        await sharedFile.getByRole("button", {name: "Herunterladen", exact: true}).click();
        const file = await download;
        expect(file.suggestedFilename()).toBe(participantName);
        expect(await readFile(await file.path())).toEqual(participantBytes);
        await unavailable(learnerPage, learner.accessToken, staffResource.id);

        const materialQuery = {p_course_id: null, p_search: f.suffix, p_category: "material", p_offset: 0};
        expect((await checked(learner.client.rpc("search_course_materials", materialQuery), {requireData: true}))
            .map((resource: {name: string}) => resource.name)).toEqual([participantName]);
        await learnerPage.goto(materialsPath);
        const learnerLibrary = materialLibrary(learnerPage);
        const search = learnerLibrary.getByRole("searchbox");
        const noMatches = learnerLibrary.getByText("Keine passenden Dateien gefunden.", {exact: true});
        const sharedMaterial = libraryFile(learnerPage, participantName);

        // Start each metadata lookup from a settled empty result, so a stale row cannot pass the assertion.
        await search.fill(staffName);
        await expect(noMatches).toBeVisible();
        await search.fill(subject);
        await expect(sharedMaterial.getByText(description, {exact: true})).toBeVisible();
        await expect(sharedMaterial.getByText("Metadatenverlauf", {exact: true})).toHaveCount(0);
        const deniedHistory = await learner.client.rpc("course_material_metadata_history", {
            p_resource_id: participantResource.id,
            p_before: null,
        });
        expect(deniedHistory.error?.code).toBe("42501");
        await search.fill(staffTag);
        await expect(noMatches).toBeVisible();
        await expect(learnerLibrary.getByRole("listitem")).toHaveCount(0);
        await search.fill(participantTag);
        await expect(sharedMaterial.getByText(materialTitle, {exact: true})).toBeVisible();
        await expect(sharedMaterial.getByText(description, {exact: true})).toBeVisible();
        await expect(sharedMaterial.getByRole("button", {name: `${participantName} herunterladen`, exact: true})).toBeVisible();
        await expect(sharedMaterial.getByRole("button", {name: editMetadataName, exact: true})).toHaveCount(0);
        await learnerPage.goto(path);
        const mobileNavigation = learnerPage.getByLabel("Kursbereich", {exact: true});
        if ((learnerPage.viewportSize()?.width ?? Infinity) <= 850) {
            await expect(mobileNavigation).toHaveValue("course-materials");
            await expect(learnerPage.locator("#course-overview")).toBeHidden();
            await mobileNavigation.selectOption("course-overview");
            await expect(learnerPage.locator("#course-overview")).toBeVisible();
            await expect(learnerPage.locator("#course-materials")).toBeHidden();
            await learnerPage.locator(".course-room-mobile-navigation").getByRole("link", {name: "Materialien"}).click();
            await expect(sharedFile).toBeVisible();
        }

        const companyPage = await openAs(f.company.email);
        await expect(courseFiles(companyPage)).toBeVisible();
        await expect(courseFile(companyPage, participantName)).toHaveCount(0);
        const company = await signIn(f.company.email);
        await unavailable(companyPage, company.accessToken, participantResource.id);
        const sharedCompanyName = `Fictional-company-visible-${f.suffix}.txt`;
        const sharedCompanyBytes = Buffer.from(`Fictional file shared by lecturer ${f.suffix}`);
        await upload(page, sharedCompanyName, sharedCompanyBytes, "client");
        await companyPage.reload();
        const companyFile = courseFile(companyPage, sharedCompanyName);
        const companyDownload = companyPage.waitForEvent("download");
        await companyFile.getByRole("button", {name: "Herunterladen", exact: true}).click();
        expect(await readFile(await (await companyDownload).path())).toEqual(sharedCompanyBytes);
        const managerView = await checked(f.admin.rpc("course_workspace", {p_run_id: f.run}), {requireData: true});
        const companyResource = managerView.resources.find((entry: {name: string}) => entry.name === sharedCompanyName);
        await companyFile.getByRole("button", {name: withdrawName, exact: true}).click();
        const companyConfirmation = companyPage.getByRole("dialog", {name: `„${sharedCompanyName}“ aus dem Kurs entfernen?`, exact: true});
        await companyConfirmation.getByRole("button", {name: withdrawName, exact: true}).click();
        await expect(companyFile).toHaveCount(0);
        await unavailable(companyPage, company.accessToken, companyResource.id);
        const revokedOwnedFile = await checked(f.service.from("documents").select("owner_id,deleted_at")
            .eq("original_name", sharedCompanyName).single(), {requireData: true});
        expect(revokedOwnedFile).toEqual({owner_id: f.teacher.id, deleted_at: null});

        for (const excluded of [{...f.otherLearner, landing: /\/learning$/}, {...f.otherTeacher, landing: /\/$/}]) {
            const excludedPage = await openAs(excluded.email, excluded.landing);
            await expect(excludedPage.getByRole("alert")).toBeVisible();
            await expect(excludedPage.getByRole("heading", {name: f.title, exact: true})).toHaveCount(0);
            await unavailable(excludedPage, (await signIn(excluded.email)).accessToken, participantResource.id);
        }

        await ownFile.getByRole("button", {name: withdrawName, exact: true}).click();
        const confirmation = page.getByRole("dialog", {name: `„${participantName}“ aus dem Kurs entfernen?`, exact: true});
        await confirmation.getByRole("button", {name: withdrawName, exact: true}).click();
        await expect(ownFile).toHaveCount(0);
        await expect(staffFile).toBeVisible();
        await learnerPage.reload();
        await expect(courseFiles(learnerPage)).toBeVisible();
        await expect(sharedFile).toHaveCount(0);
        await unavailable(learnerPage, learner.accessToken, participantResource.id);
        const retained = await checked(f.service.from("documents").select("current_version_id,deleted_at")
            .eq("id", document.id).single(), {requireData: true});
        expect(retained).toEqual({current_version_id: document.current_version_id, deleted_at: null});
    } finally {
        await Promise.all(contexts.map((context) => context.close()));
    }
});
