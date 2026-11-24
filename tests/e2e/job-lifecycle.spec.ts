/**
 * Browser workflows for cancellation, eligible automatic reopening and same-page reclaim.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import {expect, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
import {actor, adminLogin, api, checked, login,} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Lifecycle writes require the canonical disposable project.",
);
test("reasoned cancellation, automatic reopening, same-page reclaim and safe copy preserve the complete accepted block", async ({
                                                                                                                                   page,
                                                                                                                                   browser,
                                                                                                                               }, testInfo) => {
    test.setTimeout(90000);
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
        manager = await actor("Fictional lifecycle manager", "admin"),
        teacher = await actor("Fictional lifecycle lecturer", "lecturer");
    const template = randomUUID(),
        run = randomUUID(),
        job = randomUUID(),
        originalCompany = randomUUID(),
        destinationCompany = randomUUID(),
        sessions = [
            {
                id: randomUUID(),
                course_run_id: run,
                starts_at: "2049-01-10T08:00:00Z",
                ends_at: "2049-01-10T09:00:00Z",
            },
            {
                id: randomUUID(),
                course_run_id: run,
                starts_at: "2049-01-11T08:00:00Z",
                ends_at: "2049-01-11T09:00:00Z",
            },
        ];
    await checked(service.from("organisations").insert([
        {id: originalCompany, name: `Fictional initial company ${job.slice(0, 8)}`},
        {id: destinationCompany, name: `Fictional destination company ${job.slice(0, 8)}`},
    ]));
    await checked(
        service
            .from("course_templates")
            .insert({id: template, title: "Fictional lifecycle curriculum"}),
    );
    await checked(
        service
            .from("course_runs")
            .insert({id: run, template_id: template, organisation_id: originalCompany, time_zone: "Europe/Berlin"}),
    );
    await checked(service.from("course_sessions").insert(sessions));
    await checked(
        service.from("jobs").insert({
            id: job,
            course_run_id: run,
            title: "Fictional lifecycle block",
            customer_name: "Fictional academy",
            delivery_type: "online",
            time_zone: "Europe/Berlin",
            status: "published",
            amount: 100,
            total_amount: 200,
            currency: "EUR",
            rate_unit: "per_day",
            terms: "Original fictional terms",
        }),
    );
    await checked(
        service.from("job_sessions").insert(
            sessions.map((s) => ({
                job_id: job,
                course_session_id: s.id,
                starts_at: s.starts_at,
                ends_at: s.ends_at,
            })),
        ),
    );
    await adminLogin(page, manager);
    await page.goto(`/jobs/${job}`);
    const management = page.getByRole("region", {
        name: "Zuweisung und Auftragsverlauf",
        exact: true,
    });
    await page.getByRole("button", {name: "Auftrag bearbeiten", exact: true}).click();
    await expect(page.getByRole("dialog", {name: "Auftrag bearbeiten"})).toBeVisible();
    const company = page.getByLabel("Unternehmen für diesen Auftrag", {exact: true});
    await expect(company).toHaveValue(originalCompany);
    await company.selectOption(destinationCompany);
    await page
        .getByLabel("Auftragsbedingungen", {exact: true})
        .fill("Reviewed fictional terms preserved forever");
    await page
        .getByLabel(/Übernahmefrist · Europe\/Berlin/)
        .fill("2048-12-01T12:00");
    await page
        .getByRole("button", {name: "Auftrag speichern", exact: true})
        .click();
    await expect(
        management.getByText("Die bestätigte Serveränderung wurde gespeichert."),
    ).toBeVisible();
    const edited = await checked(
        service
            .from("jobs")
            .select("terms_version,claim_deadline")
            .eq("id", job)
            .single(),
        {requireData: true},
    );
    expect(await checked(
        service.from("course_runs").select("organisation_id").eq("id", run).single(),
        {requireData: true},
    )).toEqual({organisation_id: destinationCompany});
    expect(edited.terms_version).toBe(2);
    expect(Date.parse(edited.claim_deadline)).toBe(
        Date.parse("2048-12-01T11:00:00Z"),
    );
    const context = await browser.newContext({
        baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5273",
    });
    try {
        const lecturerPage = await context.newPage();
        await login(lecturerPage, teacher.email);
        await lecturerPage.goto(`/jobs/${job}`);
        await lecturerPage
            .getByLabel("Konditionen akzeptieren", {exact: true})
            .check();
        await lecturerPage
            .getByRole("button", {name: "Auftrag übernehmen", exact: true})
            .click();
        await expect(
            lecturerPage.getByText(
                "Dein Auftrag ist bestätigt. Alle Termine sind reserviert.",
            ),
        ).toBeVisible();
        await page.goto("/courses");
        const courseCard = page.getByRole("article").filter({
            has: page.getByRole("heading", {name: "Fictional lifecycle curriculum", exact: true}),
        });
        await page.getByRole("combobox", {name: "Dozent:in", exact: true}).selectOption(teacher.id);
        await expect(courseCard.getByText("Dozent:in: Fictional lifecycle lecturer", {exact: true})).toBeVisible();
        await courseCard.getByRole("link", {name: "Auftrag anzeigen: Fictional lifecycle block", exact: true}).click();
        await expect(page).toHaveURL(new RegExp(`/jobs/${job}$`));
        await page.getByRole("button", {name: "Auftrag bearbeiten", exact: true}).click();
        const occupiedEditor = page.getByRole("dialog", {name: "Auftrag bearbeiten"});
        await expect(occupiedEditor.getByRole("link", {name: /Termine oder Honorar für/})).toBeVisible();
        await occupiedEditor.getByLabel("Auftragstitel", {exact: true}).fill("Fictional revised lifecycle block");
        await page.screenshot({path: `.local/screenshots/${testInfo.project.name}-filled-assignment-editor.png`});
        await occupiedEditor.getByRole("button", {name: "Auftrag speichern", exact: true}).click();
        await expect(page.getByRole("heading", {name: "Fictional revised lifecycle block", exact: true})).toBeVisible();
        await lecturerPage
            .getByRole("button", {
                name: "Von diesem Auftrag zurücktreten",
                exact: true,
            })
            .click();
        const dialog = lecturerPage.getByRole("dialog");
        await expect(
            dialog.getByRole("button", {name: "Rücktritt bestätigen"}),
        ).toBeEnabled();
        await dialog
            .getByLabel("Begründung (ab sieben Tagen Vorlauf optional)", {
                exact: true,
            })
            .fill("Fictional agreed scheduling change");
        await dialog
            .getByRole("button", {name: "Rücktritt bestätigen", exact: true})
            .click();
        await expect(dialog).not.toBeVisible();
        await expect(
            lecturerPage.getByText("Storniert", {exact: true}),
        ).toBeVisible();
        await expect(
            lecturerPage.getByText(
                "Dein Auftrag ist bestätigt. Alle Termine sind reserviert.",
            ),
        ).not.toBeVisible();
        // The same confirmed withdrawal releases every allocation and returns
        // this eligible future block to the marketplace without another edit.
        const reopened = await checked(
            service.from("jobs").select("status,terms_version").eq("id", job).single(),
            {requireData: true},
        );
        expect(reopened).toEqual({status: "published", terms_version: edited.terms_version});
        const cancelled = await checked(
            service.from("job_claims").select("id").eq("job_id", job)
                .eq("status", "cancelled").single(),
            {requireData: true},
        );
        const released = await checked(
            service.from("assignment_sessions").select("released_at").eq("claim_id", cancelled.id),
            {requireData: true},
        );
        expect(released).toHaveLength(sessions.length);
        expect(released.every(({released_at}) => released_at !== null)).toBe(true);
        await expect(lecturerPage.locator(".status-published")).toHaveText("Offen");
        await expect(
            lecturerPage.getByText("1 Platz zur Übernahme offen", {exact: true}),
        ).toBeVisible();
        const currentTerms = lecturerPage.getByLabel("Konditionen akzeptieren", {
            exact: true,
        });
        // Reopening retains the accepted terms version. Explicitly review consent
        // for this new operation and prove it still gates the actual claim button.
        await currentTerms.uncheck();
        await expect(
            lecturerPage.getByRole("button", {
                name: "Auftrag übernehmen",
                exact: true,
            }),
        ).toBeDisabled();
        await currentTerms.check();
        await expect(
            lecturerPage.getByRole("button", {
                name: "Auftrag übernehmen",
                exact: true,
            }),
        ).toBeEnabled();
        await lecturerPage
            .getByRole("button", {name: "Auftrag übernehmen", exact: true})
            .click();
        await expect(
            lecturerPage.getByText(
                "Dein Auftrag ist bestätigt. Alle Termine sind reserviert.",
            ),
        ).toBeVisible();
        const history = await checked(
            service
                .from("job_claims")
                .select("id,status,idempotency_key,total_amount,terms")
                .eq("job_id", job),
            {requireData: true},
        );
        expect(history).toHaveLength(2);
        expect(history.map((c) => c.status).sort()).toEqual([
            "cancelled",
            "confirmed",
        ]);
        expect(new Set(history.map((c) => c.idempotency_key)).size).toBe(2);
        expect(
            history.every(
                (c) =>
                    Number(c.total_amount) === 200 &&
                    c.terms === "Reviewed fictional terms preserved forever",
            ),
        ).toBe(true);
        await page.goto(`/jobs/${job}`);
        await management
            .getByRole("button", {name: "Als Entwurf kopieren", exact: true})
            .click();
        const copy = page.getByRole("dialog");
        await copy
            .getByLabel("Titel der Kopie", {exact: true})
            .fill("Fictional safe lifecycle copy");
        await copy
            .getByRole("button", {name: "Als Entwurf kopieren", exact: true})
            .click();
        await expect(page).not.toHaveURL(new RegExp(`/jobs/${job}$`));
        await expect(
            page.getByRole("heading", {
                name: "Fictional safe lifecycle copy",
                exact: true,
            }),
        ).toBeVisible();
        const copyId = new URL(page.url()).pathname.split("/").at(-1)!;
        const copied = await checked(
            service
                .from("jobs")
                .select("status,course_run_id")
                .eq("id", copyId)
                .single(),
            {requireData: true},
        );
        expect(copied.status).toBe("draft");
        expect(copied.course_run_id).not.toBe(run);
        expect(
            await checked(
                service.from("job_claims").select("id").eq("job_id", copyId),
            ),
        ).toEqual([]);
        await page.getByLabel("Sprache", {exact: true}).selectOption("en");
        await page.getByLabel("Theme", {exact: true}).selectOption("dark");
        await expect(
            page.getByRole("heading", {
                name: "Assignment and offer history",
                exact: true,
            }),
        ).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const result = await new AxeBuilder({page})
            .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
            .analyze();
        expect(result.violations.map((v) => v.id)).toEqual([]);
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
            ),
        ).toBe(true);
        await page.screenshot({
            path: `.local/screenshots/${testInfo.project.name}-job-lifecycle.png`,
            fullPage: true,
        });
    } finally {
        await context.close();
    }
});

test("long schedules scroll in the marketplace, course details and offer preview", async ({page}) => {
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const job = randomUUID(), run = randomUUID(), template = randomUUID(), company = randomUUID();
    const title = `Fictional long schedule ${job.slice(0, 8)}`;
    const start = Date.parse("2049-02-01T08:00:00Z");
    const sessions = Array.from({length: 40}, (_, day) => ({
        id: randomUUID(),
        course_run_id: run,
        starts_at: new Date(start + day * 86400000).toISOString(),
        ends_at: new Date(start + day * 86400000 + 3600000).toISOString(),
    }));
    try {
        await checked(service.from("organisations").insert({id: company, name: title}));
        await checked(service.from("course_templates").insert({id: template, title}));
        await checked(service.from("course_runs").insert({
            id: run, template_id: template, organisation_id: company, time_zone: "Europe/Berlin",
        }));
        await checked(service.from("course_sessions").insert(sessions));
        await checked(service.from("jobs").insert({
            id: job, course_run_id: run, title, customer_name: "Fictional academy", delivery_type: "online",
            time_zone: "Europe/Berlin", status: "published", amount: 100, total_amount: 4000,
            currency: "EUR", rate_unit: "per_day", terms: "",
        }));
        await checked(service.from("job_sessions").insert(sessions.map(({id, starts_at, ends_at}) => ({
            job_id: job, course_session_id: id, starts_at, ends_at,
        }))));
        await login(page, process.env.E2E_ADMIN_EMAIL!);
        await page.goto(`/jobs/${job}`);
        await expect(page.getByRole("heading", {name: "Durchführungszeitraum"})).toBeVisible();
        const checkSchedule = async (name: string) => {
            const schedule = page.getByRole("region", {name, exact: true});
            await expect(schedule.getByRole("listitem")).toHaveCount(sessions.length);
            expect(await schedule.evaluate(box => box.scrollHeight > box.clientHeight)).toBe(true);
            await schedule.focus();
            await schedule.press("End");
            await expect.poll(() => schedule.evaluate(box => box.scrollTop)).toBeGreaterThan(0);
            await expect(schedule.getByRole("listitem").last()).toBeInViewport();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        };
        await checkSchedule("Termine");
        await page.goto(`/courses?run=${run}`);
        await expect(page.getByRole("dialog")).toBeVisible();
        await checkSchedule("Termine");
        await page.goto(`/admin?courseRun=${run}`);
        await checkSchedule("Geplante Kurstermine");
    } finally {
        await checked(service.from("job_sessions").delete().eq("job_id", job));
        await checked(service.from("jobs").delete().eq("id", job));
        await checked(service.from("course_sessions").delete().eq("course_run_id", run));
        await checked(service.from("course_runs").delete().eq("id", run));
        await checked(service.from("course_templates").delete().eq("id", template));
        await checked(service.from("organisations").delete().eq("id", company));
    }
});
