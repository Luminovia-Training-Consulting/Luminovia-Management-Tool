/**
 * Browser workflows for course source templates, planned sessions and lecturer-visible net claims.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import {expect, type Page, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {assertPointerReady} from "./helpers/pointer-readiness";
import {randomUUID} from "node:crypto";
import {actor, adminLogin, api, checked, login,} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Course writes require the canonical disposable project.",
);

/** Checks the rendered state with axe; this does not replace manual accessibility acceptance. */
async function a11y(page: Page) {
    await page.evaluate(() => document.fonts.ready);
    const scan = await new AxeBuilder({page})
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
    expect(
        scan.violations.map((row) => ({
            id: row.id,
            nodes: row.nodes.map((node) => node.target),
        })),
    ).toEqual([]);
    expect(
        await page.evaluate(
            () =>
                document.documentElement.scrollWidth <=
                document.documentElement.clientWidth,
        ),
    ).toBe(true);
}

test("Course source template plans ten real sessions and one linked net-only teaching claim", async ({
                                                                                                         page,
                                                                                                         browser,
                                                                                                     }, testInfo) => {
    test.setTimeout(120000);
    const tag = randomUUID().slice(0, 8),
        admin = await actor(`Course Administration ${tag}`, "admin"),
        teacher = await actor(`Course Lecturer ${tag}`, "lecturer");
    const adminApi = api(process.env.SUPABASE_ANON_KEY!);
    expect(
        (
            await adminApi.auth.signInWithPassword({
                email: admin.email,
                password: process.env.E2E_PASSWORD!,
            })
        ).error,
    ).toBeNull();
    await checked(
        adminApi.rpc("save_lecturer_compensation", {
            p_user_id: teacher.id,
            p_mode: "percent",
            p_percent: 31,
            p_daily_rate: 200,
            p_currency: "EUR",
            p_expected_version: 1,
        }),
    );
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const block = await checked(
        service
            .from("building_blocks")
            .select("*,building_block_sources(*)")
            .eq("code", "LPC3")
            .single(),
    );
    const primary = block.building_block_sources.find(
        (row: { is_primary: boolean }) => row.is_primary,
    );
    const org = randomUUID();
    await checked(
        service
            .from("organisations")
            .insert({id: org, name: `Fictional Course UI ${tag}`}),
    );
    await adminLogin(page, admin);
    await page.goto("/courses");
    await page
        .getByRole("link", {name: "Kursvorlagen öffnen", exact: true})
        .click();
    await page
        .getByRole("searchbox", {name: "Suchen", exact: true})
        .fill("LPC3");
    const sourceCard = page.locator("article").filter({
        has: page.getByText("LPC3", {exact: true}),
    });
    await expect(
        sourceCard.getByRole("button", {name: "Ansehen", exact: true}),
    ).toBeVisible();
    await page.getByLabel("Sprache", {exact: true}).selectOption("en");
    await expect(
        page.getByRole("searchbox", {name: "Search", exact: true}),
    ).toHaveValue("LPC3");
    await page.getByLabel("Theme", {exact: true}).selectOption("dark");
    await expect(
        sourceCard.getByRole("button", {name: "View", exact: true}),
    ).toBeVisible();
    await a11y(page);
    await page.screenshot({
        path: `.local/screenshots/${testInfo.project.name}-course-building-blocks-catalogue-dark-en.png`,
        fullPage: true,
    });
    await page.getByLabel("Language", {exact: true}).selectOption("de");
    await page.getByLabel("Farbschema", {exact: true}).selectOption("light");
    const sourceAction = sourceCard.getByRole("button", {
        name: "Ansehen",
        exact: true,
    });
    await assertPointerReady(sourceAction, "course source details");
    await sourceAction.click();
    const sourceDialog = page.getByRole("dialog").filter({
        has: page.getByRole("region", {name: "Quellenreferenz", exact: true}),
    });
    await expect(
        sourceDialog.getByText("Bausteinbeschreibung-LPIC3.pdf", {exact: true}),
    ).toBeVisible();
    await expect(
        sourceDialog.getByText("Bausteinbeschreibung_LPC3.pdf", {exact: true}),
    ).toBeVisible();
    await sourceDialog
        .getByText("SHA-256-Prüfsumme anzeigen", {exact: true})
        .first()
        .click();
    await expect(sourceDialog.locator("code").first()).toHaveText(primary.sha256);
    const note = `Fictional reusable Course note ${tag} <script>literal only</script>`;
    await sourceDialog.getByLabel("Dein Kommentar", {exact: true}).fill(note);
    await sourceDialog
        .getByRole("button", {name: "Kommentar veröffentlichen", exact: true})
        .click();
    await expect(sourceDialog.getByText(note, {exact: true})).toBeVisible();
    await a11y(page);
    await page.screenshot({
        path: `.local/screenshots/${testInfo.project.name}-course-building-blocks-source-reference.png`,
        fullPage: true,
    });
    await sourceDialog
        .getByRole("button", {name: "Aus Vorlage erstellen", exact: true})
        .click();
    const runDialog = page.getByRole("dialog", {
        name: "Kurs anlegen",
        exact: true,
    });
    await expect(
        runDialog.getByLabel("Kursvorlage", {exact: true}),
    ).toHaveValue(block.default_template_id);
    await runDialog.getByLabel("Organisation", {exact: true}).selectOption(org);
    await runDialog
        .getByLabel("Erster Unterrichtstag", {exact: true})
        .fill("2037-07-06");
    await runDialog
        .getByRole("button", {name: "10 Werktagstermine erzeugen", exact: true})
        .click();
    await expect(runDialog.getByLabel(/^Beginn \d+$/)).toHaveCount(10);
    await expect(runDialog.getByLabel(/^Ende \d+$/)).toHaveCount(10);
    await runDialog
        .getByLabel("Ort / Zugangslink", {exact: true})
        .fill("Fictional Course online classroom");
    await runDialog
        .getByRole("button", {name: "Entwurf speichern", exact: true})
        .click();
    await expect(runDialog).not.toBeVisible();
    const run = await checked(
        service
            .from("course_runs")
            .select("id,template_id,course_sessions(*)")
            .eq("organisation_id", org)
            .single(),
    );
    expect(run.template_id).toBe(block.default_template_id);
    expect(run.course_sessions).toHaveLength(10);
    await page.goto(`/courses?run=${run.id}`);
    const courseDialog = page.getByRole("dialog", {name: /LPC3/});
    await courseDialog
        .getByRole("link", {name: "Auftrag für die Stellenbörse erstellen", exact: true})
        .click();
    await expect(page).toHaveURL(new RegExp(`/admin\\?courseRun=${run.id}`));
    await expect(
        page.getByRole("heading", {name: "Auftrag aus diesem Kurs", exact: true}),
    ).toBeVisible();
    await expect(page.getByLabel("Titel", {exact: true})).toHaveCount(0);
    await expect(page.getByLabel(/^Beginn \d+$/)).toHaveCount(0);
    await page
        .getByLabel("Voller Auftragspreis je Einheit", {exact: true})
        .fill("100");
    await page
        .getByLabel("Voller Auftragspreis gesamt", {exact: true})
        .fill("1000");
    await page
        .getByLabel("Konditionen (optional)", {exact: true})
        .fill(`Fictional Course complete-block terms ${tag}`);
    await page
        .getByLabel("Gültiger Rahmenvertrag erforderlich", {exact: true})
        .uncheck();
    await page
        .getByRole("button", {name: "In der Stellenbörse veröffentlichen", exact: true})
        .click();
    await expect(
        page.getByRole("link", {name: "Erstellten Auftrag öffnen", exact: true}),
    ).toBeVisible();
    const created = await checked(
        service
            .from("jobs")
            .select("id,course_run_id,total_amount,job_sessions(*)")
            .eq("course_run_id", run.id)
            .single(),
    );
    expect(created.course_run_id).toBe(run.id);
    expect(created.total_amount).toBe(0);
    expect(created.job_sessions).toHaveLength(10);
    expect(
        created.job_sessions
            .map((row: { course_session_id: string }) => row.course_session_id)
            .sort(),
    ).toEqual(run.course_sessions.map((row: { id: string }) => row.id).sort());
    await page
        .getByRole("link", {name: "Erstellten Auftrag öffnen", exact: true})
        .click();
    await expect(page).toHaveURL(`/jobs/${created.id}`);
    await expect(
        page.getByText("Bausteinbeschreibung-LPIC3.pdf", {exact: true}),
    ).toBeVisible();
    const context = await browser.newContext({
        baseURL: process.env.E2E_BASE_URL!,
        viewport: testInfo.project.use.viewport,
        isMobile: testInfo.project.use.isMobile,
        hasTouch: testInfo.project.use.hasTouch,
    });
    try {
        const lecturerPage = await context.newPage();
        await login(lecturerPage, teacher.email);
        await lecturerPage.goto(`/jobs/${created.id}`);
        await expect(lecturerPage.locator(".claim-panel .amount")).toHaveText(
            /310,00/,
        );
        await expect(lecturerPage.getByText(/1\.000,00/)).toHaveCount(0);
        await expect(
            lecturerPage.getByText("Bausteinbeschreibung-LPIC3.pdf", {exact: true}),
        ).toBeVisible();
        await expect(
            lecturerPage.getByRole("region", {
                name: "Quellenreferenz",
                exact: true,
            }),
        ).toHaveCSS("border-top-style", "solid");
        await lecturerPage
            .getByLabel("Konditionen akzeptieren", {exact: true})
            .check();
        await lecturerPage
            .getByRole("button", {name: "Auftrag übernehmen", exact: true})
            .click();
        await expect(
            lecturerPage
                .getByRole("status")
                .filter({hasText: /Dein Auftrag ist bestätigt/}),
        ).toBeVisible();
        const claims = await checked(
            service
                .from("job_claims")
                .select("id,total_amount,assignment_sessions(*)")
                .eq("job_id", created.id),
        );
        expect(claims).toHaveLength(1);
        expect(claims[0].total_amount).toBe(310);
        expect(claims[0].assignment_sessions).toHaveLength(10);
        await a11y(lecturerPage);
        await lecturerPage.screenshot({
            path: `.local/screenshots/${testInfo.project.name}-course-building-blocks-linked-job.png`,
            fullPage: true,
        });
    } finally {
        await context.close();
    }
});
test("Company portal authors a template and saves an unpublished run", async ({page}) => {
    const tag = randomUUID().slice(0, 8);
    const company = await actor(`Fictional template planner ${tag}`, "client");
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const organisationId = randomUUID();
    const organisationName = `Fictional practice academy ${tag}`;
    const title = `Linux practice day ${tag}`;
    await checked(service.from("organisations").insert({
        id: organisationId,
        name: organisationName,
    }));
    await checked(service.from("client_organisation_memberships").insert({
        organisation_id: organisationId,
        user_id: company.id,
    }));
    await login(page, company.email);
    await page.goto("/client");
    await page.getByRole("link", {name: "Kursvorlagen öffnen", exact: true}).click();
    await expect(page).toHaveURL("/courses?tab=templates");
    await page.getByRole("button", {name: "Vorlage anlegen", exact: true}).click();
    const create = page.getByRole("dialog", {name: "Vorlage anlegen", exact: true});
    await expect(create.getByLabel("Unternehmen der Vorlage")).toHaveValue(organisationId);
    await create.getByLabel("Titel", {exact: true}).fill(title);
    await create.getByRole("button", {name: "Speichern", exact: true}).click();
    await expect(create).not.toBeVisible();

    const template = page.locator("article").filter({
        has: page.getByRole("heading", {name: title, exact: true}),
    });
    await template.getByRole("button", {name: "Bearbeiten", exact: true}).click();
    const edit = page.getByRole("dialog", {name: "Bearbeiten", exact: true});
    const editedTitle = `${title} · Workshop`;
    await edit.getByLabel("Titel", {exact: true}).fill(editedTitle);
    await edit.getByRole("button", {name: "Speichern", exact: true}).click();
    await expect(edit).not.toBeVisible();

    await page.locator("article").filter({
        has: page.getByRole("heading", {name: editedTitle, exact: true}),
    }).getByRole("button", {name: "Aus Vorlage erstellen", exact: true}).click();
    const run = page.getByRole("dialog", {name: "Kurs anlegen", exact: true});
    await expect(run.getByLabel("Organisation", {exact: true})).toHaveValue(organisationId);
    await expect(run.getByRole("button", {name: /Kurskatalog anzeigen|Auftrag für die Stellenbörse erstellen/})).toHaveCount(0);
    await run.getByLabel("Beginn 1", {exact: true}).fill("2037-07-06T09:00");
    await run.getByLabel("Ende 1", {exact: true}).fill("2037-07-06T16:00");
    await run.getByRole("button", {name: "Entwurf speichern", exact: true}).click();
    await expect(page.getByText("Durchführung als Entwurf gespeichert.", {exact: true})).toBeVisible();
    await expect(page.getByRole("heading", {name: editedTitle, exact: true})).toBeVisible();
    const saved = await checked(service.from("course_runs")
        .select("published,archived_at,course_sessions(id),jobs(id)")
        .eq("organisation_id", organisationId)
        .single(), {requireData: true});
    expect(saved).toMatchObject({published: false, archived_at: null, jobs: []});
    expect(saved.course_sessions).toHaveLength(1);
});
