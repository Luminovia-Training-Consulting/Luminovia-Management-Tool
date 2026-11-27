/**
 * Real Course edit regression for known Berlin DST-fold instants and six-digit
 * PostgreSQL precision. Password-only authorised RPCs seed the course; only its
 * venue is edited in the browser. Exact timestamp strings are read through the
 * same authorised server API, never rounded through JavaScript Date/Luxon.
 * The canonical runner owns the disposable stack and both browser projects.
 */
import AxeBuilder from "@axe-core/playwright";
import {expect, test} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {actor, api, assertPasswordOnly, checked, login,} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Course precision fixtures require the canonical disposable project.",
);

test("retained course editing preserves exact timestamps and reviewed schedule changes", async ({
                                                                                                                    page,
                                                                                                                }) => {
    test.setTimeout(90_000);
    const suffix = randomUUID().slice(0, 8);
    const administrator = await actor(
        `Fictional precision admin ${suffix}`,
        "admin",
    );
    // The shared actor() helper provisions only this fictional Auth identity/role
    // in Node. This separate service client is cleanup-only; course creation,
    // readback and browser mutation use the regular password-only actor. api() restricts
    // both clients to the random canonical loopback QA project.
    const cleanup = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const client = api(process.env.SUPABASE_ANON_KEY!);
    const title = `Fictional precision course ${suffix}`;
    const changedVenue = `Fictional edited room ${suffix}`;
    const sessions = [
        {
            // This is the second Berlin 02:30 occurrence (CET), not the earlier CEST
            // occurrence. A minute-only editor cannot reconstruct that choice or µs.
            starts_at: "2030-10-27T01:30:17.123456+00:00",
            ends_at: "2030-10-27T02:15:42.654321+00:00",
        },
    ];
    let templateId: string | undefined;
    let runId: string | undefined;
    try {
        const signedIn = await client.auth.signInWithPassword({
            email: administrator.email,
            password: process.env.E2E_PASSWORD!,
        });
        expect(signedIn.error).toBeNull();
        expect(signedIn.data.session).not.toBeNull();
        await assertPasswordOnly(client);
        templateId = await checked(
            client.rpc("save_course_template", {
                p_id: null,
                p_payload: {
                    title,
                    description:
                        "Fictional course for an exact timestamp browser regression.",
                    syllabus: "Known instants and metadata-only changes.",
                    prerequisites: "",
                    topic_ids: [],
                    archived: false,
                },
            }),
        );
        expect(templateId).toMatch(/^[a-f0-9-]{36}$/);
        runId = await checked(
            client.rpc("save_course_run", {
                p_id: null,
                p_payload: {
                    template_id: templateId,
                    organisation_id: "",
                    time_zone: "Europe/Berlin",
                    delivery_type: "onsite",
                    venue: `Fictional original room ${suffix}`,
                    published: false,
                    archived: false,
                    sessions,
                },
            }),
        );
        expect(runId).toMatch(/^[a-f0-9-]{36}$/);
        const before = await checked(
            client
                .from("course_sessions")
                .select("starts_at,ends_at")
                .eq("course_run_id", runId!)
                .order("starts_at"),
        );
        // Establish that the actual database/API retained the seeded µs and offset
        // before the UI edit; equality below therefore cannot mask a rounded seed.
        expect(before).toEqual(sessions);

        await login(page, administrator.email);
        await page
            .getByLabel(/^(Language|Sprache)$/, {exact: true})
            .selectOption("de");
        await expect(page.locator("html")).toHaveAttribute("lang", "de");
        await page.goto("/calendar");
        await page.getByLabel("Kalenderanzeige in").selectOption("Australia/Brisbane");
        await page.getByText("Kurs aus dem Kalender planen", {exact: true}).press("Enter");
        await page.getByLabel("Unterrichtstag", {exact: true}).fill("2030-11-03");
        await page.getByRole("button", {name: "Kursentwurf öffnen", exact: true}).click();
        const calendarDraft = page.getByRole("dialog", {name: "Kurs- und Auftragsassistent starten", exact: true});
        await expect(calendarDraft.getByLabel("Zeitzone", {exact: true})).toHaveValue("Australia/Brisbane");
        await expect(calendarDraft.getByLabel("Beginn 1", {exact: true})).toHaveValue("2030-11-03T09:00");
        await expect(calendarDraft.getByLabel("Ende 1", {exact: true})).toHaveValue("2030-11-03T17:00");
        await calendarDraft.getByRole("button", {name: "Schließen", exact: true}).click();
        await expect(calendarDraft).toBeHidden();
        await expect(page).toHaveURL(/\/courses$/);
        await page.getByLabel("Suchen", {exact: true}).fill(title);
        const card = page.locator(".operations-course").filter({
            has: page.getByRole("heading", {name: title, exact: true}),
        });
        await expect(card).toHaveCount(1);
        await card.getByRole("button", {name: "Kurs ansehen", exact: true}).click();
        await page.getByRole("dialog").getByRole("button", {name: "Bearbeiten", exact: true}).click();
        const dialog = page.getByRole("dialog", {
            name: "Bearbeiten",
            exact: true,
        });
        await expect(dialog.getByLabel("Zeitzone", {exact: true})).toHaveValue(
            "Europe/Berlin",
        );
        await expect(dialog.getByLabel("Beginn 1", {exact: true})).toHaveValue(
            "2030-10-27T02:30",
        );
        await expect(dialog.getByLabel("Ende 1", {exact: true})).toHaveValue(
            "2030-10-27T03:15",
        );
        // Deliberately leave both minute fields and the intended zone untouched.
        await dialog
            .getByLabel("Ort / Zugangslink", {exact: true})
            .fill(changedVenue);
        const savedResponse = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === "/rest/v1/rpc/save_course_run" &&
                response.request().method() === "POST",
        );
        await dialog
            .getByRole("button", {name: "Speichern", exact: true})
            .click();
        const response = await savedResponse;
        expect(response.ok()).toBe(true);
        expect(await response.json()).toBe(runId);
        expect(response.request().postDataJSON()).toMatchObject({
            p_id: runId,
            p_payload: {time_zone: "Europe/Berlin", venue: changedVenue, sessions},
        });
        await expect(dialog).toBeHidden();
        await expect(page.getByRole("status").filter({hasText: "Gespeichert."})).toBeVisible();

        const stored = await checked(
            client
                .from("course_runs")
                .select("venue,time_zone,template_id,published")
                .eq("id", runId!)
                .single(),
        );
        expect(stored).toEqual({
            venue: changedVenue,
            time_zone: "Europe/Berlin",
            template_id: templateId,
            published: false,
        });
        const after = await checked(
            client
                .from("course_sessions")
                .select("starts_at,ends_at")
                .eq("course_run_id", runId!)
                .order("starts_at"),
        );
        expect(after).toEqual(before);
        expect(after).toEqual(sessions);

        // Reload, switch the real interface to English and reopen the saved form.
        // The authored venue and minute display must still describe the same data.
        await page.reload();
        await page.getByLabel("Sprache", {exact: true}).selectOption("en");
        await page.getByLabel("Theme", {exact: true}).selectOption("dark");
        await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
        await page.getByLabel("Search", {exact: true}).fill(title);
        await expect(card).toHaveCount(1);
        await card.getByRole("button", {name: "View course", exact: true}).click();
        await page.getByRole("dialog").getByRole("button", {name: "Edit", exact: true}).click();
        const reopened = page.getByRole("dialog", {name: "Edit", exact: true});
        await expect(
            reopened.getByLabel("Venue / access link", {exact: true}),
        ).toHaveValue(changedVenue);
        await expect(reopened.getByLabel("Time zone", {exact: true})).toHaveValue(
            "Europe/Berlin",
        );
        await expect(reopened.getByLabel("Start 1", {exact: true})).toHaveValue(
            "2030-10-27T02:30",
        );
        await expect(reopened.getByLabel("End 1", {exact: true})).toHaveValue(
            "2030-10-27T03:15",
        );
        await reopened.getByText("Plan sessions", {exact: true}).press("Enter");
        await reopened.getByLabel("Date selection").selectOption("dates");
        await reopened.getByLabel("Specific teaching dates", {exact: true}).fill("2030-11-04\n2030-11-05");
        await reopened.getByRole("button", {name: "Preview sessions", exact: true}).click();
        await expect(reopened.getByRole("status").filter({hasText: "Proposed sessions (2)"})).toBeVisible();
        await expect(reopened.getByLabel("Start 1", {exact: true})).toHaveValue("2030-10-27T02:30");
        await reopened.getByRole("button", {name: "Replace sessions in form", exact: true}).click();
        await expect(reopened.getByLabel("Start 2", {exact: true})).toHaveValue("2030-11-05T09:00");
        await reopened.getByText("Edit multiple sessions", {exact: true}).click();
        await reopened.getByRole("group", {name: "Select sessions"}).getByRole("checkbox").nth(1).check();
        await reopened.getByLabel("Shift by calendar days").fill("2");
        await reopened.getByRole("button", {name: "Review session changes"}).click();
        await expect(reopened.getByLabel("Start 2", {exact: true})).toHaveValue("2030-11-05T09:00");
        await reopened.getByRole("button", {name: "Apply session changes"}).click();
        await expect(reopened.getByLabel("Start 1", {exact: true})).toHaveValue("2030-11-04T09:00");
        await expect(reopened.getByLabel("Start 2", {exact: true})).toHaveValue("2030-11-07T09:00");
        await expect.poll(() => reopened.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        const audit = await new AxeBuilder({page})
            .include(".operations-schedule-planner")
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze();
        expect(audit.violations).toEqual([]);
        await reopened.getByRole("button", {name: "Save", exact: true}).click();
        await expect(reopened).toBeHidden();
        const proposed = await checked(
            client.from("course_sessions").select("starts_at,ends_at").eq("course_run_id", runId!).order("starts_at"),
        );
        expect(proposed).toEqual([
            {starts_at: "2030-11-04T08:00:00+00:00", ends_at: "2030-11-04T16:00:00+00:00"},
            {starts_at: "2030-11-07T08:00:00+00:00", ends_at: "2030-11-07T16:00:00+00:00"},
        ]);


        await page.goto(`/courses/${runId}/workspace`);
        await page.getByText("Delivery and venues", {exact: true}).press("Enter");
        const delivery = page.locator(".training-delivery-disclosure");
        await delivery.getByLabel("Delivery format", {exact: true}).selectOption("online");
        await delivery.getByLabel("Joining link", {exact: true}).fill("https://training.example.invalid/live");
        await delivery.getByRole("button", {name: "Save delivery", exact: true}).click();
        await expect(delivery.getByRole("status")).toHaveText("Delivery saved.");
        await expect.poll(() => delivery.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        const deliveryAudit = await new AxeBuilder({page})
            .include(".training-delivery-disclosure")
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze();
        expect(deliveryAudit.violations).toEqual([]);
    } finally {
        // Only exact IDs created above are removed, outside the browser and only
        // after the ordinary authorised server readbacks. No production target is
        // accepted by api(), and no service credential enters page.evaluate/storage.
        if (runId) {
            await checked(
                cleanup.from("course_sessions").delete().eq("course_run_id", runId),
            );
            await checked(cleanup.from("course_runs").delete().eq("id", runId));
        }
        if (templateId)
            await checked(
                cleanup.from("course_templates").delete().eq("id", templateId),
            );
        await checked(
            cleanup.from("audit_events").delete().eq("actor_id", administrator.id),
        );
        expect((await client.auth.signOut()).error).toBeNull();
        expect(
            (await cleanup.auth.admin.deleteUser(administrator.id)).error,
        ).toBeNull();
    }
});
