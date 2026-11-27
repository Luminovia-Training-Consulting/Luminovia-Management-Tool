import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { actor } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Course series acceptance uses isolated fixtures.",
);

test("course series reviews room collisions, creates exact drafts and resumes a saved pattern", async ({
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
  await page.getByText("Kurswerkzeuge", { exact: true }).click();
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
    .select(
      "id,published,venue,time_zone,course_sessions(id,starts_at,ends_at)",
    )
    .eq("template_id", templateId)
    .order("venue")
    .order("starts_at", { referencedTable: "course_sessions" });
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
  const [editedRun, otherDraft, protectedRun] = result.data!;
  const publish = await service
    .from("course_runs")
    .update({ published: true })
    .eq("id", protectedRun.id);
  expect(publish.error).toBeNull();
  const savedRuns = async () => {
    const response = await service
      .from("course_runs")
      .select(
        "id,published,venue,time_zone,course_sessions(id,starts_at,ends_at)",
      )
      .eq("template_id", templateId)
      .order("venue")
      .order("starts_at", { referencedTable: "course_sessions" });
    expect(response.error).toBeNull();
    return response.data;
  };
  const beforeEdit = [
    editedRun,
    otherDraft,
    { ...protectedRun, published: true },
  ];

  await dialog.getByRole("link", { name: "Durchlauf 1 öffnen" }).click();
  await expect(page).toHaveURL(new RegExp(`/courses\\?run=${editedRun.id}$`));
  const detail = page.getByRole("dialog", { name: template, exact: true });
  await expect(detail).toBeVisible();
  const openEditor = detail.getByText("Serienmuster bearbeiten", {
    exact: true,
  });
  await openEditor.focus();
  await openEditor.press("Enter");
  const editedPattern = detail.getByRole("group", {
    name: "Durchlauf 1",
    exact: true,
  });
  const selectEditedRun = editedPattern.getByRole("checkbox", {
    name: "Muster für Durchlauf 1 ändern",
  });
  await expect(
    detail.getByRole("checkbox", { name: "Muster für Durchlauf 2 ändern" }),
  ).not.toBeChecked();
  await expect(
    detail.getByRole("checkbox", { name: "Muster für Durchlauf 3 ändern" }),
  ).toBeDisabled();
  await selectEditedRun.check();
  const patternExclusions = editedPattern.getByLabel("Unterrichtsfreie Daten");
  await expect(
    editedPattern.getByLabel("Erster möglicher Unterrichtstag"),
  ).toHaveValue(firstDay.toISODate()!);
  await expect(patternExclusions).toHaveValue(omitted.toISODate()!);
  const changedExclusions = `${omitted.toISODate()}, ${firstDay.plus({ days: 2 }).toISODate()}`;
  await patternExclusions.fill(changedExclusions);
  await detail
    .getByRole("button", { name: "Termine und Konflikte prüfen" })
    .press("Enter");
  const review = detail.getByRole("region", {
    name: "Terminänderungen prüfen",
  });
  await expect(
    review.getByRole("heading", { name: "Terminänderungen prüfen" }),
  ).toBeFocused();
  const originalDates = review.getByRole("list", { name: "Aktuelle Termine" });
  const proposedDates = review.getByRole("list", {
    name: "Vorgeschlagene Termine",
  });
  await expect(originalDates.getByRole("listitem")).toHaveCount(2);
  await expect(proposedDates.getByRole("listitem")).toHaveCount(2);
  const newDay = DateTime.fromISO(firstDay.plus({ days: 3 }).toISODate()!, {
    zone: "Europe/Berlin",
  });
  const previewStart = proposedDates
    .getByRole("listitem")
    .nth(1)
    .locator("time")
    .first();
  expect(Date.parse((await previewStart.getAttribute("datetime"))!)).toBe(
    newDay.set({ hour: 9 }).toMillis(),
  );
  expect(await savedRuns()).toEqual(beforeEdit);
  await detail
    .getByRole("button", { name: "Serienänderungen speichern" })
    .press("Enter");
  await expect(
    detail.getByText("Das Serienmuster wurde gespeichert."),
  ).toBeVisible();
  await expect(
    detail
      .getByRole("region", { name: "Kurszeitleiste" })
      .getByText("Serienmuster geändert"),
  ).toBeVisible();

  const [changed, ...unchanged] = (await savedRuns())!;
  expect(unchanged).toEqual(beforeEdit.slice(1));
  expect(changed).toMatchObject({
    id: editedRun.id,
    venue: editedRun.venue,
    time_zone: "Europe/Berlin",
    published: false,
  });
  expect(changed.course_sessions).toHaveLength(2);
  expect(changed.course_sessions[0]).toEqual(editedRun.course_sessions[0]);
  expect(Date.parse(changed.course_sessions[1].starts_at)).toBe(
    newDay.set({ hour: 9 }).toMillis(),
  );
  expect(Date.parse(changed.course_sessions[1].ends_at)).toBe(
    newDay.set({ hour: 17 }).toMillis(),
  );

  await page.goto("/courses");
  await page.getByLabel("Sprache", { exact: true }).selectOption("en");
  await page.goto(`/courses?run=${editedRun.id}`);
  await expect(
    detail
      .getByRole("region", { name: "Course timeline" })
      .getByText("Series pattern changed"),
  ).toBeVisible();
  await detail.getByText("Edit series pattern", { exact: true }).click();
  await detail
    .getByRole("checkbox", { name: "Change pattern for run 1" })
    .check();
  await expect(detail.getByLabel("Excluded dates")).toHaveValue(
    changedExclusions,
  );
});
