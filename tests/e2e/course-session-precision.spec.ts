/**
 * Real Course edit regression for known Berlin DST-fold instants and six-digit
 * PostgreSQL precision. Password-only authorised RPCs seed the course; only its
 * venue is edited in the browser. Exact timestamp strings are read through the
 * same authorised server API, never rounded through JavaScript Date/Luxon.
 * The canonical runner owns the disposable stack and both browser projects.
 */
import {expect, test} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {actor, api, assertPasswordOnly, checked, login,} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Course precision fixtures require the canonical disposable project.",
);

test("metadata-only course editing preserves a known DST fold and all six PostgreSQL fractional digits", async ({
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
        await page.goto("/courses");
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
        await page.getByLabel("Search", {exact: true}).fill(title);
        await expect(card).toHaveCount(1);
        await card.getByRole("button", {name: "Edit", exact: true}).click();
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
        await reopened.getByRole("button", {name: "Close", exact: true}).click();
        await expect(reopened).toBeHidden();
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