import {expect, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
import {actor, api, checked, login} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Discovery fixtures require the canonical disposable project.",
);
test("bounded server discovery, saved-view persistence and private actor boundaries stay connected", async ({
                                                                                                                page,
                                                                                                                browser,
                                                                                                            }, testInfo) => {
    test.setTimeout(120000);
    const teacher = await actor("Fictional discovery UI lecturer", "lecturer"),
        peer = await actor("Fictional discovery UI peer", "lecturer"),
        learner = await actor("Fictional discovery UI learner", "participant"),
        service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
        suffix = randomUUID().slice(0, 8),
        prefix = `Fictional discovery UI ${suffix}`,
        name = `Fictional personal view ${suffix}`,
        renamed = `Fictional renamed view ${suffix}`,
        conflictId = randomUUID();
    const rows = Array.from({length: 65}, (_, n) => ({
        id: randomUUID(),
        title: `${prefix} ${String(n).padStart(3, "0")}`,
        description: "Fictional literal %_ filtered content",
        customer_name: `Fictional academy ${suffix}`,
        delivery_type: "online",
        location: "",
        time_zone: "Europe/Berlin",
        status: "published",
        amount: 25,
        total_amount: 100 + n,
        currency: "EUR",
        rate_unit: "per_hour",
        terms: "Fictional complete-block terms",
        requires_contract: false,
    }));
    await checked(service.from("jobs").insert(rows));
    await checked(
        service.from("job_sessions").insert(
            rows.map((row) => ({
                job_id: row.id,
                starts_at: "2060-04-01T08:00:00Z",
                ends_at: "2060-04-01T10:00:00Z",
            })),
        ),
    );
    const other = await browser.newContext();
    try {
        await login(page, teacher.email);
        await page.goto("/jobs");
        await expect(
            page.locator(".discovery-filter-disclosure"),
        ).not.toHaveAttribute("open");
        await page.getByText(/^(Filter & Ansichten|Filters & views)$/).click();
        await expect(page.locator(".jobs-grid")).toBeVisible();
        const search = page.getByRole("searchbox", {name: "Suchtext", exact: true});
        const calendar = page.getByLabel("Ohne Überschneidung in meinem Kalender");
        await search.fill("Unapplied fictional text");
        await calendar.check();
        await page.getByRole("button", {name: "Filter zurücksetzen", exact: true}).click();
        await expect(search).toHaveValue("");
        await expect(calendar).not.toBeChecked();

        if (testInfo.project.name === "mobile-chromium") {
            const view = await page.getByLabel("Ansicht auswählen", {exact: true}).boundingBox();
            const save = await page.getByRole("button", {name: "Angewendete Filter speichern", exact: true}).boundingBox();
            expect(view).not.toBeNull();
            expect(save).not.toBeNull();
            expect(save!.y).toBeGreaterThan(view!.y + view!.height);
        }

        const initialRequests: number[] = [];
        const listener = (request: { url: () => string }) => {
            if (request.url().includes("/rpc/job_discovery"))
                initialRequests.push(Date.now());
        };
        page.on("request", listener);
        await page
            .getByRole("searchbox", {name: "Suchtext", exact: true})
            .fill(prefix);
        await page.getByLabel("Währung", {exact: true}).selectOption("EUR");
        await page.getByLabel("Gesamthonorar ab", {exact: true}).fill("100");
        await page
            .getByLabel("Sortieren", {exact: true})
            .selectOption("total_desc");
        expect(initialRequests).toHaveLength(0);
        const response = page.waitForResponse(
            (r) =>
                r.url().includes("/rpc/job_discovery") &&
                r.request().method() === "POST" &&
                r.status() === 200,
        );
        await page
            .getByRole("button", {name: "Filter anwenden", exact: true})
            .click();
        await response;
        await expect(
            page.getByText("50 Aufträge geladen", {exact: true}),
        ).toBeVisible();
        await expect(page.locator(".jobs-grid>.job-card")).toHaveCount(50);
        await expect(page.locator(".jobs-grid>.job-card").first()).toContainText(
            `${prefix} 064`,
        );
        await page
            .getByRole("button", {name: "Weitere Aufträge laden", exact: true})
            .click();
        await expect(
            page.getByText("65 Aufträge geladen", {exact: true}),
        ).toBeVisible();
        await expect(page.locator(".jobs-grid>.job-card")).toHaveCount(65);
        expect(
            new Set(await page.locator(".jobs-grid>.job-card h2 a").allTextContents())
                .size,
        ).toBe(65);
        await page
            .getByRole("button", {
                name: "Angewendete Filter speichern",
                exact: true,
            })
            .click();
        let dialog = page.getByRole("dialog");
        await dialog.getByLabel("Name der Ansicht", {exact: true}).fill(name);
        await dialog
            .getByRole("button", {name: "Speichern", exact: true})
            .click();
        await expect(dialog).not.toBeVisible();
        await expect(
            page.getByText("Ansicht gespeichert.", {exact: true}),
        ).toBeVisible();
        await page.reload();
        await page.getByText("Filter & Ansichten", {exact: true}).click();
        await page
            .getByLabel("Ansicht auswählen", {exact: true})
            .selectOption({label: name});
        await expect(
            page.getByRole("searchbox", {name: "Suchtext", exact: true}),
        ).toHaveValue(prefix);
        await expect(page.getByLabel("Sortieren", {exact: true})).toHaveValue(
            "total_desc",
        );
        await page
            .getByRole("button", {name: "Ansicht umbenennen", exact: true})
            .click();
        dialog = page.getByRole("dialog");
        await dialog.getByLabel("Name der Ansicht", {exact: true}).fill(renamed);
        await dialog
            .getByRole("button", {name: "Speichern", exact: true})
            .click();
        await expect(dialog).not.toBeVisible();
        await expect(
            page
                .getByLabel("Ansicht auswählen", {exact: true})
                .getByRole("option", {name: renamed, exact: true}),
        ).toHaveCount(1);
        const reader = await other.newPage();
        await login(reader, peer.email);
        await reader.goto("/jobs");
        await reader.getByText("Filter & Ansichten", {exact: true}).click();
        await expect(
            reader.getByLabel("Ansicht auswählen", {exact: true}),
        ).toBeVisible();
        await expect(
            reader
                .getByLabel("Ansicht auswählen", {exact: true})
                .getByRole("option", {name: renamed, exact: true}),
        ).toHaveCount(0);
        await page.getByLabel("Sprache", {exact: true}).selectOption("en");
        await page.getByLabel("Theme", {exact: true}).selectOption("dark");
        await expect(
            page.getByRole("searchbox", {name: "Search text", exact: true}),
        ).toHaveValue(prefix);
        await page.evaluate(() => document.fonts.ready);
        const report = await new AxeBuilder({page})
            .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
            .analyze();
        expect(report.violations.map((v) => v.id)).toEqual([]);
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
            ),
        ).toBe(true);
        await page.screenshot({
            path: testInfo.outputPath("job-discovery.png"),
            fullPage: true,
        });
        await page
            .getByRole("button", {name: "Remove view", exact: true})
            .click();
        dialog = page.getByRole("dialog");
        await dialog
            .getByRole("button", {name: "Remove view", exact: true})
            .click();
        await expect(dialog).not.toBeVisible();
        await page.reload();
        await page.getByText(/^(Filter & Ansichten|Filters & views)$/).click();
        await expect(
            page.getByLabel("Choose a view", {exact: true}),
        ).toBeVisible();
        await expect(
            page
                .getByLabel("Choose a view", {exact: true})
                .getByRole("option", {name: renamed, exact: true}),
        ).toHaveCount(0);
        page.off("request", listener);

        // An unchanged URL must still recheck the current private calendar.
        const available = page.getByLabel("No overlap in my calendar", {exact: true});
        const apply = page.getByRole("button", {name: "Apply filters", exact: true});
        await available.check();
        await apply.click();
        await expect(page).toHaveURL(/available=1/);
        await expect(page.locator(".jobs-grid>.job-card").first()).toContainText(prefix);
        await checked(service.from("personal_events").insert({
            id: conflictId,
            user_id: teacher.id,
            title: "Fictional calendar conflict",
            starts_at: "2060-04-01T08:30:00Z",
            ends_at: "2060-04-01T09:30:00Z",
        }));
        const waitForAvailability = () => page.waitForResponse((r) =>
            r.url().includes("/rpc/job_discovery") &&
            r.status() === 200 &&
            r.request().postDataJSON()?.p_filters?.available_only === true,
        );
        await Promise.all([waitForAvailability(), apply.click()]);
        await expect(page.locator(".jobs-grid>.job-card")).toHaveCount(0);
        await checked(service.from("personal_events").delete().eq("id", conflictId));
        await Promise.all([waitForAvailability(), apply.click()]);
        await expect(page.locator(".jobs-grid>.job-card").first()).toContainText(prefix);

        const learnerContext = await browser.newContext();
        try {
            const learnerPage = await learnerContext.newPage();
            const forbiddenRequests: string[] = [];
            learnerPage.on("request", (r) => {
                if (
                    /\/rpc\/(job_discovery|job_dashboard|saved_job_views)/.test(r.url())
                )
                    forbiddenRequests.push(r.url());
            });
            await login(learnerPage, learner.email, /\/learning$/);
            await learnerPage.goto("/jobs");
            // The participant shell redirects before requesting operational jobs.
            await expect(learnerPage).toHaveURL(/\/learning$/);
            await expect(learnerPage.getByText(rows[0].title, {exact: true})).toHaveCount(0);
            expect(forbiddenRequests).toEqual([]);
        } finally {
            await learnerContext.close();
        }
    } finally {
        await other.close();
        await checked(service.from("personal_events").delete().eq("id", conflictId));
        // The complete canonical project is disposable. Remove own public fixtures as
        // well so this workflow can run independently without leaving catalogue rows.
        await checked(
            service
                .from("job_sessions")
                .delete()
                .in(
                    "job_id",
                    rows.map((row) => row.id),
                ),
        );
        await checked(
            service
                .from("jobs")
                .delete()
                .in(
                    "id",
                    rows.map((row) => row.id),
                ),
        );
        // Saved-view rows are own private data; profile deletion cascades them. A
        // surviving view after failure must not be accessed through a service bypass.
        for (const who of [teacher, peer, learner]) {
            await checked(
                service.from("notifications").delete().eq("user_id", who.id),
            );
            await checked(
                service.from("audit_events").delete().eq("actor_id", who.id),
            );
            await checked(service.auth.admin.deleteUser(who.id));
        }
    }
});
