/** Canonical real-Auth calendar workflows: preserve instants/zones, exercise actual CRUD and keep private appointments isolated even from a password-only administrator. Only disposable fixtures are mutated. */
import {expect, type Page, test} from "@playwright/test";
import {DateTime} from "luxon";
import {randomUUID} from "node:crypto";
import {actor, api, assertPasswordOnly, checked, login,} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Calendar lifecycle runs only in the isolated ./portal test project.",
);

/** Obtain a genuine independent SDK session for an already-created disposable actor. */
async function signedIn(user: { email: string }) {
    const client = api(process.env.SUPABASE_ANON_KEY!);
    await checked(
        client.auth.signInWithPassword({
            email: user.email,
            password: process.env.E2E_PASSWORD!,
        }),
    );
    return client;
}

/** Open the actual visible event rather than injecting a selected record into component state. */
async function eventDialog(page: Page, title: string) {
    await page.locator(".fc-event").filter({hasText: title}).click();
    const dialog = page.getByRole("dialog", {
        name: "Privater Termin",
        exact: true,
    });
    await expect(dialog).toBeVisible();
    return dialog;
}

test("calendar rejects invalid DST intervals, persists create/edit/delete and preserves privacy against lecturers and an administrator", async ({
                                                                                                                                                    page,
                                                                                                                                                    context,
                                                                                                                                                }) => {
    test.setTimeout(100_000);
    const owner = await actor("Private calendar owner", "lecturer");
    const stranger = await actor("Private calendar stranger", "lecturer");
    const admin = await actor("Private calendar administrator", "admin");
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    await checked(
        service
            .from("profiles")
            .update({time_zone: "Australia/Brisbane"})
            .eq("id", owner.id),
    );
    await login(page, owner.email);
    await page.goto("/calendar");
    await expect(page.locator(".calendar-controls .badge")).toHaveText(
        "Australia/Brisbane",
    );
    await page
        .getByRole("button", {name: "Privaten Termin hinzufügen", exact: true})
        .click();
    let dialog = page.getByRole("dialog", {
        name: "Privaten Termin hinzufügen",
        exact: true,
    });
    const title = `Private calendar ${randomUUID().slice(0, 8)}`;
    await dialog.getByLabel("Titel", {exact: true}).fill(title);
    await dialog
        .getByLabel("Beschreibung oder Notiz", {exact: true})
        .fill("Fictional private preparation note");
    await dialog.getByLabel("Zeitzone", {exact: true}).fill("Europe/Berlin");
    let writes = 0;
    page.on("request", (request) => {
        if (
            new URL(request.url()).pathname === "/rest/v1/personal_events" &&
            ["POST", "PATCH", "DELETE"].includes(request.method())
        )
            writes++;
    });
    for (const [start, end] of [
        ["2030-03-31T02:30", "2030-03-31T04:00"],
        ["2030-10-27T02:30", "2030-10-27T04:00"],
        ["2030-04-01T11:00", "2030-04-01T10:00"],
    ]) {
        await dialog.getByLabel("Beginn", {exact: true}).fill(start);
        await dialog.getByLabel("Ende", {exact: true}).fill(end);
        await dialog
            .getByRole("button", {name: "Termin speichern", exact: true})
            .click();
        await expect(dialog.getByRole("alert")).toContainText(
            "Bitte wähle einen eindeutigen Beginn und ein späteres Ende.",
        );
        expect(writes, "Invalid local intervals never reach the write API").toBe(0);
        expect(
            await checked(
                service.from("personal_events").select("id").eq("user_id", owner.id),
            ),
        ).toEqual([]);
    }
    const start = DateTime.now()
        .setZone("Australia/Brisbane")
        .startOf("day")
        .plus({hours: 10});
    const local = (value: DateTime) => value.toFormat("yyyy-MM-dd'T'HH:mm");
    await dialog
        .getByLabel("Zeitzone", {exact: true})
        .fill("Australia/Brisbane");
    await dialog.getByLabel("Beginn", {exact: true}).fill(local(start));
    await dialog
        .getByLabel("Ende", {exact: true})
        .fill(local(start.plus({hours: 1})));
    await dialog
        .getByLabel("Meeting-Link (HTTPS)", {exact: true})
        .fill("https://user:pass@example.invalid");
    await dialog
        .getByRole("button", {name: "Termin speichern", exact: true})
        .click();
    await expect(
        dialog.getByLabel("Meeting-Link (HTTPS)", {exact: true}),
    ).toHaveAttribute("aria-invalid", "true");
    expect(writes).toBe(0);
    await expect(
        dialog.getByLabel("Beschreibung oder Notiz", {exact: true}),
    ).toHaveValue("Fictional private preparation note");
    await dialog
        .getByLabel("Meeting-Link (HTTPS)", {exact: true})
        .fill("https://meet.example.invalid/fictional-room");
    await dialog
        .getByRole("button", {name: "Termin speichern", exact: true})
        .click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("status")).toHaveText("Termin gespeichert.");
    const original = (await checked(
        service
            .from("personal_events")
            .select("id,title,description,meeting_url,starts_at,ends_at,time_zone")
            .eq("user_id", owner.id)
            .single(),
    ))!;
    expect(original.title).toBe(title);
    expect(original.description).toBe("Fictional private preparation note");
    expect(original.meeting_url).toBe(
        "https://meet.example.invalid/fictional-room",
    );
    expect(new Date(original.starts_at).toISOString()).toBe(
        start.toUTC().toISO(),
    );
    expect(new Date(original.ends_at).toISOString()).toBe(
        start.plus({hours: 1}).toUTC().toISO(),
    );
    expect(original.time_zone).toBe("Australia/Brisbane");
    expect(writes).toBe(1);
    await page.reload();
    dialog = await eventDialog(page, title);
    await expect(dialog.getByLabel("Beginn", {exact: true})).toHaveValue(
        local(start),
    );
    await expect(
        dialog.getByLabel("Beschreibung oder Notiz", {exact: true}),
    ).toHaveValue("Fictional private preparation note");
    await expect(
        dialog.getByRole("link", {name: "Meeting-Link öffnen"}),
    ).toHaveAttribute("href", "https://meet.example.invalid/fictional-room");
    const editedTitle = `${title} revised`;
    const editedStart = start.plus({hours: 2});
    await dialog.getByLabel("Titel", {exact: true}).fill(editedTitle);
    await dialog.getByLabel("Beginn", {exact: true}).fill(local(editedStart));
    await dialog
        .getByLabel("Ende", {exact: true})
        .fill(local(editedStart.plus({hours: 1})));
    await page.keyboard.press("Escape");
    let discardDialog = page.getByRole("dialog", {
        name: "Ungespeicherte Änderungen verwerfen?",
        exact: true,
    });
    await expect(discardDialog).toBeVisible();
    await discardDialog
        .getByRole("button", {name: "Entwurf behalten", exact: true})
        .click();
    await expect(dialog.getByLabel("Titel", {exact: true})).toHaveValue(
        editedTitle,
    );
    expect(writes, "Keeping a draft does not write an appointment").toBe(1);
    await dialog.getByRole("button", {name: "Schließen", exact: true}).click();
    discardDialog = page.getByRole("dialog", {
        name: "Ungespeicherte Änderungen verwerfen?",
        exact: true,
    });
    await discardDialog
        .getByRole("button", {name: "Änderungen verwerfen", exact: true})
        .click();
    await expect(dialog).toBeHidden();
    expect(writes, "Discarding a draft does not write an appointment").toBe(1);
    dialog = await eventDialog(page, title);
    await expect(dialog.getByLabel("Titel", {exact: true})).toHaveValue(title);
    await dialog.getByLabel("Titel", {exact: true}).fill(editedTitle);
    await dialog.getByLabel("Beginn", {exact: true}).fill(local(editedStart));
    await dialog
        .getByLabel("Ende", {exact: true})
        .fill(local(editedStart.plus({hours: 1})));
    await context.setOffline(true);
    await expect(
        dialog.getByRole("button", {name: "Termin speichern", exact: true}),
    ).toBeDisabled();
    await expect(
        dialog.getByRole("button", {
            name: "Privaten Termin löschen",
            exact: true,
        }),
    ).toBeDisabled();
    expect(writes).toBe(1);
    await context.setOffline(false);
    await dialog
        .getByRole("button", {name: "Termin speichern", exact: true})
        .click();
    await expect(dialog).toBeHidden();
    await page.reload();
    dialog = await eventDialog(page, editedTitle);
    await expect(dialog.getByLabel("Beginn", {exact: true})).toHaveValue(
        local(editedStart),
    );
    const stored = await checked(
        service.from("personal_events").select("*").eq("id", original.id).single(),
    );
    expect(stored.title).toBe(editedTitle);
    expect(new Date(stored.starts_at).toISOString()).toBe(
        editedStart.toUTC().toISO(),
    );
    const manager = await signedIn(admin);
    await assertPasswordOnly(manager);
    for (const client of [await signedIn(stranger), manager]) {
        expect(
            await checked(
                client.from("personal_events").select("*").eq("id", original.id),
            ),
        ).toEqual([]);
        expect(
            await checked(
                client
                    .from("personal_events")
                    .update({title: "Forged private edit"})
                    .eq("id", original.id)
                    .select("id"),
            ),
        ).toEqual([]);
        expect(
            await checked(
                client
                    .from("personal_events")
                    .delete()
                    .eq("id", original.id)
                    .select("id"),
            ),
        ).toEqual([]);
    }
    expect(
        await checked(
            service
                .from("personal_events")
                .select("*")
                .eq("id", original.id)
                .single(),
        ),
    ).toEqual(stored);
    await dialog
        .getByRole("button", {name: "Privaten Termin löschen", exact: true})
        .click();
    const confirmation = page.getByRole("dialog", {
        name: "Privaten Termin löschen?",
        exact: true,
    });
    await expect(confirmation).toBeVisible();
    await expect(
        confirmation.getByText(editedTitle, {exact: true}),
    ).toBeVisible();
    await confirmation
        .getByRole("button", {name: "Abbrechen", exact: true})
        .click();
    await expect(confirmation).toBeHidden();
    await expect(dialog).toBeVisible();
    expect(
        writes,
        "Cancelling the confirmation never reaches the write API",
    ).toBe(2);
    expect(
        await checked(
            service
                .from("personal_events")
                .select("*")
                .eq("id", original.id)
                .single(),
        ),
    ).toEqual(stored);
    await dialog
        .getByRole("button", {name: "Privaten Termin löschen", exact: true})
        .click();
    await expect(confirmation).toBeVisible();
    await confirmation
        .getByRole("button", {name: "Privaten Termin löschen", exact: true})
        .click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("status")).toHaveText("Termin gelöscht.");
    expect(writes).toBe(3);
    expect(
        await checked(
            service.from("personal_events").select("id").eq("id", original.id),
        ),
    ).toEqual([]);
    await page.reload();
    await expect(
        page.locator(".fc-event").filter({hasText: editedTitle}),
    ).toHaveCount(0);
});

test("global calendar reveals published events and opens the precise published course without exposing private appointments or drafts", async ({
                                                                                                                                                   page,
                                                                                                                                               }) => {
    const owner = await actor("Global calendar reader", "lecturer");
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const suffix = randomUUID().slice(0, 8);
    const published = `Published calendar ${suffix}`;
    const draft = `Unpublished calendar ${suffix}`;
    const privateTitle = `Own private calendar ${suffix}`;
    const courseTitle = `Published calendar course ${suffix}`;
    const start = DateTime.now()
        .setZone("Europe/Berlin")
        .startOf("day")
        .plus({hours: 10});
    const interval = {
        starts_at: start.toUTC().toISO()!,
        ends_at: start.plus({hours: 1}).toUTC().toISO()!,
        time_zone: "Europe/Berlin",
    };
    await checked(
        service.from("global_events").insert([
            {title: published, published: true, ...interval},
            {title: draft, published: false, ...interval},
        ]),
    );
    await checked(
        service
            .from("personal_events")
            .insert({user_id: owner.id, title: privateTitle, ...interval}),
    );
    const template = randomUUID();
    const run = randomUUID();
    await checked(
        service.from("course_templates").insert({
            id: template,
            title: courseTitle,
            syllabus: "Fictional published course detail",
        }),
    );
    await checked(
        service.from("course_runs").insert({
            id: run,
            template_id: template,
            published: true,
            delivery_type: "online",
            time_zone: "Europe/Berlin",
        }),
    );
    await checked(
        service.from("course_sessions").insert({
            course_run_id: run,
            starts_at: interval.starts_at,
            ends_at: interval.ends_at,
        }),
    );
    const reader = await signedIn(owner);
    expect(
        await checked(
            reader
                .from("global_events")
                .select("title")
                .in("title", [published, draft]),
        ),
    ).toEqual([{title: published}]);
    await login(page, owner.email);
    await page.goto("/calendar");
    await expect(
        page.locator(".fc-event").filter({hasText: privateTitle}),
    ).toBeVisible();
    await expect(
        page.locator(".fc-event").filter({hasText: published}),
    ).toHaveCount(0);
    await page
        .getByRole("button", {name: "Globale Termine", exact: true})
        .click();
    await expect(
        page.locator(".fc-event").filter({hasText: published}),
    ).toBeVisible();
    await expect(
        page.locator(".fc-event").filter({hasText: draft}),
    ).toHaveCount(0);
    await expect(
        page.locator(".fc-event").filter({hasText: privateTitle}),
    ).toHaveCount(0);
    await page.locator(".fc-event").filter({hasText: courseTitle}).click();
    await expect(page).toHaveURL(new RegExp(`/courses\\?run=${run}`));
    const dialog = page.getByRole("dialog", {name: courseTitle, exact: true});
    await expect(dialog).toBeVisible();
    await expect(
        dialog.getByText("Fictional published course detail", {exact: true}),
    ).toBeVisible();
    await expect(dialog.locator(".session-list li")).toHaveCount(1);
});

test("browser history preserves a personal draft until explicitly discarded", async ({
                                                                                         page,
                                                                                     }) => {
    const owner = await actor("Fictional history calendar owner", "lecturer");
    await login(page, owner.email);
    // Use the portal's SPA navigation so React Router can block the real
    // browser-history transition while the event form contains a draft. On
    // narrow screens the route is inside the collapsed "Mehr" disclosure.
    const calendarLink = page.getByRole("link", {
        name: "Kalender",
        exact: true,
    });
    if (!(await calendarLink.isVisible())) {
        await page.getByText("Mehr", {exact: true}).click();
    }
    await calendarLink.click();
    await expect(page).toHaveURL(/\/calendar/);
    await page
        .getByRole("button", {name: "Privaten Termin hinzufügen"})
        .click();
    const form = page.getByRole("dialog", {name: "Privaten Termin hinzufügen"});
    await form.getByLabel("Titel").fill("Fictional history draft");
    await page.goBack();
    let confirm = page.getByRole("dialog", {
        name: "Ungespeicherte Änderungen verwerfen?",
    });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", {name: "Entwurf behalten"}).click();
    await expect(page).toHaveURL(/\/calendar/);
    await expect(form.getByLabel("Titel")).toHaveValue("Fictional history draft");
    await page.goBack();
    confirm = page.getByRole("dialog", {
        name: "Ungespeicherte Änderungen verwerfen?",
    });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", {name: "Änderungen verwerfen"}).click();
    await expect(page).toHaveURL(/\/$/);
});

test("calendar search and event type filter the current user's loaded events", async ({
                                                                                          page,
                                                                                      }) => {
    const owner = await actor("Fictional calendar search owner", "lecturer");
    const client = await signedIn(owner);
    const marker = randomUUID().slice(0, 8);
    const start = DateTime.now().startOf("day").plus({hours: 10});
    await checked(
        client.from("personal_events").insert([
            {
                user_id: owner.id,
                title: `Fictional alpha ${marker}`,
                starts_at: start.toUTC().toISO(),
                ends_at: start.plus({hours: 1}).toUTC().toISO(),
                time_zone: "UTC",
            },
            {
                user_id: owner.id,
                title: `Fictional beta ${marker}`,
                starts_at: start.plus({hours: 2}).toUTC().toISO(),
                ends_at: start.plus({hours: 3}).toUTC().toISO(),
                time_zone: "UTC",
            },
        ]),
    );
    await login(page, owner.email);
    await page.goto("/calendar");
    const alpha = page
        .locator(".fc-event")
        .filter({hasText: `Fictional alpha ${marker}`});
    const beta = page
        .locator(".fc-event")
        .filter({hasText: `Fictional beta ${marker}`});
    await expect(alpha).toBeVisible();
    await expect(beta).toBeVisible();
    await page.getByLabel("Kalendertermine suchen").fill(`ALPHA ${marker}`);
    await expect(alpha).toBeVisible();
    await expect(beta).toHaveCount(0);
    await page.getByLabel("Terminart").selectOption("assignment");
    await expect(alpha).toHaveCount(0);
    await page.getByLabel("Terminart").selectOption("private");
    await expect(alpha).toBeVisible();
    await page.getByLabel("Kalendertermine suchen").clear();
    await expect(beta).toBeVisible();
});