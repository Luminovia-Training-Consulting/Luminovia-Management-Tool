import { expect, test, type Page } from "@playwright/test";
import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import { actor, api, checked, code, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Calendar lifecycle runs only in the isolated ./portal test project.",
);

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

async function eventDialog(page: Page, title: string) {
  await page.locator(".fc-event").filter({ hasText: title }).click();
  const dialog = page.getByRole("dialog", {
    name: "Privater Termin",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("calendar rejects invalid DST intervals, persists create/edit/delete and preserves privacy against lecturers and an MFA administrator", async ({
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
      .update({ time_zone: "Australia/Brisbane" })
      .eq("id", owner.id),
  );
  await login(page, owner.email);
  await page.goto("/calendar");
  await expect(page.locator(".calendar-controls .badge")).toHaveText(
    "Australia/Brisbane",
  );
  await page
    .getByRole("button", { name: "Privaten Termin hinzufügen", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Privaten Termin hinzufügen",
    exact: true,
  });
  const title = `Private calendar ${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel("Titel", { exact: true }).fill(title);
  await dialog.getByLabel("Zeitzone", { exact: true }).fill("Europe/Berlin");
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
    await dialog.getByLabel("Beginn", { exact: true }).fill(start);
    await dialog.getByLabel("Ende", { exact: true }).fill(end);
    await dialog
      .getByRole("button", { name: "Termin speichern", exact: true })
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
    .plus({ hours: 10 });
  const local = (value: DateTime) => value.toFormat("yyyy-MM-dd'T'HH:mm");
  await dialog
    .getByLabel("Zeitzone", { exact: true })
    .fill("Australia/Brisbane");
  await dialog.getByLabel("Beginn", { exact: true }).fill(local(start));
  await dialog
    .getByLabel("Ende", { exact: true })
    .fill(local(start.plus({ hours: 1 })));
  await dialog
    .getByRole("button", { name: "Termin speichern", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status")).toHaveText("Termin gespeichert.");
  const original = (await checked(
    service
      .from("personal_events")
      .select("id,title,starts_at,ends_at,time_zone")
      .eq("user_id", owner.id)
      .single(),
  ))!;
  expect(original.title).toBe(title);
  expect(new Date(original.starts_at).toISOString()).toBe(
    start.toUTC().toISO(),
  );
  expect(new Date(original.ends_at).toISOString()).toBe(
    start.plus({ hours: 1 }).toUTC().toISO(),
  );
  expect(original.time_zone).toBe("Australia/Brisbane");
  expect(writes).toBe(1);
  await page.reload();
  dialog = await eventDialog(page, title);
  await expect(dialog.getByLabel("Beginn", { exact: true })).toHaveValue(
    local(start),
  );
  const editedTitle = `${title} revised`;
  const editedStart = start.plus({ hours: 2 });
  await dialog.getByLabel("Titel", { exact: true }).fill(editedTitle);
  await dialog.getByLabel("Beginn", { exact: true }).fill(local(editedStart));
  await dialog
    .getByLabel("Ende", { exact: true })
    .fill(local(editedStart.plus({ hours: 1 })));
  await context.setOffline(true);
  await expect(
    dialog.getByRole("button", { name: "Termin speichern", exact: true }),
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
    .getByRole("button", { name: "Termin speichern", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await page.reload();
  dialog = await eventDialog(page, editedTitle);
  await expect(dialog.getByLabel("Beginn", { exact: true })).toHaveValue(
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
  const factor = await checked(
    manager.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Calendar privacy QA",
    }),
  );
  await checked(
    manager.auth.mfa.challengeAndVerify({
      factorId: factor!.id,
      code: code(factor!.totp.secret),
    }),
  );
  expect(
    (await manager.auth.mfa.getAuthenticatorAssuranceLevel()).data
      ?.currentLevel,
  ).toBe("aal2");
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
          .update({ title: "Forged private edit" })
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
    .getByRole("button", { name: "Privaten Termin löschen", exact: true })
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
    page.locator(".fc-event").filter({ hasText: editedTitle }),
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
    .plus({ hours: 10 });
  const interval = {
    starts_at: start.toUTC().toISO()!,
    ends_at: start.plus({ hours: 1 }).toUTC().toISO()!,
    time_zone: "Europe/Berlin",
  };
  await checked(
    service.from("global_events").insert([
      { title: published, published: true, ...interval },
      { title: draft, published: false, ...interval },
    ]),
  );
  await checked(
    service
      .from("personal_events")
      .insert({ user_id: owner.id, title: privateTitle, ...interval }),
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
  ).toEqual([{ title: published }]);
  await login(page, owner.email);
  await page.goto("/calendar");
  await expect(
    page.locator(".fc-event").filter({ hasText: privateTitle }),
  ).toBeVisible();
  await expect(
    page.locator(".fc-event").filter({ hasText: published }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Globale Termine", exact: true })
    .click();
  await expect(
    page.locator(".fc-event").filter({ hasText: published }),
  ).toBeVisible();
  await expect(
    page.locator(".fc-event").filter({ hasText: draft }),
  ).toHaveCount(0);
  await expect(
    page.locator(".fc-event").filter({ hasText: privateTitle }),
  ).toHaveCount(0);
  await page.locator(".fc-event").filter({ hasText: courseTitle }).click();
  await expect(page).toHaveURL(new RegExp(`/courses\\?run=${run}`));
  const dialog = page.getByRole("dialog", { name: courseTitle, exact: true });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Fictional published course detail", { exact: true }),
  ).toBeVisible();
  await expect(dialog.locator(".session-list li")).toHaveCount(1);
});
