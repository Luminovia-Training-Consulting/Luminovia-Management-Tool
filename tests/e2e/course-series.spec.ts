import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { actor } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Course series acceptance uses isolated fixtures.",
);

test("course series reviews room collisions and creates independent exact drafts", async ({
  page,
}) => {
  const admin = await actor("Fictional series planner", "admin");
  const api = process.env.SUPABASE_URL!;
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(api).hostname);
  const service = createClient(api, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const companyId = randomUUID();
  const templateId = randomUUID();
  const company = `Fictional series company ${companyId.slice(0, 8)}`;
  const template = `Fictional series course ${templateId.slice(0, 8)}`;
  const orgWrite = await service
    .from("organisations")
    .insert({ id: companyId, name: company });
  expect(orgWrite.error).toBeNull();
  const templateWrite = await service.from("course_templates").insert({
    id: templateId,
    owner_organisation_id: companyId,
    title: template,
  });
  expect(templateWrite.error).toBeNull();

  await page.goto("/login");
  await page.getByLabel("E-Mail", { exact: true }).fill(admin.email);
  await page
    .getByLabel("Passwort", { exact: true })
    .fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/courses");
  await page
    .getByRole("button", { name: "Kursserie planen", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Kursserie planen" });
  await dialog
    .getByLabel("Unternehmen", { exact: true })
    .selectOption(companyId);
  await dialog
    .getByLabel("Kursvorlage", { exact: true })
    .selectOption(templateId);
  await dialog.getByLabel("Zeitzone der Termine").selectOption("Europe/Berlin");
  await dialog.getByLabel("Unterrichtstage je Durchlauf").fill("2");
  const firstMonday = (month: DateTime) =>
    month
      .startOf("month")
      .plus({ days: (8 - month.startOf("month").weekday) % 7 });
  const month = DateTime.utc().plus({ months: 2 });
  const firstDay = firstMonday(month);
  const repeatDay = firstMonday(month.plus({ months: 1 }));
  const omitted = firstDay.plus({ days: 1 });
  await dialog.getByLabel("Unterrichtsfreie Daten").fill(omitted.toISODate()!);
  const first = dialog.getByRole("group", { name: "Durchlauf 1", exact: true });
  const second = dialog.getByRole("group", {
    name: "Durchlauf 2",
    exact: true,
  });
  for (const run of [first, second]) {
    await run
      .getByLabel("Erster möglicher Unterrichtstag")
      .fill(firstDay.toISODate()!);
    await run.getByLabel("Durchführungsart").selectOption("onsite");
    await run.getByLabel("Raum oder Ort").fill("Room A");
  }
  await dialog
    .getByRole("button", { name: "Termine und Konflikte prüfen" })
    .click();
  await expect(
    dialog.getByText("Dieser Raum ist zur selben Zeit bereits eingeplant."),
  ).toHaveCount(4);
  await expect(
    dialog.getByRole("button", { name: "Alle Durchläufe als Entwurf anlegen" }),
  ).toHaveCount(0);
  const initial = await service
    .from("course_runs")
    .select("id")
    .eq("template_id", templateId);
  expect(initial.data).toEqual([]);

  await second.getByLabel("Raum oder Ort").fill("Room B");
  const repeat = dialog.getByRole("group", { name: "Starttage wiederholen" });
  await repeat
    .getByLabel("Wiederholung", { exact: true })
    .selectOption("monthly");
  await repeat.getByLabel("Muster im Monat").selectOption("weekday");
  await repeat.getByLabel("Anzahl der Termine").fill("2");
  await repeat.getByRole("button", { name: "Wiederholungen ergänzen" }).click();
  const third = dialog.getByRole("group", { name: "Durchlauf 3", exact: true });
  await expect(third.getByLabel("Erster möglicher Unterrichtstag")).toHaveValue(
    repeatDay.toISODate()!,
  );
  await third.getByLabel("Durchführungsart").selectOption("onsite");
  await third.getByLabel("Raum oder Ort").fill("Room C");
  await dialog
    .getByRole("button", { name: "Termine und Konflikte prüfen" })
    .click();
  const workload = dialog.getByRole("region", { name: "Lehrbedarf" });
  await expect(workload).toBeVisible();
  await expect(workload.locator("dd")).toHaveText(["6", "48 Std.", "2", "3"]);
  await dialog
    .getByRole("button", { name: "Alle Durchläufe als Entwurf anlegen" })
    .click();
  await expect(
    dialog.getByText("Die Durchläufe wurden als Entwürfe angelegt."),
  ).toBeVisible();
  const result = await service
    .from("course_runs")
    .select("id,published,venue,course_sessions(starts_at)")
    .eq("template_id", templateId)
    .order("venue");
  expect(result.error).toBeNull();
  expect(
    result.data?.map((run) => ({
      venue: run.venue,
      published: run.published,
      sessions: run.course_sessions
        .map((slot) =>
          DateTime.fromISO(slot.starts_at, {
            zone: "Europe/Berlin",
          }).toISODate(),
        )
        .sort(),
    })),
  ).toEqual([
    ...["Room A", "Room B"].map((venue) => ({
      venue,
      published: false,
      sessions: [firstDay.toISODate(), firstDay.plus({ days: 2 }).toISODate()],
    })),
    {
      venue: "Room C",
      published: false,
      sessions: [
        repeatDay.toISODate(),
        repeatDay.plus({ days: 1 }).toISODate(),
      ],
    },
  ]);
  await dialog.getByRole("link", { name: "Durchlauf 1 öffnen" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/courses\\?run=${result.data?.[0].id}$`),
  );
  await expect(
    page.getByRole("dialog", { name: template, exact: true }),
  ).toBeVisible();
});
