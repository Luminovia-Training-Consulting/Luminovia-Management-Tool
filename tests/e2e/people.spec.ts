/**
 * Browser workflows for shared staff profiles, course history and reviews by authorised client companies.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import {expect, type Page, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
import {actor, adminLogin, api, checked, login,} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Profile workflows require the isolated ./portal test project.",
);

/** Checks the rendered state with axe; this does not replace manual accessibility acceptance. */
async function a11y(page: Page) {
    await page.evaluate(() => document.fonts.ready);
    const scan = await new AxeBuilder({page})
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
}

test("authored staff profiles connect real course history, company reviews and authorised moderation", async ({
                                                                                                                  page,
                                                                                                                  browser,
                                                                                                              }, testInfo) => {
    test.setTimeout(120000);
    const teacher = await actor(
            `Profile Teacher ${randomUUID().slice(0, 8)}`,
            "lecturer",
        ),
        customer = await actor(
            `Private Company Contact ${randomUUID().slice(0, 8)}`,
            "client",
        ),
        admin = await actor("Profile Administrator", "admin");
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const org = randomUUID(),
        template = randomUUID(),
        run = randomUUID(),
        job = randomUUID(),
        claim = randomUUID(),
        title = `Completed UI Course ${randomUUID().slice(0, 8)}`;
    const start = new Date(Date.now() - 2 * 86400000).toISOString(),
        end = new Date(Date.now() - 86400000).toISOString();
    await checked(
        service
            .from("organisations")
            .insert({id: org, name: "Fictional Review Academy"}),
    );
    const adminClient = api(process.env.SUPABASE_ANON_KEY!);
    await checked(adminClient.auth.signInWithPassword({
        email: admin.email, password: process.env.E2E_PASSWORD!,
    }), {requireData: true});
    // Course history and submitted company reviews are Premium projections.
    await checked(adminClient.rpc("set_company_premium", {
        p_organisation_id: org, p_enabled: true, p_expected_version: 0, p_request_id: randomUUID(),
    }));
    await checked(
        service
            .from("client_organisation_memberships")
            .insert({user_id: customer.id, organisation_id: org}),
    );
    await checked(
        service.from("course_templates").insert({
            id: template,
            title,
            syllabus: "Literal <script>safe course text</script>",
        }),
    );
    await checked(
        service.from("course_runs").insert({
            id: run,
            template_id: template,
            organisation_id: org,
            published: false,
        }),
    );
    await checked(
        service
            .from("course_sessions")
            .insert({course_run_id: run, starts_at: start, ends_at: end}),
    );
    await checked(
        service.from("course_enrolments").insert({
            course_run_id: run,
            user_id: customer.id,
            status: "completed",
            enrolled_by: customer.id,
        }),
    );
    await checked(
        service.from("jobs").insert({
            id: job,
            course_run_id: run,
            title,
            customer_name: "Fictional Review Academy",
            delivery_type: "online",
            time_zone: "Europe/Berlin",
            status: "filled",
            amount: 100,
            total_amount: 100,
            currency: "EUR",
            rate_unit: "fixed_total",
            terms: "Fictional historic net fee",
        }),
    );
    await checked(
        service
            .from("job_sessions")
            .insert({job_id: job, starts_at: start, ends_at: end}),
    );
    await checked(
        service.from("job_claims").insert({
            id: claim,
            job_id: job,
            lecturer_id: teacher.id,
            idempotency_key: randomUUID(),
            amount: 100,
            total_amount: 100,
            currency: "EUR",
            rate_unit: "fixed_total",
            terms: "Fictional historic net fee",
            terms_version: 1,
        }),
    );
    await checked(
        service.from("assignment_sessions").insert({
            claim_id: claim,
            lecturer_id: teacher.id,
            starts_at: start,
            ends_at: end,
        }),
    );
    const teacherApi = api(process.env.SUPABASE_ANON_KEY!);
    await checked(
        teacherApi.auth.signInWithPassword({
            email: teacher.email,
            password: process.env.E2E_PASSWORD!,
        }),
    );
    const forbiddenEdit = await teacherApi.rpc("managed_profile", {
        p_user_id: admin.id,
    });
    expect(forbiddenEdit.error?.code).toBe("42501");
    await login(page, teacher.email);
    await page.goto("/profile");
    const biography = `Authored profile <script>${randomUUID().slice(0, 8)}</script>`;
    const englishBiography = `English profile ${randomUUID().slice(0, 8)}`;
    await page.getByLabel("Über mich (Deutsch)", {exact: true}).fill(biography);
    await page.getByLabel("Über mich (Englisch)", {exact: true}).fill(englishBiography);
    await page
        .getByRole("button", {name: "Profil speichern", exact: true})
        .click();
    await expect(page.getByLabel("Über mich (Deutsch)", {exact: true})).toHaveValue(
        biography,
    );
    await expect(
        page.getByLabel("Eigene Labels (mit Komma trennen)", {exact: true}),
    ).toHaveCount(0);
    await page.getByLabel("Land", {exact: true}).fill("Germany");
    await page
        .getByLabel("Sprachen (mit Komma trennen)", {exact: true})
        .fill("Deutsch, English");
    await page.getByLabel("Lehrerfahrung (Jahre)", {exact: true}).fill("8");
    const form = page.locator("form").filter({
        has: page.getByLabel("Lehrerfahrung (Jahre)", {exact: true}),
    });
    await form.getByRole("button", {name: "Speichern", exact: true}).click();
    await expect(form.getByRole("status")).toContainText("Gespeichert");
    await page.reload();
    await expect(
        page.getByLabel("Lehrerfahrung (Jahre)", {exact: true}),
    ).toHaveValue("8");
    await expect(page.getByLabel("Über mich (Deutsch)", {exact: true})).toHaveValue(
        biography,
    );
    await page.getByLabel("Sprache", {exact: true}).selectOption("en");
    await expect(page.getByLabel("About me (German)", {exact: true})).toHaveValue(
        biography,
    );
    await expect(
        page.getByLabel("Teaching experience (years)", {exact: true}),
    ).toHaveValue("8");
    await expect(page.getByLabel("About me (English)", {exact: true})).toHaveValue(englishBiography);
    await page.goto("/people");
    await page.getByLabel("Search people", {exact: true}).fill(teacher.name);
    await expect(page.getByText(englishBiography, {exact: true})).toBeVisible();
    await page.getByLabel("Language", {exact: true}).selectOption("de");
    await page.getByLabel("Person suchen", {exact: true}).fill(teacher.name);
    await expect(page.getByText(biography, {exact: true})).toBeVisible();
    await expect(page.getByLabel("Label filtern", {exact: true})).toHaveCount(
        0,
    );
    await page.getByRole("link", {name: teacher.name, exact: true}).click();
    await expect(
        page.getByRole("heading", {name: teacher.name, exact: true}),
    ).toBeVisible();
    await expect(page.getByText(biography, {exact: true})).toBeVisible();
    await page.getByLabel("Sprache", {exact: true}).selectOption("en");
    await expect(page.getByText(englishBiography, {exact: true})).toBeVisible();
    await page.getByLabel("Language", {exact: true}).selectOption("de");
    await expect(
        page.getByRole("heading", {name: "Vergangene Kurse", exact: true}),
    ).toBeVisible();
    await page.getByRole("link", {name: title, exact: true}).click();
    await expect(page).toHaveURL(new RegExp(`/courses\\?run=${run}`));
    await expect(
        page.getByRole("dialog", {name: title, exact: true}),
    ).toBeVisible();
    await page.getByRole("button", {name: "Schließen", exact: true}).click();
    await expect(page).toHaveURL(/\/courses$/);
    const contextOptions = {
        baseURL: process.env.E2E_BASE_URL!,
        viewport: testInfo.project.use.viewport,
        isMobile: testInfo.project.use.isMobile,
        hasTouch: testInfo.project.use.hasTouch,
    };
    const managerContext = await browser.newContext(contextOptions);
    const companyContext = await browser.newContext(contextOptions);
    try {
        const manager = await managerContext.newPage();
        await adminLogin(manager, admin);
        await manager.goto(`/people/${teacher.id}`);
        await manager
            .getByRole("button", {name: "Profil bearbeiten", exact: true})
            .click();
        const editDialog = manager.getByRole("dialog", {
            name: "Profil bearbeiten",
            exact: true,
        });
        await editDialog
            .getByLabel("Zeitzone", {exact: true})
            .selectOption("Australia/Brisbane");
        await editDialog
            .getByRole("button", {name: "Speichern", exact: true})
            .click();
        await expect(editDialog).toBeHidden();
        const updatedProfile = await checked(
            service
                .from("profiles")
                .select("time_zone")
                .eq("id", teacher.id)
                .single(),
            {requireData: true},
        );
        expect(updatedProfile.time_zone).toBe("Australia/Brisbane");
        await manager
            .getByRole("button", {name: "Zugang sperren", exact: true})
            .click();
        await manager
            .getByRole("dialog")
            .getByRole("button", {name: "Kontostatus bestätigen", exact: true})
            .click();
        await expect(manager.getByRole("dialog")).toBeHidden();
        await manager
            .getByRole("button", {name: "Zugang aktivieren", exact: true})
            .click();
        await manager
            .getByRole("dialog")
            .getByRole("button", {name: "Kontostatus bestätigen", exact: true})
            .click();
        await expect(manager.getByRole("dialog")).toBeHidden();
        const reactivatedProfile = await checked(
            service
                .from("profiles")
                .select("active")
                .eq("id", teacher.id)
                .single(),
            {requireData: true},
        );
        expect(reactivatedProfile.active).toBe(true);
        const company = await companyContext.newPage();
        await login(company, customer.email);
        await company.goto("/my-reviews");
        const reviewForm = company.locator("article").filter({
            has: company.getByRole("heading", {name: title, exact: true}),
        });
        await reviewForm.getByLabel("Bewertung", {exact: true}).selectOption("4");
        const feedback = `Fictional clear teaching <script>${randomUUID().slice(0, 8)}</script>`;
        await reviewForm
            .getByLabel("Deine Rückmeldung", {exact: true})
            .fill(feedback);
        await reviewForm
            .getByRole("button", {name: "Bewertung speichern", exact: true})
            .click();
        await expect(
            reviewForm.getByRole("button", {
                name: "Eigene Bewertung zurückziehen",
                exact: true,
            }),
        ).toBeVisible();
        await page.goto(`/people/${teacher.id}`);
        await expect(page.getByText(feedback, {exact: true})).toBeVisible();
        await expect(page.getByText(customer.name, {exact: true})).toHaveCount(0);
        expect(await page.locator(".people-review-list script").count()).toBe(0);
        await a11y(page);
        await page.screenshot({
            path: `.local/screenshots/${testInfo.project.name}-person-profile.png`,
            fullPage: true,
        });
        await manager.goto(`/people/${teacher.id}`);
        const review = manager
            .getByRole("listitem")
            .filter({has: manager.getByText(feedback, {exact: true})});
        await review
            .getByRole("button", {name: "Ausblenden", exact: true})
            .click();
        await manager
            .getByLabel("Begründung", {exact: true})
            .fill("Fictional moderation review");
        await manager
            .getByRole("dialog")
            .getByRole("button", {name: "Speichern", exact: true})
            .click();
        await expect(manager.getByRole("dialog")).toBeHidden();
        await page.reload();
        await expect(page.getByText(feedback, {exact: true})).toHaveCount(0);
        await company.reload();
        await expect(
            company.getByText("Durch Moderation ausgeblendet", {exact: false}),
        ).toBeVisible();
        await a11y(company);
    } finally {
        await Promise.all([managerContext.close(), companyContext.close()]);
    }
});

// Exercise delegated ownership through the same file gateway and scanner as a personal upload.
for (const role of ["management", "admin"] as const) {
    test(`${role} adds a CV, a certificate and expertise from the lecturer profile`, async ({page}) => {
        const staff = await actor(`Fictional evidence uploader ${role}`, role);
        const teacher = await actor("Fictional evidence owner", "lecturer");
        const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
        const topic = await checked(service.from("topics").select("id")
            .is("archived_at", null).order("id").limit(1).single(), {requireData: true});
        const topicId = topic.id;

        if (role === "admin") await adminLogin(page, staff);
        else await login(page, staff.email);
        await page.goto(`/people/${teacher.id}?expertise=1`);
        for (const [kind, label] of [["cv", "Lebenslauf"], ["certificate", "Qualifikationsnachweis"]] as const) {
            const section = page.getByRole("region", {name: label, exact: true});
            const fileName = `Fictional ${kind}.txt`;
            await section.locator('input[type="file"]').setInputFiles({
                name: fileName,
                mimeType: "text/plain",
                buffer: Buffer.from(`Fictional delegated ${kind} test evidence`),
            });
            await section.getByRole("button", {name: "Datei hochladen", exact: true}).click();
            await expect(section.getByText(fileName, {exact: true})).toBeVisible();
            await expect.poll(async () => {
                const rows = await checked(service.from("documents").select("owner_id,uploaded_by,status")
                    .eq("owner_id", teacher.id).eq("kind", kind), {requireData: true});
                return rows;
            }).toEqual([{owner_id: teacher.id, uploaded_by: staff.id, status: "clean"}]);
        }

        await page.getByLabel("Thema für diese Person", {exact: true}).selectOption(topicId);
        await page.getByRole("button", {name: "Expertise hinzufügen", exact: true}).click();
        await expect.poll(async () => {
            const rows = await checked(service.from("lecturer_topics").select("verified")
                .eq("user_id", teacher.id).eq("topic_id", topicId), {requireData: true});
            return rows;
        }).toEqual([{verified: false}]);
    });
}
