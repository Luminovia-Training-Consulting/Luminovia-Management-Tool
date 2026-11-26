/** Native Quiz Pool authoring, draw recovery and canonical grading on the disposable QA stack. */
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createAssessmentCourse } from "./helpers/assessment-course";
import { checked, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Quiz pool fixtures require the canonical disposable services.",
);

test("the learner resumes a randomized quiz draw and uses the next permitted attempt", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const { manager, learner, run, suffix } =
    await createAssessmentCourse("pool");

  const bank = [
    {
      prompt: `Working directory? ${suffix}`,
      options: ["pwd", "ls"],
      correct: 0,
    },
    {
      prompt: `Directory entries? ${suffix}`,
      options: ["pwd", "ls"],
      correct: 1,
    },
    { prompt: `First lines? ${suffix}`, options: ["head", "tail"], correct: 0 },
  ];
  for (const question of bank) {
    await checked(
      manager.client.rpc("course_question_bank_action", {
        p_run_id: run,
        p_action: "save",
        p_expected_version: 0,
        p_payload: {
          id: randomUUID(),
          topic: "Fictional pool",
          difficulty: "introductory",
          content: question,
        },
      }),
    );
  }
  const workspace = `/courses/${run}/workspace#course-learning`;
  await login(page, manager.email);
  await page.goto(workspace);
  const staff = page.getByRole("region", { name: "Mini-Quiz" });
  await staff.getByText("Fragenbank", { exact: true }).click();
  for (const question of bank) {
    await staff
      .getByRole("listitem")
      .filter({ hasText: question.prompt })
      .getByRole("button", { name: "Ins Quiz übernehmen" })
      .click();
  }
  await staff.getByLabel("Fragen pro Versuch ziehen").check();
  await staff.getByLabel("Fragen pro Versuch", { exact: true }).fill("2");
  await staff.getByLabel("Maximale Versuche").fill("2");
  await staff
    .getByLabel("Quiz für eingeschriebene Teilnehmende veröffentlichen")
    .check();
  await staff
    .getByRole("button", { name: "Neue Quizfassung speichern" })
    .click();
  const learnerState = async () =>
    (
      await checked(learner.client.rpc("course_workspace", { p_run_id: run }), {
        requireData: true,
      })
    ).quiz;
  await expect
    .poll(async () => (await learnerState())?.pool?.draw_count)
    .toBe(2);
  expect((await learnerState()).questions).toEqual([]);

  const learnerContext = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
  });
  try {
    const learnerPage = await learnerContext.newPage();
    await login(learnerPage, learner.email, /\/learning$/);
    await learnerPage.goto(workspace);
    const learnerQuiz = learnerPage.getByRole("region", { name: "Mini-Quiz" });
    const start = learnerQuiz.getByRole("button", {
      name: "Fragen ziehen und Versuch starten",
    });
    await expect(learnerQuiz.getByRole("radio")).toHaveCount(0);
    await start.click();
    await expect(learnerQuiz.getByRole("radio")).toHaveCount(4);
    const first = await learnerState();
    expect(first.questions).toHaveLength(2);
    const wrong = (items: { prompt: string }[]) =>
      items.map(({ prompt }) => {
        const item = bank.find((question) => question.prompt === prompt);
        if (!item) throw Error("Unexpected draw question");
        return item.options[1 - item.correct];
      });
    const incorrect = wrong(first.questions);
    await learnerQuiz
      .getByRole("group", { name: first.questions[0].prompt, exact: true })
      .getByRole("radio", { name: incorrect[0], exact: true })
      .check();
    await expect(
      learnerQuiz.getByText("Antwortentwurf gespeichert"),
    ).toBeVisible();
    await learnerPage.reload();
    await expect(
      learnerQuiz
        .getByRole("group", { name: first.questions[0].prompt, exact: true })
        .getByRole("radio", { name: incorrect[0], exact: true }),
    ).toBeChecked();
    expect((await learnerState()).pool.request_id).toBe(first.pool.request_id);
    expect((await learnerState()).questions).toEqual(first.questions);
    await learnerQuiz
      .getByRole("group", { name: first.questions[1].prompt, exact: true })
      .getByRole("radio", { name: incorrect[1], exact: true })
      .check();
    await learnerQuiz
      .getByRole("button", { name: "Antworten verbindlich abgeben" })
      .click();
    await expect(
      learnerQuiz.getByText(/Ergebnis: 0 %.*Noch nicht bestanden/),
    ).toBeVisible();
    await start.click();
    await expect(learnerQuiz.getByRole("radio")).toHaveCount(4);
    const second = await learnerState();
    expect(second.pool.request_id).not.toBe(first.pool.request_id);
    for (const question of second.questions) {
      const expected = bank.find(
        (candidate) => candidate.prompt === question.prompt,
      );
      if (!expected) throw Error("Unexpected draw question");
      await learnerQuiz
        .getByRole("group", { name: question.prompt, exact: true })
        .getByRole("radio", {
          name: expected.options[expected.correct],
          exact: true,
        })
        .check();
    }
    await learnerQuiz
      .getByRole("button", { name: "Antworten verbindlich abgeben" })
      .click();
    await expect(
      learnerQuiz.getByText(/Ergebnis: 100 %.*Bestanden/),
    ).toBeVisible();
    await expect(start).toHaveCount(0);
  } finally {
    await learnerContext.close();
  }
});
