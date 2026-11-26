/** Check reviewed CSV and XLSX grades through the real portal and release API. */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { enablePremiumAndLinkParticipant } from "../../scripts/testing/company-participant.mjs";
import {
  TextReader,
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { actor, api, checked, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Grade import requires isolated Auth and REST fixtures.",
);

test("reviewed CSV and XLSX changes stay private until the examiner publishes", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const [manager, company, learner] = await Promise.all([
    actor("Fictional grade manager", "admin"),
    actor("Fictional organisation contact", "client"),
    actor("Fictional exam learner", "participant"),
  ]);
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const signIn = async (email: string) => {
    const client = api(process.env.SUPABASE_ANON_KEY!);
    await checked(
      client.auth.signInWithPassword({
        email,
        password: process.env.E2E_PASSWORD!,
      }),
    );
    return client;
  };
  const [managerClient, companyClient, learnerClient] = await Promise.all([
    signIn(manager.email),
    signIn(company.email),
    signIn(learner.email),
  ]);
  const [organisation, template, run] = Array.from({ length: 3 }, randomUUID);
  const now = Date.now();
  const at = (minutes: number) =>
    new Date(now + minutes * 60_000).toISOString();
  const suffix = run.slice(0, 8);
  await checked(
    service
      .from("organisations")
      .insert({ id: organisation, name: `Fictional grade cohort ${suffix}` }),
  );
  await checked(
    service
      .from("client_organisation_memberships")
      .insert({ organisation_id: organisation, user_id: company.id }),
  );
  await checked(
    service
      .from("course_templates")
      .insert({ id: template, title: `Fictional grade import ${suffix}` }),
  );
  await checked(
    service.from("course_runs").insert({
      id: run,
      template_id: template,
      organisation_id: organisation,
      published: true,
    }),
  );
  await checked(
    service
      .from("course_sessions")
      .insert({ course_run_id: run, starts_at: at(-120), ends_at: at(120) }),
  );
  await enablePremiumAndLinkParticipant({
    admin: { ...manager, client: managerClient },
    company: { ...company, client: companyClient },
    learner: { ...learner, client: learnerClient },
    organisation,
    service,
    checked,
  });
  await checked(
    managerClient.rpc("manage_course_enrolment", {
      p_course_run_id: run,
      p_user_id: learner.id,
      p_status: "enrolled",
    }),
  );
  await checked(
    managerClient.rpc("save_course_exam_schedule", {
      p_run_id: run,
      p_title: `Fictional completed exam ${suffix}`,
      p_visible_from: at(-60),
      p_starts_at: at(-45),
      p_ends_at: at(-15),
      p_pass_percent: 60,
      p_version: 0,
    }),
  );
  const state = () =>
    checked(managerClient.rpc("course_exam_state", { p_run_id: run }), {
      requireData: true,
    });
  const results = () =>
    checked(learnerClient.rpc("published_course_exam_results"), {
      requireData: true,
    });
  await login(page, manager.email);
  await page.goto(`/courses/${run}/workspace#course-evaluations`);
  const importButton = page.getByRole("button", {
    name: "Prüfungsnoten importieren",
  });
  await expect(importButton).toBeVisible();
  await importButton.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Prüfungsnoten importieren",
  });
  const capture = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "CSV-Vorlage herunterladen" })
    .click();
  const csv = await capture;
  const path = await csv.path();
  const original = await readFile(path, "utf8");
  expect(original).toContain(learner.id);
  expect(original).toMatch(/,""$/);
  const input = dialog.getByLabel("Notentabelle auswählen");
  await input.setInputFiles({
    name: "reviewed-grades.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(original.replace(/,""$/, ',"82"')),
  });
  await expect(dialog.getByText("Offen → 82 %")).toBeVisible();
  expect((await state()).rows[0].score).toBeNull();
  await dialog
    .getByRole("button", { name: "1 Note als Entwurf speichern" })
    .press("Enter");
  await expect(
    dialog.getByText("1 Note wurde als Entwurf gespeichert."),
  ).toBeVisible();
  expect((await results()).results).toHaveLength(0);

  const excelDownload = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Excel-Vorlage herunterladen" })
    .click();
  const templateBytes = await readFile(await (await excelDownload).path());
  const sourceZip = new ZipReader(new Uint8ArrayReader(templateBytes));
  const authoredZip = new ZipWriter(new Uint8ArrayWriter());
  try {
    for (const entry of await sourceZip.getEntries()) {
      if (entry.directory) continue;
      const xml = await entry.getData(new TextWriter());
      if (entry.filename === "xl/worksheets/sheet1.xml") {
        expect(xml).toContain(learner.id);
        const blankScore = /<c r="E2"[^>]*>[\s\S]*?<\/c>/;
        expect(xml).toMatch(blankScore);
        await authoredZip.add(
          entry.filename,
          new TextReader(xml.replace(blankScore, '<c r="E2"><v>91</v></c>')),
        );
      } else {
        await authoredZip.add(entry.filename, new TextReader(xml));
      }
    }
  } finally {
    await sourceZip.close();
  }
  await input.setInputFiles({
    name: "reviewed-grades.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await authoredZip.close()),
  });
  await expect(dialog.getByText("82 % → 91 %")).toBeVisible();
  const confirm = dialog.getByRole("button", {
    name: "1 Note als Entwurf speichern",
  });
  await expect(confirm).toBeDisabled();
  const scan = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(scan.violations).toEqual([]);
  await dialog
    .getByRole("checkbox", { name: "1 gespeicherten Entwurf ersetzen" })
    .check();
  await confirm.press("Enter");
  await expect(
    dialog.getByText("1 Note wurde als Entwurf gespeichert."),
  ).toBeVisible();
  expect((await state()).rows[0].score).toBe(91);
  expect((await results()).results).toHaveLength(0);
  await page.keyboard.press("Escape");
  await expect(importButton).toBeFocused();
  await page
    .getByRole("button", { name: "Bewertungen veröffentlichen" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Bewertungen veröffentlichen" })
    .click();
  await expect
    .poll(async () => (await results()).results)
    .toEqual([expect.objectContaining({ score: 91, passed: true })]);
});
