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
    await login(page, owner.email);
    await page.goto("/profile");
    const zoneSelect = page.getByRole("combobox", { name: "Zeitzone", exact: true });
    const profileZone = "Australia/Adelaide";
    const commonZones = zoneSelect.locator('optgroup[label="Häufige Zeitzonen"]');
    await expect(commonZones.locator(`option[value="${profileZone}"]`)).toHaveCount(1);
    await zoneSelect.selectOption(profileZone);
    // Other profile panels can announce loading while this form confirms the save.
    const profileForm = page.locator("form").filter({ has: zoneSelect });
    await profileForm.getByRole("button", { name: "Profil speichern", exact: true }).click();
    await expect(profileForm.getByRole("status")).toContainText(/gespeichert/i);
    await page.reload();
    await expect(zoneSelect).toHaveValue(profileZone);
    await page.goto("/calendar");
    const displayZone = page.getByLabel("Kalenderanzeige in", {exact: true});
    await expect(displayZone.locator("option:checked")).toHaveText(
        `Profilzeitzone (${profileZone})`,
    );
    await page
        .getByRole("button", {name: "Privaten Termin hinzufügen", exact: true})
        .click();
    let dialog = page.getByRole("dialog", {
        name: "Privaten Termin hinzufügen",
        exact: true,
    });
    await expect(dialog.getByLabel("Zeitzone", {exact: true})).toHaveValue(profileZone);
    const title = `Private calendar ${randomUUID().slice(0, 8)}`;
    await dialog.getByLabel("Titel", {exact: true}).fill(title);
    await dialog
        .getByLabel("Beschreibung oder Notiz", {exact: true})
        .fill("Fictional private preparation note");
    await dialog.getByLabel("Zeitzone", {exact: true}).selectOption("Europe/Berlin");
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
        .selectOption("Australia/Brisbane");
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
    const calendarEvent = page.locator(".fc-event").filter({hasText: title});
    const eventTime = calendarEvent.locator(".fc-event-time, .fc-list-event-time");
    // The month grid shows the start. The mobile list shows the full interval.
    const profileStart = start.setZone(profileZone);
    const shownStart = profileStart.toFormat("H:mm");
    const shownEnd = profileStart.plus({ hours: 1 }).toFormat("H:mm");
    const profileTime = new RegExp(`^${shownStart}(?:\\s*[-–]\\s*${shownEnd})?$`);
    await expect(eventTime).toHaveText(profileTime);
    await displayZone.selectOption("UTC");
    await expect(eventTime).toHaveText(/^0{1,2}(?::00| Uhr)(?:\s*[-–]\s*0?1:00)?$/);
    expect(writes, "Changing the display zone must not edit the event").toBe(1);
    await displayZone.selectOption("");
    await expect(eventTime).toHaveText(profileTime);
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
    const owner = await actor("Global calendar course manager", "management");
    const prospect = await actor("Global calendar prospective lecturer", "lecturer");
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
    await checked(service.from("audit_events").insert({
        actor_id: owner.id,
        resource_id: run,
        action: "course.class.changed",
        details: {private_note: "Fictional confidential audit note"},
    }));
    const unaffiliated = await signedIn(prospect);
    expect(await checked(
        unaffiliated.from("course_runs").select("id").eq("id", run),
    )).toEqual([]);
    expect(
        await checked(
            unaffiliated
                .from("global_events")
                .select("title")
                .in("title", [published, draft]),
        ),
    ).toEqual([{title: published}]);
    await login(page, owner.email);
    await page.goto("/calendar");
    await page.locator(".calendar-panel").getByRole("button", {name: "Termine", exact: true}).click();
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
    const timeline = dialog.getByRole("region", {name: "Kurszeitleiste"});
    await expect(timeline.getByText("Kurs angelegt", {exact: true})).toBeVisible();
    await expect(timeline.getByText("Klasse zugeordnet oder geändert", {exact: true})).toBeVisible();
    await expect(timeline.getByText("Fictional confidential audit note")).toHaveCount(0);
    await expect(timeline.getByRole("listitem")).toHaveCount(3);
    const session = timeline.getByRole("listitem").filter({
        hasNotText: /Kurs angelegt|Klasse zugeordnet oder geändert/,
    });
    await expect(session).toHaveCount(1);
    expect(new Date((await session.locator("time").getAttribute("datetime"))!).toISOString()).toBe(interval.ends_at);
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
    }).filter({visible: true});
    if ((page.viewportSize()?.width ?? 1440) <= 760) {
        await page.locator("details.mobile-more > summary").click();
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

test("calendar navigation and long agenda titles stay usable on narrow phones and tablets", async ({
    page,
}) => {
    const owner = await actor("Fictional responsive calendar lecturer", "lecturer");
    const client = await signedIn(owner);
    const start = DateTime.utc().startOf("day").plus({hours: 11});
    const title = "Fortbildungskoordinationundprüfungsvorbereitungsworkshopabschlussdokumentation";
    await checked(
        client.from("personal_events").insert({
            user_id: owner.id,
            title,
            starts_at: start.toISO(),
            ends_at: start.plus({hours: 3}).toISO(),
            time_zone: "UTC",
        }),
    );
    await page.setViewportSize({width: 768, height: 900});
    await login(page, owner.email);
    await page.goto("/calendar");
    const views = page.getByRole("group", {name: "Kalenderansicht", exact: true});
    const dates = page.getByRole("group", {name: "Zeitraum wechseln", exact: true});
    await views.getByRole("button", {name: "Termine", exact: true}).click();
    const event = page.getByRole("button", {name: title, exact: true});
    await expect(event).toBeVisible();
    for (const width of [768, 320]) {
        await page.setViewportSize({width, height: 900});
        const nav = await dates.boundingBox();
        const tabs = await views.boundingBox();
        expect(nav && tabs && (
            nav.y + nav.height <= tabs.y + 1 ||
            nav.x + nav.width <= tabs.x + 1
        ), `Calendar controls fit at ${width}px`).toBe(true);
        const next = dates.getByRole("button", {name: "Nächster Zeitraum"});
        // Give the stacked toolbar room above the viewport edge instead of
        // relying on a minimal scroll, which can leave a fractional clip.
        await next.evaluate((button) => button.scrollIntoView({block: "center", behavior: "instant"}));
        await expect(next).toBeInViewport({ratio: 1});
        const button = await next.boundingBox();
        expect(button && button.x >= 0 && button.x + button.width <= width).toBe(true);
        expect(await event.evaluate((element) => {
            const agenda = element.closest(".fc-list")!;
            const table = element.closest("table")!;
            return table.getBoundingClientRect().width <= agenda.clientWidth + 1;
        }), `Agenda title stays inside the agenda at ${width}px`).toBe(true);
    }
    await event.press("Enter");
    const appointment = page.getByRole("dialog", {name: "Privater Termin", exact: true});
    await expect(appointment).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(appointment).toBeHidden();

    await views.getByRole("button", {name: "Woche", exact: true}).click();
    const week = page.getByRole("region", {name: "Kalenderwoche", exact: true});
    await expect(week).toHaveAccessibleDescription(
        "Seitlich scrollen, um alle Wochentage zu sehen.",
    );
    await expect(week).toHaveAttribute("tabindex", "0");
    expect(await week.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await week.press("ArrowRight");
    await expect.poll(() => week.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
});

test("selects an appointment directly on the calendar using mouse or touch and writes only on confirmation", async ({page, context}, testInfo) => {
    const touch = testInfo.project.use.hasTouch === true;
    const owner = await actor("Private calendar range owner", "lecturer");
    const client = await signedIn(owner);
    await login(page, owner.email);
    await page.goto("/calendar");
    await page.getByLabel("Kalenderanzeige in", {exact: true}).selectOption("Australia/Brisbane");

    const panel = page.locator(".calendar-panel");
    await panel.getByRole("button", {name: "Monat", exact: true}).click();
    await panel.getByRole("button", {name: "Heute", exact: true}).click();
    const first = DateTime.now().setZone("Australia/Brisbane").startOf("month").plus({days: 7});
    const last = first.plus({days: 2});
    const end = last.plus({days: 1});
    const day = (date: DateTime) => panel.locator(`[data-date="${date.toISODate()}"] .fc-daygrid-day-frame`);
    // The three-day range can cross a week boundary. Place the lower cell first
    // so raw desktop pointer coordinates do not fall below the viewport.
    await day(last).scrollIntoViewIfNeeded();
    await day(first).scrollIntoViewIfNeeded();
    const center = async (date: DateTime) => {
        const box = await day(date).boundingBox();
        if (!box) throw Error("Expected visible calendar day.");
        const point = {x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2)};
        expect(point.y).toBeGreaterThan(0);
        expect(point.y).toBeLessThan(await page.evaluate(() => window.innerHeight));
        return point;
    };
    const dialog = page.getByRole("dialog", {name: "Privaten Termin hinzufügen", exact: true});
    const startPoint = await center(first);
    if (touch) {
        await page.touchscreen.tap(startPoint.x, startPoint.y);
        await expect(dialog.getByLabel("Beginn", {exact: true})).toHaveValue(first.toISODate() + "T09:00");
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
    }

    const from = await center(first);
    const to = await center(last);
    const selection = panel.locator(".fc-highlight").first();
    if (touch) {
        const pointer = await context.newCDPSession(page);
        try {
            await pointer.send("Input.dispatchTouchEvent", {type: "touchStart", touchPoints: [from]});
            // The gesture must outlast FullCalendar's short touch hold.
            await page.waitForTimeout(450);
            await pointer.send("Input.dispatchTouchEvent", {type: "touchMove", touchPoints: [to]});
            await expect(selection).toBeVisible();
            await pointer.send("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []});
        } finally {
            await pointer.detach();
        }
    } else {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, {steps: 10});
        await expect(selection).toBeVisible();
        await page.mouse.up();
    }

    await expect(dialog.getByLabel("Beginn", {exact: true})).toHaveValue(first.toISODate() + "T00:00");
    await expect(dialog.getByLabel("Ende", {exact: true})).toHaveValue(end.toISODate() + "T00:00");
    await expect(dialog.getByLabel("Zeitzone", {exact: true})).toHaveValue("Australia/Brisbane");
    expect(await checked(client.from("personal_events").select("id"))).toEqual([]);
    const title = `Fictional range ${randomUUID().slice(0, 8)}`;
    await dialog.getByLabel("Titel", {exact: true}).fill(title);
    await dialog.getByRole("button", {name: "Termin speichern", exact: true}).click();
    await expect(dialog).toBeHidden();
    await expect(selection).toBeHidden();
    const saved = (await checked(
        client.from("personal_events").select("starts_at,ends_at,time_zone").eq("title", title).single(),
    ))!;
    expect(new Date(saved.starts_at).toISOString()).toBe(first.toUTC().toISO());
    expect(new Date(saved.ends_at).toISOString()).toBe(end.toUTC().toISO());
    expect(saved.time_zone).toBe("Australia/Brisbane");
});

test("private calendar loads current and overlapping appointments even with more than one thousand older entries", async ({page}) => {
    const owner = await actor("Fictional private calendar range owner", "lecturer");
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const client = await signedIn(owner);
    const marker = randomUUID().slice(0, 8);
    const row = (title: string, startsAt: DateTime, endsAt: DateTime) => ({
        id: randomUUID(),
        user_id: owner.id,
        title,
        starts_at: startsAt.toUTC().toISO(),
        ends_at: endsAt.toUTC().toISO(),
        time_zone: "Europe/Berlin",
    });
    const today = DateTime.now().setZone("Europe/Berlin").startOf("day");
    const historical = Array.from({length: 1001}, (_, index) => {
        const day = DateTime.utc(1990).plus({days: index});
        return row(`Fictional calendar history ${marker} ${index}`, day, day.plus({hours: 1}));
    });
    const current = row(`Fictional current appointment ${marker}`, today.plus({hours: 12}), today.plus({hours: 13}));
    const overlap = row(`Fictional overlapping appointment ${marker}`, today.minus({days: 70}), today.plus({hours: 2}));
    const future = row(`Fictional distant appointment ${marker}`, today.plus({days: 180}), today.plus({days: 180, hours: 1}));
    try {
        await checked(service.from("personal_events").insert([...historical, current, overlap, future]));
        const legacy = await checked(
            client.from("personal_events").select("id").eq("user_id", owner.id).order("starts_at"),
            {requireData: true},
        );
        expect(legacy).toHaveLength(1000);
        expect(legacy.some((event) => event.id === current.id)).toBe(false);
        await login(page, owner.email);
        const bounded = page.waitForResponse((response) => {
            const url = new URL(response.url());
            return url.pathname.endsWith("/rest/v1/personal_events") &&
                (url.searchParams.get("starts_at") ?? "").startsWith("lt.") &&
                (url.searchParams.get("ends_at") ?? "").startsWith("gt.");
        });
        await page.goto("/calendar");
        const response = await bounded;
        expect(response.ok()).toBe(true);
        const rows: {id: string}[] = await response.json();
        expect(rows.map((event) => event.id).sort()).toEqual([current.id, overlap.id].sort());
        await expect(page.locator(".fc-event").filter({hasText: current.title})).toBeVisible();
        await expect(page.locator(".fc-event").filter({hasText: overlap.title}).first()).toBeVisible();
    } finally {
        await checked(service.from("personal_events").delete().eq("user_id", owner.id));
        await checked(service.auth.admin.deleteUser(owner.id));
    }
});
