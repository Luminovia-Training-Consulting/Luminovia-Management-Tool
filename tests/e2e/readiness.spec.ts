import {expect, type Page, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
import {actor, adminLogin, api, checked, login,} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Readiness writes belong only to the canonical disposable project.",
);

async function accessible(page: Page) {
    await page.evaluate(() => document.fonts.ready);
    const result = await new AxeBuilder({page})
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
    expect(
        result.violations.map((item) => ({
            id: item.id,
            targets: item.nodes.map((node) => node.target),
        })),
    ).toEqual([]);
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
        ),
    ).toBe(true);
}

test("management preparation and assigned lecturer acknowledgements update actual readiness in DE/EN and dark/mobile", async ({
                                                                                                                                  page,
                                                                                                                                  browser,
                                                                                                                              }, testInfo) => {
    test.setTimeout(150000);
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
        manager = await actor("Fictional readiness UI manager", "admin"),
        backup = await actor("Fictional readiness UI backup", "management"),
        teacher = await actor("Fictional readiness UI lecturer", "lecturer"),
        peer = await actor("Fictional readiness UI outsider", "lecturer");
    const template = randomUUID(),
        run = randomUUID(),
        job = randomUUID(),
        title = `Fictional readiness ${testInfo.project.name}`;
    const sessions = [1, 2].map((day) => ({
        id: randomUUID(),
        course_run_id: run,
        starts_at: `2057-01-0${day}T08:00:00Z`,
        ends_at: `2057-01-0${day}T09:00:00Z`,
    }));
    await checked(
        service.from("course_templates").insert({id: template, title}),
    );
    await checked(
        service
            .from("course_runs")
            .insert({
                id: run,
                template_id: template,
                time_zone: "Europe/Berlin",
                published: true,
            }),
    );
    await checked(service.from("course_sessions").insert(sessions));
    await checked(
        service
            .from("jobs")
            .insert({
                id: job,
                course_run_id: run,
                title,
                customer_name: "Fictional readiness academy",
                delivery_type: "online",
                time_zone: "Europe/Berlin",
                status: "published",
                amount: 100,
                total_amount: 200,
                currency: "EUR",
                rate_unit: "per_day",
                terms: "Fictional unchanged terms",
                requires_contract: false,
            }),
    );
    await checked(
        service
            .from("job_sessions")
            .insert(
                sessions.map((s) => ({
                    job_id: job,
                    course_session_id: s.id,
                    starts_at: s.starts_at,
                    ends_at: s.ends_at,
                })),
            ),
    );
    const lecturerContext = await browser.newContext({
        baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5273",
    });
    const outsiderContext = await browser.newContext({
        baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5273",
    });
    try {
        const lecturer = await lecturerContext.newPage();
        await login(lecturer, teacher.email);
        await lecturer.goto(`/jobs/${job}`);
        await lecturer
            .getByLabel("Konditionen akzeptieren", {exact: true})
            .check();
        await lecturer
            .getByRole("button", {name: "Auftrag übernehmen", exact: true})
            .click();
        await expect(
            lecturer.getByText(
                "Dein Auftrag ist bestätigt. Alle Termine sind reserviert.",
                {exact: true},
            ),
        ).toBeVisible();
        await adminLogin(page, manager);
        await page.goto(`/readiness/${run}`);
        await expect(
            page.getByRole("heading", {name: title, exact: true}),
        ).toBeVisible();
        await expect(page.locator(".readiness-status")).toHaveText("Blockiert");
        const start = page.getByRole("region", {name: "Kursstart-Freigabe"});
        await start.getByLabel("Verantwortlich für den Kursstart").selectOption(manager.id);
        await start.getByLabel("Vertretung bei überfälliger Vorbereitung").selectOption(backup.id);
        await start.getByRole("button", {name: "Zuständigkeit speichern"}).click();
        await expect(start.getByRole("button", {name: "Zuständigkeit speichern"})).toBeDisabled();
        await page.reload();
        await expect(start.getByLabel("Vertretung bei überfälliger Vorbereitung")).toHaveValue(backup.id);

        const configure = page.getByRole("button", {
            name: "Konfiguration bearbeiten",
            exact: true,
        });
        const readinessActions = page.locator(".readiness-checklist-actions");
        const confirmPlan = readinessActions.getByRole("button", {
            name: "Aktuellen Unterrichtsplan bestätigen",
            exact: true,
        });
        await expect(confirmPlan).toBeVisible();
        const [confirmBounds, configureBounds] = await Promise.all([
            confirmPlan.boundingBox(),
            configure.boundingBox(),
        ]);
        expect(Math.max(
            configureBounds!.x - confirmBounds!.x - confirmBounds!.width,
            configureBounds!.y - confirmBounds!.y - confirmBounds!.height,
        )).toBeGreaterThanOrEqual(10);
        await configure.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog");
        for (const label of [
            "Lehrmaterialien sind erforderlich",
            "Unternehmen ist erforderlich",
            "Unternehmenskontakt ist erforderlich",
            "Dokumentierte Vereinbarung ist erforderlich",
        ])
            await dialog.getByLabel(label, {exact: true}).uncheck();
        await dialog
            .getByLabel("Bestätigung der Kurshinweise ist erforderlich", {
                exact: true,
            })
            .check();
        await dialog
            .getByLabel("Online-Meeting (HTTPS)", {exact: true})
            .fill("https://meeting.example.invalid/fictional-readiness");
        await dialog
            .getByLabel("Kurshinweise", {exact: true})
            .fill("Fictional instructions remain in their authored language.");
        await dialog
            .getByRole("button", {name: "Online speichern", exact: true})
            .click();
        await expect(dialog).not.toBeVisible();
        await page
            .getByRole("button", {
                name: "Aktuellen Unterrichtsplan bestätigen",
                exact: true,
            })
            .click();
        await expect(
            page.getByRole("button", {
                name: "Aktuellen Unterrichtsplan bestätigen",
                exact: true,
            }),
        ).toHaveCount(0);
        await expect(page.locator(".readiness-status")).toHaveText(
            "Handlungsbedarf",
        );
        await page
            .getByRole("button", {name: "Aufgabe hinzufügen", exact: true})
            .click();
        await dialog
            .getByLabel("Aufgabe", {exact: true})
            .fill("Fictional final preparation task");
        await dialog
            .getByLabel("Zuständige Person", {exact: true})
            .selectOption(teacher.id);
        await dialog
            .getByRole("button", {name: "Online speichern", exact: true})
            .click();
        await expect(dialog).not.toBeVisible();
        await lecturer.goto(`/jobs/${job}`);
        await lecturer.getByRole("link", {name: "Kursbereitschaft", exact: true}).click();
        await expect(lecturer).toHaveURL(new RegExp(`/readiness/${run}$`));
        await expect(
            lecturer.getByRole("button", {
                name: "Konfiguration bearbeiten",
                exact: true,
            }),
        ).toHaveCount(0);
        await lecturer
            .getByRole("button", {
                name: "Diese Version gelesen und verstanden",
                exact: true,
            })
            .click();
        await expect(
            lecturer.getByRole("button", {
                name: "Diese Version gelesen und verstanden",
                exact: true,
            }),
        ).toHaveCount(0);
        await lecturer
            .getByRole("button", {name: "Als erledigt bestätigen", exact: true})
            .click();
        await expect(
            lecturer.getByRole("progressbar"),
        ).toHaveAttribute("aria-valuenow", "100");
        await expect(lecturer.locator(".readiness-status")).toHaveText("Bereit");
        await page
            .getByRole("button", {name: "Aktualisieren", exact: true})
            .click();
        await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
        await accessible(page);
        await page.getByLabel("Sprache", {exact: true}).selectOption("en");
        await page.getByLabel("Theme", {exact: true}).selectOption("dark");
        await expect(
            page.getByRole("heading", {name: "Preparation checklist", exact: true}),
        ).toBeVisible();
        await expect(
            page.getByText(
                "Fictional instructions remain in their authored language.",
                {exact: true},
            ),
        ).toBeVisible();
        await accessible(page);
        await page.screenshot({
            path: `.local/screenshots/${testInfo.project.name}-readiness-dark-en.png`,
            fullPage: true,
        });
        await lecturerContext.setOffline(true);
        await expect(
            lecturer.getByRole("button", {
                name: "Erledigung zurücknehmen",
                exact: true,
            }),
        ).toBeDisabled();
        await lecturerContext.setOffline(false);
        await lecturer
            .getByRole("button", {name: "Erledigung zurücknehmen", exact: true})
            .click();
        await expect(
            lecturer.getByRole("progressbar"),
        ).not.toHaveAttribute("aria-valuenow", "100");
        const outsider = await outsiderContext.newPage();
        await login(outsider, peer.email);
        await outsider.goto(`/readiness/${run}`);
        await expect(outsider.getByRole("alert")).toBeVisible();
        await expect(
            outsider.getByRole("heading", {name: title, exact: true}),
        ).toHaveCount(0);
        await page.goto("/readiness");
        await page
            .getByLabel("Search courses or organisations", {exact: true})
            .fill(title);
        await expect(
            page.getByRole("link", {name: title, exact: true}),
        ).toBeVisible();
        await accessible(page);
        await page.goto("/admin/audit");
        await page.getByLabel("Action", {exact: true})
            .selectOption("course.preparation.instructions_acknowledged");
        await page.getByRole("button", {name: "Apply filters", exact: true}).click();
        await expect(page.getByRole("heading", {name: "Course instructions acknowledged", exact: true}).first()).toBeVisible();
    } finally {
        await lecturerContext.setOffline(false);
        await lecturerContext.close();
        await outsiderContext.close();
    }
});