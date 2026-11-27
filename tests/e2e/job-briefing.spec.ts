/** Real desktop/mobile optional-reference editing and configurable customer disclosure.
 * Only fictional records in the canonical disposable stack are created. */
import {expect, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
import {actor, adminLogin, api, checked, login,} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Job briefing writes require the canonical disposable project.",
);
test("early assignments keep customer data hidden until the configured disclosure and cancellation revokes access", async ({
                                                                                                                         page,
                                                                                                                         browser,
                                                                                                                     }, testInfo) => {
    test.setTimeout(120000);
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const manager = await actor("Fictional briefing administration", "admin");
    const teacher = await actor("Fictional briefing lecturer", "lecturer");
    const template = randomUUID(),
        run = randomUUID(),
        job = randomUUID(),
        courseSession = randomUUID();
    await checked(
        service.from("course_templates").insert({
            id: template,
            title: "Fictional optional-reference curriculum",
        }),
    );
    await checked(
        service
            .from("course_runs")
            .insert({id: run, template_id: template, time_zone: "Europe/Berlin"}),
    );
    const starts = "2053-05-10T08:00:00Z",
        ends = "2053-05-10T09:00:00Z";
    await checked(
        service.from("course_sessions").insert({
            id: courseSession,
            course_run_id: run,
            starts_at: starts,
            ends_at: ends,
        }),
    );
    await checked(
        service.from("jobs").insert({
            id: job,
            course_run_id: run,
            title: "Fictional referenced teaching assignment",
            customer_name: "Fiktiver Auftraggeber",
            description: "Optional customer-specific briefing",
            delivery_type: "online",
            time_zone: "Europe/Berlin",
            status: "published",
            amount: 100,
            total_amount: 100,
            currency: "EUR",
            rate_unit: "fixed_total",
            terms: "Immutable original fictional agreement",
            requires_contract: false,
        }),
    );
    await checked(
        service.from("job_sessions").insert({
            job_id: job,
            course_session_id: courseSession,
            starts_at: starts,
            ends_at: ends,
        }),
    );
    await adminLogin(page, manager);
    await page.goto(`/jobs/${job}#job-briefing`);
    const briefing = page.getByRole("region", {
        name: "Kontakt und Auftragsreferenz",
        exact: true,
    });
    await briefing
        .getByRole("button", {
            name: "Kontakt oder Webverweis bearbeiten",
            exact: true,
        })
        .click();
    const editor = page.getByRole("dialog");
    const reference = "https://example.invalid/teaching/brief?cohort=fictional";
    const description =
        "Der Auftrag richtet sich nach dieser Ausschreibung. <script>literal</script>";
    const email = "coordination@example.invalid";
    await editor
        .getByLabel("Weblink zum Auftrag", {exact: true})
        .fill(reference);
    await editor
        .getByLabel("Bezeichnung des Weblinks", {exact: true})
        .fill("Originalausschreibung");
    await editor
        .getByLabel("Beschreibung zur Auftragsreferenz", {exact: true})
        .fill(description);
    await editor
        .getByLabel("Ansprechpartner:in", {exact: true})
        .fill("Fiktive Kurskoordination");
    await editor.getByLabel("Kontakt-E-Mail", {exact: true}).fill(email);
    await editor
        .getByLabel("Kontakt-Telefon", {exact: true})
        .fill("+49 40 123456");
    await editor
        .getByLabel("Hinweise zum Kontakt", {exact: true})
        .fill("Fragen zum Ablauf bitte an diese Koordination.");
    await expect(
        editor.getByLabel("Sichtbarkeit der Kontaktangaben", {exact: true}),
    ).toHaveValue("after_claim");
    const savedResponse = page.waitForResponse((response) =>
        response.url().endsWith("/rest/v1/rpc/save_job_briefing"),
    );
    await editor
        .getByRole("button", {name: "Angaben speichern", exact: true})
        .click();
    const response = await savedResponse;
    const responseBody = await response.json();
    expect(response.status(), JSON.stringify(responseBody).slice(0, 1000)).toBe(
        200,
    );
    const stored = responseBody;
    expect(stored.version).toBe(1);
    expect(stored.contact_visibility).toBe("after_claim");
    await expect(editor).not.toBeVisible();
    await expect(
        briefing.getByText("Die Angaben wurden gespeichert.", {exact: true}),
    ).toBeVisible();
    await expect(
        briefing.getByRole("link", {name: "Originalausschreibung", exact: true}),
    ).toHaveAttribute("href", reference);
    await expect(briefing.locator("script")).toHaveCount(0);
    // Record the management view with visible fictional contact details in German
    // light mode, complementing the revoked-contact English dark view below.
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
        ),
    ).toBe(true);
    const managementScan = await new AxeBuilder({page})
        .include("#job-briefing")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
    expect(managementScan.violations.map((issue) => issue.id)).toEqual([]);
    await page.screenshot({
        path: `.local/screenshots/${testInfo.project.name}-job-briefing-management-de-light.png`,
        fullPage: true,
    });
    // A second account needs an independent session, but must retain the current
    // project's mobile/desktop layout and runner-owned URL for relative navigation.
    const project = testInfo.project.use;
    const context = await browser.newContext({
        baseURL: project.baseURL,
        viewport: page.viewportSize(),
        isMobile: project.isMobile,
        hasTouch: project.hasTouch,
        deviceScaleFactor: project.deviceScaleFactor,
        userAgent: project.userAgent,
    });
    let restoreDisclosure = false;
    const setDisclosure = async (mode: "scheduled" | "on_confirmation") => {
        await page.goto("/admin/assignment-customer");
        const disclosure = page.getByLabel("Freigabe", {exact: true});
        if (mode === "on_confirmation") {
            await expect(disclosure).toHaveValue("scheduled");
            await expect(
                page.getByLabel("Stunden vor dem ersten Termin", {exact: true}),
            ).toHaveValue("168");
            restoreDisclosure = true;
        }
        await disclosure.selectOption(mode);
        await page.getByRole("button", {name: "Speichern", exact: true}).click();
        await expect(page.getByText("Einstellung gespeichert.", {exact: true})).toBeVisible();
    };
    try {
        const lecturer = await context.newPage();
        await login(lecturer, teacher.email);
        await lecturer.goto(`/jobs/${job}`);
        const visible = lecturer.getByRole("region", {
            name: "Kontakt und Auftragsreferenz",
            exact: true,
        });
        const referenceLink = lecturer.getByRole("link", {name: "Originalausschreibung", exact: true});
        const contactLink = lecturer.getByRole("link", {name: email, exact: true});
        const customer = lecturer.getByText("Unternehmen: Fiktiver Auftraggeber", {exact: true});
        const hidden = lecturer.getByText("Unternehmensangaben sind derzeit ausgeblendet", {exact: true});
        await expect(hidden).toBeVisible();
        await expect(referenceLink).toHaveCount(0);
        await expect(contactLink).toHaveCount(0);
        await expect(customer).toHaveCount(0);
        await lecturer.getByLabel("Konditionen akzeptieren", {exact: true}).check();
        await lecturer
            .getByRole("button", {name: "Auftrag übernehmen", exact: true})
            .click();
        await expect(lecturer.getByText(/^Unternehmensangaben ab .+ verfügbar$/)).toBeVisible();
        await expect(referenceLink).toHaveCount(0);
        await expect(contactLink).toHaveCount(0);
        await expect(customer).toHaveCount(0);

        await setDisclosure("on_confirmation");
        await lecturer.reload();
        await expect(customer).toBeVisible();
        await expect(visible.getByText(description, {exact: true})).toBeVisible();
        await expect(referenceLink).toHaveAttribute("rel", "noopener noreferrer");
        await expect(contactLink).toBeVisible();
        await expect(
            visible.getByRole("link", {name: "+49 40 123456", exact: true}),
        ).toHaveAttribute("href", "tel:+4940123456");
        // Lecturers now submit a withdrawal request; management performs this
        // immediate, reasoned cancellation after reviewing the assignment.
        await page.goto(`/jobs/${job}`);
        const managementLifecycle = page.getByRole("region", {
            name: "Zuweisung und Auftragsverlauf",
            exact: true,
        });
        await managementLifecycle
            .getByRole("button", {name: "Zuweisung stornieren", exact: true})
            .click();
        const cancellation = page.getByRole("dialog");
        await cancellation
            .getByLabel("Begründung (5–1000 Zeichen)", {exact: true})
            .fill("Fictional scheduling change with contact revocation");
        await cancellation
            .getByRole("button", {name: "Stornierung bestätigen", exact: true})
            .click();
        await expect(cancellation).not.toBeVisible();
        await lecturer.reload();
        await expect(hidden).toBeVisible();
        await expect(referenceLink).toHaveCount(0);
        await expect(contactLink).toHaveCount(0);
        await expect(customer).toHaveCount(0);
        await lecturer.getByLabel("Sprache", {exact: true}).selectOption("en");
        await lecturer.getByLabel("Theme", {exact: true}).selectOption("dark");
        await expect(
            lecturer.getByText("Company details are currently hidden", {exact: true}),
        ).toBeVisible();
        await lecturer.evaluate(() => document.fonts.ready);
        const scan = await new AxeBuilder({page: lecturer})
            .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
            .analyze();
        expect(
            scan.violations.map((issue) => ({
                id: issue.id,
                targets: issue.nodes.map((node) => node.target),
            })),
        ).toEqual([]);
        expect(
            await lecturer.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
            ),
        ).toBe(true);
        await lecturer.screenshot({
            path: `.local/screenshots/${testInfo.project.name}-job-briefing.png`,
            fullPage: true,
        });
        await testInfo.attach("optional-reference-contact", {
            body: await lecturer.screenshot({fullPage: true}),
            contentType: "image/png",
        });
    } finally {
        await context.close();
        if (restoreDisclosure) await setDisclosure("scheduled");
    }
});
