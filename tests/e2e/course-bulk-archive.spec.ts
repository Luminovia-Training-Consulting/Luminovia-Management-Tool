import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { actor } from "./helpers/accounts-support";

test("course managers can review, archive and recover multiple courses", async ({
  page,
}) => {
  const manager = await actor("Fictional bulk course manager", "admin");
  const api = process.env.SUPABASE_URL!;
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(api).hostname);
  const service = createClient(api, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const organisation = randomUUID();
  const marker = `Bulk courses ${organisation.slice(0, 8)}`;
  const courses = ["First", "Second"].map((name) => ({
    id: randomUUID(),
    template: randomUUID(),
    title: `${marker} ${name}`,
  }));
  expect(
    (
      await service
        .from("organisations")
        .insert({ id: organisation, name: marker })
    ).error,
  ).toBeNull();
  expect(
    (
      await service
        .from("course_templates")
        .insert(courses.map(({ template, title }) => ({ id: template, title })))
    ).error,
  ).toBeNull();
  expect(
    (
      await service.from("course_runs").insert(
        courses.map(({ id, template }) => ({
          id,
          template_id: template,
          organisation_id: organisation,
          time_zone: "Europe/Berlin",
        })),
      )
    ).error,
  ).toBeNull();

  const states = async () => {
    const response = await service
      .from("course_runs")
      .select("id,published,archived_at,time_zone")
      .in(
        "id",
        courses.map(({ id }) => id),
      )
      .order("id");
    expect(response.error).toBeNull();
    return response.data!;
  };
  const before = await states();

  await page.goto("/login");
  await page.getByLabel("E-Mail", { exact: true }).fill(manager.email);
  await page
    .getByLabel("Passwort", { exact: true })
    .fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/courses");
  await page.getByRole("searchbox", { name: "Suchen" }).fill(marker);
  const choose = async () => {
    for (const { title } of courses) {
      const checkbox = page.getByRole("checkbox", {
        name: `${title} (${marker}) auswählen`,
        exact: true,
      });
      await checkbox.focus();
      await checkbox.press("Space");
      await expect(checkbox).toBeChecked();
    }
  };
  await choose();
  const reviewArchive = page.getByRole("button", {
    name: "Archivierung prüfen",
    exact: true,
  });
  await reviewArchive.focus();
  await reviewArchive.press("Enter");
  const archivePreview = page.getByRole("dialog", {
    name: "Archivierung prüfen",
  });
  for (const { title } of courses)
    await expect(archivePreview.getByRole("list")).toContainText(title);
  expect(await states()).toEqual(before);
  await archivePreview
    .getByRole("button", { name: "Änderung bestätigen" })
    .click();
  await expect(archivePreview).toBeHidden();
  await expect(
    page.getByText("Archivstatus gespeichert.", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await states()).every(({ archived_at }) => archived_at))
    .toBe(true);

  await choose();
  await page
    .getByRole("button", { name: "Wiederherstellung prüfen", exact: true })
    .click();
  const restorePreview = page.getByRole("dialog", {
    name: "Wiederherstellung prüfen",
  });
  for (const { title } of courses)
    await expect(restorePreview.getByRole("list")).toContainText(title);
  await restorePreview
    .getByRole("button", { name: "Änderung bestätigen" })
    .click();
  await expect(restorePreview).toBeHidden();
  await expect.poll(states).toEqual(before);
});
