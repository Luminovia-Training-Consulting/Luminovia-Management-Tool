/** Native exam authoring, timed submission and private grade release in the owned QA stack. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createAssessmentCourse } from "./helpers/assessment-course";
import { checked, login } from "./helpers/accounts-support";
import { fillWorkbookCell } from "./helpers/spreadsheet";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Text exam fixtures require the canonical disposable services.",
);

/** Move only this isolated exam fixture through its extended submission window. */
function moveFixtureExam(run: string, stage: "extra-time" | "closed") {
  const project = /^project_id\s*=\s*"(luminovia-portal-test-[a-f0-9]+)"/m.exec(
    readFileSync("supabase/config.toml", "utf8"),
  )?.[1];
  if (
    !project ||
    process.env.PORTAL_TEST_MODE !== "1" ||
    !/^[0-9a-f-]{36}$/.test(run)
  )
    throw new Error("A disposable exam fixture is required");
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      `supabase_db_${project}`,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      input: `update private.course_text_exam_versions
        set opens_at=clock_timestamp()-interval '1 hour',
            closes_at=clock_timestamp()-interval '${stage === "extra-time" ? 1 : 36} minutes'
        where run_id='${run}'`,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 20_000,
    },
  );
}

test("a learner recovers private text, submits once and sees only the released grade", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const { manager, learner, run, suffix } =
    await createAssessmentCourse("text exam");
  const workspace = `/courses/${run}/workspace#course-learning`;
  const readExam = () =>
    checked(learner.client.rpc("course_text_exam", { p_run_id: run }), {
      requireData: true,
    });
  const title = `Routing exam ${suffix}`;
  const prompt = "Explain what happens when no more specific route matches.";
  const localMinute = (offset: number) =>
    new Date(Date.now() + offset).toISOString().slice(0, 16);
  await login(page, manager.email);
  await page.goto(workspace);
  const staffExam = page.locator("#course-learning");
  await page.getByText("Freitextprüfung", { exact: true }).click();
  await page.getByLabel("Prüfungstitel").fill(title);
  await page.getByLabel("Öffnet").fill(localMinute(3_600_000));
  await page.getByLabel("Schließt").fill(localMinute(7_200_000));
  await page.getByLabel("Aufgabentext").fill(prompt);
  await page.getByLabel("Maximale Punktzahl").fill("10");
  await staffExam
    .getByRole("button", { name: "Entwurf speichern", exact: true })
    .click();
  await expect(
    staffExam.getByText("Gespeichert.", { exact: true }),
  ).toBeVisible();
  expect((await readExam()).exam).toBeNull();
  await page
    .getByRole("button", { name: "Prüfung veröffentlichen", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Prüfung veröffentlichen", exact: true })
    .click();
  await expect.poll(async () => (await readExam()).exam?.title).toBe(title);
  const initial = (await readExam()).exam;
  expect(initial.questions).toBeNull();
  await staffExam
    .getByText("Zusatzzeit verwalten", { exact: true })
    .press("Enter");
  await staffExam
    .getByLabel("Teilnehmende Person für Zusatzzeit")
    .selectOption(learner.id);
  const minutes = staffExam.getByRole("spinbutton", {
    name: "Zusatzzeit in Minuten",
  });
  await expect(minutes).toHaveValue("0");
  await minutes.fill("35");
  await staffExam
    .getByRole("button", { name: "Zusatzzeit speichern" })
    .press("Enter");
  await expect
    .poll(async () => Date.parse((await readExam()).exam.deadline))
    .toBe(Date.parse(initial.closes_at) + 35 * 60_000);
  moveFixtureExam(run, "extra-time");

  const learnerContext = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
  });
  try {
    const candidate = await learnerContext.newPage();
    await login(candidate, learner.email, /\/learning$/);
    await candidate.goto(workspace);
    const learnerExam = candidate.locator("#course-learning");
    await expect(
      learnerExam.getByText("Kursfeedback & Qualität", { exact: true }),
    ).toBeVisible();
    await expect(
      learnerExam.getByRole("button", { name: "Kursfeedback speichern" }),
    ).toBeHidden();
    const examDisclosure = candidate.getByText("Freitextprüfung", {
      exact: true,
    });
    await examDisclosure.press("Enter");
    await expect(candidate.getByText(prompt, { exact: true })).toBeVisible();
    await expect(learnerExam.getByRole("timer")).toHaveText(/Noch \d+ Minuten/);
    const answer = "The router forwards traffic using the default route.";
    const answerField = candidate.getByRole("textbox", {
      name: "Antwort zu Aufgabe 1",
      exact: true,
    });
    await expect(answerField).toHaveAccessibleDescription(prompt);
    await candidate.keyboard.press("Tab");
    await expect(answerField).toBeFocused();
    const viewport = candidate.viewportSize()!;
    await candidate.setViewportSize({ width: 320, height: viewport.height });
    await expect
      .poll(() =>
        learnerExam.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      )
      .toBe(true);
    await candidate.getByLabel("Sprache", { exact: true }).selectOption("en");
    await candidate.getByLabel("Theme", { exact: true }).selectOption("dark");
    await expect(candidate.locator("html")).toHaveAttribute(
      "data-theme",
      "dark",
    );
    const englishAnswer = candidate.getByRole("textbox", {
      name: "Answer to question 1",
      exact: true,
    });
    await expect(englishAnswer).toHaveAccessibleDescription(prompt);
    await expect(learnerExam.getByRole("timer")).toHaveText(
      /\d+ minutes remaining/,
    );
    const learnerScan = await new AxeBuilder({ page: candidate })
      .include("#course-learning")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(learnerScan.violations).toEqual([]);
    await learnerExam.screenshot({
      path: info.outputPath("learner-exam-320-dark.png"),
    });
    await candidate.getByLabel("Theme", { exact: true }).selectOption("light");
    await candidate.getByLabel("Language", { exact: true }).selectOption("de");
    await candidate.setViewportSize(viewport);
    await answerField.fill(answer);
    await expect(
      learnerExam.getByText(/Du hast ungespeicherte Antworten/),
    ).toBeVisible();
    await learnerExam
      .getByRole("button", { name: "Entwurf speichern", exact: true })
      .click();
    await expect(
      learnerExam.getByText("Gespeichert.", { exact: true }),
    ).toBeVisible();
    await expect(
      learnerExam.getByText(/Du hast ungespeicherte Antworten/),
    ).toHaveCount(0);
    await candidate.reload();
    await candidate.getByText("Freitextprüfung", { exact: true }).click();
    await expect(answerField).toHaveValue(answer);
    const submit = candidate.getByRole("button", {
      name: "Prüfung abgeben",
      exact: true,
    });
    await submit.press("Enter");
    await expect(candidate.getByRole("dialog")).toBeVisible();
    await candidate.keyboard.press("Escape");
    await expect(submit).toBeFocused();
    await submit.press("Enter");
    await candidate
      .getByRole("dialog")
      .getByRole("button", { name: "Prüfung abgeben", exact: true })
      .click();
    await expect(candidate.getByText(/Abgegeben am/)).toBeVisible();
    await expect(answerField).not.toBeEditable();
    await expect(
      learnerExam.getByRole("status").filter({ hasText: /Abgegeben am/ }),
    ).toBeVisible();
    await expect(
      candidate.getByText("Die Bewertung steht noch aus."),
    ).toBeVisible();

    moveFixtureExam(run, "closed");
    await page.reload();
    await page.getByText("Freitextprüfung", { exact: true }).click();
    const attempt = page.getByLabel("Abgabe zur Bewertung auswählen", {
      exact: true,
    });
    await attempt.selectOption(learner.id);
    await expect(attempt.locator("option:checked")).toHaveText(
      "Fictional text exam learner",
    );
    await expect(
      staffExam.getByText(/Abgegeben am .* · Unbewertet/),
    ).toBeVisible();

    await expect(page.getByText(answer, { exact: true })).toBeVisible();
    await page.getByLabel("Vergebene Punkte").fill("8");
    const notes = "The next hop follows the selected default route.";
    await page.getByLabel("Rückmeldung", { exact: true }).fill(notes);
    await page
      .getByRole("button", { name: "Bewertungsentwurf speichern", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Bewertung freigeben", exact: true }),
    ).toBeVisible();
    expect((await readExam()).review).toBeNull();
    const importButton = staffExam.getByRole("button", {
      name: "Prüfungsnoten importieren",
    });
    await importButton.press("Enter");
    const importDialog = page.getByRole("dialog", {
      name: "Prüfungsnoten importieren",
    });
    const capture = page.waitForEvent("download");
    await importDialog
      .getByRole("button", { name: "CSV-Vorlage herunterladen" })
      .click();
    const template = readFileSync(await (await capture).path(), "utf8");
    expect(template).toContain(learner.id);
    expect(template).toMatch(/,"1",""$/);
    const input = importDialog.getByLabel("Notentabelle auswählen");
    await input.setInputFiles({
      name: "text-marks.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(template.replace(/,""$/, ',"9"')),
    });
    await expect(importDialog.getByText("8/10 → 9/10")).toBeVisible();
    const confirmImport = importDialog.getByRole("button", {
      name: "1 Note als Entwurf speichern",
    });
    await expect(confirmImport).toBeDisabled();
    await importDialog
      .getByRole("checkbox", { name: "1 gespeicherten Entwurf ersetzen" })
      .check();
    await confirmImport.press("Enter");
    await expect(
      importDialog.getByText("1 Note wurde als Entwurf gespeichert."),
    ).toBeVisible();

    const excelCapture = page.waitForEvent("download");
    await importDialog
      .getByRole("button", { name: "Excel-Vorlage herunterladen" })
      .click();
    const workbook = readFileSync(await (await excelCapture).path());
    await input.setInputFiles({
      name: "text-marks.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: await fillWorkbookCell(workbook, "F2", 10, learner.id),
    });
    await expect(importDialog.getByText("9/10 → 10/10")).toBeVisible();
    await importDialog
      .getByRole("checkbox", { name: "1 gespeicherten Entwurf ersetzen" })
      .check();
    const scan = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(scan.violations).toEqual([]);
    await confirmImport.press("Enter");
    await expect(
      importDialog.getByText("1 Note wurde als Entwurf gespeichert."),
    ).toBeVisible();
    expect((await readExam()).review).toBeNull();
    await page.keyboard.press("Escape");
    await expect(importButton).toBeFocused();
    await page
      .getByRole("button", { name: "Bewertung freigeben", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Bewertung freigeben", exact: true })
      .click();
    await expect.poll(async () => (await readExam()).review?.score).toBe(10);
    await candidate.reload();
    await candidate.getByText("Freitextprüfung", { exact: true }).click();
    await expect(
      candidate.getByText("Bestanden · 10 von 10 Punkten", { exact: true }),
    ).toBeVisible();
    await expect(candidate.getByText(notes, { exact: true })).toBeVisible();
    expect(
      await candidate
        .locator("#course-learning")
        .evaluate((section) => section.scrollWidth <= section.clientWidth + 1),
    ).toBe(true);
  } finally {
    await learnerContext.close();
  }
});
