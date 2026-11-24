import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { actor } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Import corrections run only with owned isolated fixtures.",
);

test("course draft import corrects a rejected row and does not duplicate the first draft", async ({
  page,
}) => {
  const admin = await actor("Fictional course import administrator", "admin");
  const endpoint = process.env.SUPABASE_URL!;
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(
    new URL(endpoint).hostname,
  );
  const service = createClient(
    endpoint,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const owner = {
    id: randomUUID(),
    name: `Fictional course import owner ${randomUUID().slice(0, 8)}`,
  };
  const another = {
    id: randomUUID(),
    name: `Fictional other import company ${randomUUID().slice(0, 8)}`,
  };
  expect(
    (await service.from("organisations").insert([owner, another])).error,
  ).toBeNull();
  const template = {
    id: randomUUID(),
    title: `Fictional imported course template ${randomUUID().slice(0, 8)}`,
    owner_organisation_id: owner.id,
  };
  expect(
    (await service.from("course_templates").insert(template)).error,
  ).toBeNull();
  const first = DateTime.utc().plus({ days: 40 }).toISODate();
  const second = DateTime.utc().plus({ days: 42 }).toISODate();
  const content = [
    "template_title,company_name,time_zone,delivery_type,venue,starts_at,ends_at",
    `${template.title},${owner.name},Europe/Berlin,onsite,Room A,${first}T09:00,${first}T11:00`,
    `${template.title},${another.name},Europe/Berlin,onsite,Room B,${second}T09:00,${second}T11:00`,
  ].join("\n");
  const stored = async () => {
    const response = await service
      .from("course_runs")
      .select("organisation_id,venue,published")
      .eq("template_id", template.id)
      .order("venue");
    expect(response.error).toBeNull();
    return response.data;
  };
  await page.goto("/login");
  await page.getByLabel("E-Mail", { exact: true }).fill(admin.email);
  await page
    .getByLabel("Passwort", { exact: true })
    .fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/courses");
  const importName = "Kursentwürfe mit einem Termin importieren";
  const importDialog = page.getByRole("dialog", { name: importName });
  await expect(importDialog).toBeHidden();
  await page.locator("summary").getByText("Kurswerkzeuge", { exact: true }).click();
  await page.getByRole("button", { name: importName }).click();
  await expect(importDialog).toBeVisible();
  await importDialog.getByLabel("CSV- oder XLSX-Datei").setInputFiles({
    name: "fictional-course-drafts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(content),
  });
  const rejection = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/rpc/import_table_row") &&
      response.status() === 400,
  );
  await page.getByRole("button", { name: "2 Einträge anlegen" }).click();
  expect(await (await rejection).json()).toMatchObject({ code: "22023" });
  await expect(
    page.getByText(/1 bestätigt.*Die Daten wurden abgelehnt/),
  ).toBeVisible();
  await expect(page.getByText("Gespeichert", { exact: true })).toHaveCount(1);
  expect(await stored()).toEqual([
    { organisation_id: owner.id, venue: "Room A", published: false },
  ]);
  await expect(
    page.getByText("Zeile 2 korrigieren", { exact: true }),
  ).toHaveCount(0);
  await page.getByText("Zeile 3 korrigieren", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "company_name", exact: true })
    .fill(owner.name);
  await page
    .getByRole("button", { name: "Offene Zeilen erneut versuchen" })
    .click();
  await expect(
    page.getByText("2 Einträge angelegt.", { exact: true }),
  ).toBeVisible();
  expect(await stored()).toEqual(
    ["Room A", "Room B"].map((venue) => ({
      organisation_id: owner.id,
      venue,
      published: false,
    })),
  );
});
