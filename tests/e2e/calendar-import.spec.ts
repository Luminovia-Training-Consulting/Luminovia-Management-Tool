import {expect, test} from "@playwright/test";
import {actor, api, checked, login} from "./helpers/accounts-support";

test("ICS preview and save include only appointments starting on the selected local dates", async ({page}) => {
    const owner = await actor("Fictional calendar import lecturer", "lecturer");
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const calendar = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:outside",
        "DTSTART:20420731T230000",
        "DTEND:20420801T010000",
        "SUMMARY:Fictional outside appointment",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:inside",
        "DTSTART:20420801T090000",
        "DTEND:20420801T100000",
        "SUMMARY:Fictional reviewed appointment",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:series",
        "DTSTART:20420801T110000",
        "DTEND:20420801T120000",
        "RRULE:FREQ=DAILY;COUNT=3",
        "SUMMARY:Fictional reviewed series",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:series",
        "RECURRENCE-ID:20420802T110000",
        "STATUS:CANCELLED",
        "END:VEVENT",
        "END:VCALENDAR",
    ].join("\r\n");
    try {
        await login(page, owner.email);
        await page.goto("/calendar");
        await page.getByText("Kalenderfunktionen", {exact: true}).click();
        await page.getByText("ICS-Datei importieren", {exact: true}).click();
        await page.getByLabel("Termine ab", {exact: true}).fill("2042-08-01");
        await page.getByLabel("Termine bis (einschließlich)", {exact: true}).fill("2042-08-02");
        await page.getByLabel("Kalenderdatei (.ics, bis 2 MB)", {exact: true}).setInputFiles({
            name: "review.ics",
            mimeType: "text/calendar",
            buffer: Buffer.from(calendar),
        });
        const preview = page.getByRole("region", {name: "Importvorschau", exact: true});
        await expect(preview.getByRole("listitem").locator("strong")).toHaveText([
            "Fictional reviewed appointment",
            "Fictional reviewed series",
        ]);
        await preview.getByRole("button", {name: "Termine importieren", exact: true}).click();
        await expect(page.getByText("2 Termine importiert, 0 bereits vorhanden.", {exact: true})).toBeVisible();
        const saved = await checked(
            service.from("personal_events").select("title").eq("user_id", owner.id).order("starts_at"),
            {requireData: true},
        );
        expect(saved.map(({title}) => title)).toEqual([
            "Fictional reviewed appointment",
            "Fictional reviewed series",
        ]);
    } finally {
        await checked(service.from("personal_events").delete().eq("user_id", owner.id));
        await checked(service.auth.admin.deleteUser(owner.id));
    }
});