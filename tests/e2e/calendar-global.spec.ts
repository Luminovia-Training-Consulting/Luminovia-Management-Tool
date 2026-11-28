import {expect, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {actor, adminLogin, api, checked, login,} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Global calendar fixtures require the canonical disposable stack.",
);
test("password-only authentication global publication, descriptions/HTTPS links, draft withdrawal and archive/recover stay connected", async ({
                                                                                                                                                  page,
                                                                                                                                                  browser,
                                                                                                                                                  context,
                                                                                                                                              }, testInfo) => {
    test.setTimeout(120000);
    const admin = await actor("Fictional global calendar admin", "admin"),
        // Participant-only accounts no longer have portal access; use an active
        // non-management account to exercise the public published-event view.
        reader = await actor("Fictional global calendar reader", "lecturer"),
        service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
        prefix = `Calendar-${randomUUID().slice(0, 8)}`,
        title = `${prefix} initial`,
        revised = `${prefix} revised`,
        description = "Fictional <script> lesson description stays text.";
    const viewerContext = await browser.newContext(),
        viewer = await viewerContext.newPage();
    const eventDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const day = `${eventDate.getUTCFullYear()}-${String(eventDate.getUTCMonth() + 1).padStart(2, "0")}-${String(eventDate.getUTCDate()).padStart(2, "0")}`,
        start = `${day}T12:00`,
        end = `${day}T14:00`;
    try {
        await adminLogin(page, admin);
        await page.goto("/calendar");
        await page
            .getByRole("button", {name: /^(Globale Termine|Global events)$/})
            .click();
        const management = page.getByRole("region", {
            name: "Globale Termine verwalten",
            exact: true,
        });
        await management
            .getByRole("button", {name: "Globalen Termin erstellen", exact: true})
            .click();
        let dialog = page.getByRole("dialog");
        await dialog.getByLabel("Titel", {exact: true}).fill(title);
        await dialog.getByLabel("Beschreibung", {exact: true}).fill(description);
        await dialog
            .getByLabel("HTTPS-Link (optional)", {exact: true})
            .fill("https://example.invalid/lesson");
        await dialog.getByLabel("Beginn", {exact: true}).fill(start);
        await dialog.getByLabel("Ende", {exact: true}).fill(end);
        await dialog.getByLabel("Zeitzone", {exact: true}).fill("UTC");
        await page.getByLabel("Sprache", {exact: true}).selectOption("en");
        await expect(dialog.getByLabel("Title", {exact: true})).toHaveValue(
            title,
        );
        await page.getByLabel("Language", {exact: true}).selectOption("de");
        await dialog
            .getByRole("button", {name: "Als Entwurf speichern", exact: true})
            .click();
        await expect(dialog).toBeHidden();
        let row = management
            .getByRole("article")
            .filter({has: page.getByRole("heading", {name: title, exact: true})});
        await expect(row.getByText(/^(Entwurf|Draft)$/)).toBeVisible();
        await login(viewer, reader.email);
        await viewer.goto("/calendar");
        await viewer
            .getByRole("button", {name: /^(Globale Termine|Global events)$/})
            .click();
        await expect(viewer.locator(".global-event-public-status>p")).toBeVisible();
        await expect(viewer.getByText(title, {exact: true})).toHaveCount(0);
        await expect(
            viewer.getByRole("region", {name: "Globale Termine verwalten"}),
        ).toHaveCount(0);
        await row
            .getByRole("button", {name: "Veröffentlichen", exact: true})
            .click();
        await expect(
            row.getByText("Veröffentlicht", {exact: true}),
        ).toBeVisible();
        await viewer.reload();
        await viewer
            .getByRole("button", {name: /^(Globale Termine|Global events)$/})
            .click();
        await viewer
            .locator(".calendar-panel")
            .getByText(title, {exact: true})
            .click();
        const details = viewer.getByRole("dialog");
        await expect(details.getByText(description, {exact: true})).toBeVisible();
        expect(await details.locator("script").count()).toBe(0);
        await expect(
            details.getByRole("link", {
                name: "Weiterführenden Link öffnen",
                exact: true,
            }),
        ).toHaveAttribute("href", "https://example.invalid/lesson");
        await expect(details.getByRole("button", {
            name: "Kalendereintrag herunterladen (.ics)",
            exact: true,
        })).toBeVisible();
        await viewer.getByLabel("Sprache", {exact: true}).selectOption("en");
        await viewer.getByLabel("Theme", {exact: true}).selectOption("dark");
        await expect(
            details.getByRole("link", {name: "Open related link", exact: true}),
        ).toHaveAttribute("rel", "noopener noreferrer");
        const [download] = await Promise.all([
            viewer.waitForEvent("download"),
            details.getByRole("button", {name: "Download calendar event (.ics)", exact: true}).click(),
        ]);
        expect(download.suggestedFilename()).toBe("luminovia-event.ics");
        const content = await readFile((await download.path())!, "utf8");
        const date = day.replaceAll("-", "");
        expect(content).toContain(`DTSTART:${date}T120000Z\r\n`);
        expect(content).toContain(`DTEND:${date}T140000Z\r\n`);
        expect(content).toContain(`SUMMARY:${title}\r\n`);
        expect(content).not.toContain(description);
        expect(content).not.toContain("https://example.invalid/lesson");
        await viewer.evaluate(() => document.fonts.ready);
        const report = await new AxeBuilder({page: viewer})
            .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
            .analyze();
        expect(
            report.violations.map((v) => ({
                id: v.id,
                targets: v.nodes.map((n) => n.target),
            })),
        ).toEqual([]);
        expect(
            await viewer.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
            ),
        ).toBe(true);
        await viewer.screenshot({
            path: testInfo.outputPath("global-calendar.png"),
            fullPage: true,
        });
        await row
            .getByRole("button", {name: "Entwurf bearbeiten", exact: true})
            .click();
        dialog = page.getByRole("dialog");
        await dialog.getByLabel("Titel", {exact: true}).fill(revised);
        await context.setOffline(true);
        await expect(
            dialog.getByRole("button", {
                name: "Als Entwurf speichern",
                exact: true,
            }),
        ).toBeDisabled();
        await context.setOffline(false);
        await dialog
            .getByRole("button", {name: "Als Entwurf speichern", exact: true})
            .click();
        await expect(dialog).toBeHidden();
        row = management.getByRole("article").filter({
            has: page.getByRole("heading", {name: revised, exact: true}),
        });
        await expect(row.getByText("Entwurf", {exact: true})).toBeVisible();
        await viewer.reload();
        await viewer
            .getByRole("button", {name: "Global events", exact: true})
            .click();
        await expect(viewer.locator(".global-event-public-status>p")).toBeVisible();
        await expect(viewer.getByText(title, {exact: true})).toHaveCount(0);
        await expect(viewer.getByText(revised, {exact: true})).toHaveCount(0);
        await row.getByRole("button", {name: "Archivieren", exact: true}).click();
        await expect(row.getByText("Archiviert", {exact: true})).toBeVisible();
        await row
            .getByRole("button", {
                name: "Als Entwurf wiederherstellen",
                exact: true,
            })
            .click();
        await expect(row.getByText("Entwurf", {exact: true})).toBeVisible();
        await row
            .getByRole("button", {name: "Veröffentlichen", exact: true})
            .click();
        await expect(
            row.getByText("Veröffentlicht", {exact: true}),
        ).toBeVisible();
        await row
            .getByRole("button", {
                name: "Veröffentlichung zurücknehmen",
                exact: true,
            })
            .click();
        await expect(row.getByText("Entwurf", {exact: true})).toBeVisible();
    } finally {
        await context.setOffline(false);
        await viewerContext.close();
        const own = await checked(
            service.from("global_events").select("id").like("title", `${prefix}%`),
            {requireData: true},
        );
        if (own.length)
            await checked(
                service
                    .from("global_events")
                    .delete()
                    .in(
                        "id",
                        own.map((e) => e.id),
                    ),
            );
        for (const user of [admin, reader]) {
            await checked(
                service.from("audit_events").delete().eq("actor_id", user.id),
            );
            await checked(service.auth.admin.deleteUser(user.id));
        }
    }
});

test("global calendar only transfers published course sessions in the visible range", async ({page}) => {
    const admin = await actor("Fictional calendar range administrator", "admin");
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const [template, published, draft, archived, organisation, topic] = Array.from({length: 6}, randomUUID);
    const title = `Fictional range course ${template.slice(0, 8)}`;
    const topicLabel = `Fiktives Kalenderthema ${topic.slice(0, 8)}`;
    const session = (course_run_id: string, offsetDays: number) => {
        const start = new Date();
        start.setUTCHours(11, 0, 0, 0);
        start.setUTCDate(start.getUTCDate() + offsetDays);
        return {
            id: randomUUID(),
            course_run_id,
            starts_at: start.toISOString(),
            ends_at: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
        };
    };
    const current = session(published, 0);
    await checked(service.from("course_templates").insert({id: template, title}));
    try {
        await checked(service.from("organisations").insert({id: organisation, name: "Fictional calendar range company"}));
        await checked(service.from("topics").insert({
            id: topic,
            label_de: topicLabel,
            kind: "topic",
            label_en: "Fictional calendar topic",
        }));
        await checked(service.from("course_template_topics").insert({template_id: template, topic_id: topic}));
        await checked(service.from("course_runs").insert([
            {id: published, template_id: template, organisation_id: organisation, published: true, archived_at: null},
            {id: draft, template_id: template, published: false, archived_at: null},
            {id: archived, template_id: template, published: true, archived_at: new Date().toISOString()},
        ]));
        await checked(service.from("course_sessions").insert([
            current,
            session(published, -180),
            session(published, 180),
            session(draft, 0),
            session(archived, 0),
        ]));
        await adminLogin(page, admin);
        await page.goto("/calendar");
        await page.getByRole("group", {name: "Kalenderansicht"}).getByRole("button", {name: "Tag", exact: true}).click();
        const broadReads: string[] = [];
        page.on("request", (request) => {
            const path = new URL(request.url()).pathname;
            if (/\/rest\/v1\/(?:course_templates|organisations|topics)$/.test(path))
                broadReads.push(path);
        });
        const courses = page.waitForResponse((response) => {
            const url = new URL(response.url());
            return url.pathname.endsWith("/rest/v1/course_runs") &&
                url.searchParams.has("course_sessions.starts_at");
        });
        await page.getByRole("button", {name: "Globale Termine", exact: true}).click();
        const response = await courses;
        expect(response.ok()).toBe(true);
        const range = new URL(response.url()).searchParams;
        expect(range.get("course_sessions.starts_at")).toMatch(/^lt\./);
        expect(range.get("course_sessions.ends_at")).toMatch(/^gt\./);
        const scopedRows = (await response.json()).filter(
            (row: {template_id: string}) => row.template_id === template,
        );
        expect(scopedRows).toEqual([expect.objectContaining({
            id: published,
            organisations: {name: "Fictional calendar range company"},
            course_templates: {
                title,
                course_template_topics: [{
                    topics: {id: topic, label_de: topicLabel, label_en: "Fictional calendar topic"},
                }],
            },
            course_sessions: [expect.objectContaining({id: current.id})],
        })]);
        await expect(page.locator(".calendar-panel").getByText(title, {exact: true})).toBeVisible();
        expect(broadReads).toEqual([]);
    } finally {
        await checked(service.from("course_sessions").delete().in("course_run_id", [published, draft, archived]));
        await checked(service.from("course_runs").delete().in("id", [published, draft, archived]));
        await checked(service.from("course_templates").delete().eq("id", template));
        await checked(service.from("topics").delete().eq("id", topic));
        await checked(service.from("organisations").delete().eq("id", organisation));
        await checked(service.auth.admin.deleteUser(admin.id));
    }
});
