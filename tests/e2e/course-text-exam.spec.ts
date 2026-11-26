/** Native exam authoring, timed submission and private grade release in the owned QA stack. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createAssessmentCourse } from "./helpers/assessment-course";
import { checked, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Text exam fixtures require the canonical disposable services.",
);

/** Move the newly created fixture beyond its deadline without a wall-clock wait. */
function closeFixtureExam(run: string) {
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
      input: `update private.course_text_exam_versions set closes_at=clock_timestamp()
        where run_id='${run}' and closes_at > clock_timestamp()`,
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
  await page.getByLabel("Öffnet").fill(localMinute(-3_600_000));
  await page.getByLabel("Schließt").fill(localMinute(3_600_000));
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
    await candidate.getByText("Freitextprüfung", { exact: true }).click();
    await expect(candidate.getByText(prompt, { exact: true })).toBeVisible();
    const answer = "The router forwards traffic using the default route.";
    await candidate.getByLabel("Antwort", { exact: true }).fill(answer);
    await learnerExam
      .getByRole("button", { name: "Entwurf speichern", exact: true })
      .click();
    await expect(
      learnerExam.getByText("Gespeichert.", { exact: true }),
    ).toBeVisible();
    await candidate.reload();
    await candidate.getByText("Freitextprüfung", { exact: true }).click();
    await expect(candidate.getByLabel("Antwort", { exact: true })).toHaveValue(
      answer,
    );
    await candidate
      .getByRole("button", { name: "Prüfung abgeben", exact: true })
      .click();
    await candidate
      .getByRole("dialog")
      .getByRole("button", { name: "Prüfung abgeben", exact: true })
      .click();
    await expect(candidate.getByText(/Abgegeben am/)).toBeVisible();
    await expect(
      candidate.getByLabel("Antwort", { exact: true }),
    ).not.toBeEditable();
    await expect(
      candidate.getByText("Die Bewertung steht noch aus."),
    ).toBeVisible();

    closeFixtureExam(run);
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
    await page
      .getByRole("button", { name: "Bewertung freigeben", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Bewertung freigeben", exact: true })
      .click();
    await expect.poll(async () => (await readExam()).review?.score).toBe(8);
    await candidate.reload();
    await candidate.getByText("Freitextprüfung", { exact: true }).click();
    await expect(
      candidate.getByText("Bestanden · 8 von 10 Punkten", { exact: true }),
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
