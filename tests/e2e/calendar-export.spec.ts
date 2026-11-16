import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import { actor, api, checked, login } from "./helpers/accounts-support";

test("calendar ICS is a fresh authorized download, private events require opt-in and offline export is disabled", async ({
  page,
  context,
}) => {
  const owner = await actor("Fictional calendar export lecturer", "lecturer");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const start = DateTime.now()
    .setZone("Europe/Berlin")
    .startOf("month")
    .plus({ days: 2, hours: 9 });
  const id = randomUUID();
  await checked(
    service
      .from("personal_events")
      .insert({
        id,
        user_id: owner.id,
        title: "Fictional original calendar title",
        starts_at: start.toUTC().toISO()!,
        ends_at: start.plus({ hours: 1 }).toUTC().toISO()!,
        time_zone: "Europe/Berlin",
      }),
  );
  try {
    await login(page, owner.email);
    await page.goto("/calendar");
    await page.getByText("Kalenderdatei exportieren", { exact: true }).click();
    const privateEvents = page.getByRole("checkbox", {
      name: "Eigene private Kalendereinträge einschließen",
      exact: true,
    });
    await expect(privateEvents).not.toBeChecked();
    await page
      .getByLabel("Exportmonat", { exact: true })
      .fill(start.toFormat("yyyy-MM"));
    let downloadEvent = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "ICS-Datei herunterladen", exact: true })
      .click();
    let download = await downloadEvent;
    let content = await readFile((await download.path())!, "utf8");
    expect(content).toContain("BEGIN:VCALENDAR\r\n");
    expect(content).not.toContain("BEGIN:VEVENT");
    expect(download.suggestedFilename()).toBe(
      `luminovia-${start.toFormat("yyyy-MM")}.ics`,
    );
    // Change after the calendar page loaded: export must read live server data.
    await checked(
      service
        .from("personal_events")
        .update({ title: "Fictional fresh calendar title" })
        .eq("id", id),
    );
    await privateEvents.check();
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    downloadEvent = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download ICS file", exact: true })
      .click();
    download = await downloadEvent;
    content = await readFile((await download.path())!, "utf8");
    expect(content).toContain("SUMMARY:Fictional fresh calendar title\r\n");
    expect(content).not.toContain("original calendar title");
    expect(content).toContain(`UID:private.${id}@luminovia.org`);
    expect(content).toContain("X-LUMINOVIA-TIME-ZONE:Europe/Berlin");
    await context.setOffline(true);
    await expect(
      page.getByRole("button", { name: "Download ICS file", exact: true }),
    ).toBeDisabled();
    await context.setOffline(false);
  } finally {
    await checked(service.auth.admin.deleteUser(owner.id));
  }
});
