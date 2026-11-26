/** Staff author and reuse an exact bank question on the disposable QA stack. */
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { enablePremiumAndLinkParticipant } from "../../scripts/testing/company-participant.mjs";
import { actor, api, checked, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Question-bank fixtures require the canonical disposable services.",
);

/** Give fixture RPCs the same role-scoped Auth sessions as their browser actors. */
async function authenticatedActor(name: string, role: string) {
  const account = await actor(name, role);
  const client = api(process.env.SUPABASE_ANON_KEY!);
  await checked(
    client.auth.signInWithPassword({
      email: account.email,
      password: process.env.E2E_PASSWORD!,
    }),
  );
  return { ...account, client };
}

test("staff reuse an immutable question in a quiz and the learner submits the snapshot", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  // Use a fresh course and actors on each project. The isolated runner disposes
  // of their records; the test never modifies shared fixture or grading history.
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const manager = await authenticatedActor("Fictional quiz manager", "admin");
  const company = await authenticatedActor("Fictional quiz contact", "client");
  const learner = await authenticatedActor(
    "Fictional quiz learner",
    "participant",
  );
  const organisation = randomUUID();
  const template = randomUUID();
  const run = randomUUID();
  const suffix = run.slice(0, 8);
  await checked(
    service.from("organisations").insert({
      id: organisation,
      name: `Fictional bank organisation ${suffix}`,
    }),
  );
  await checked(
    service.from("client_organisation_memberships").insert({
      user_id: company.id,
      organisation_id: organisation,
    }),
  );
  await checked(
    service.from("course_templates").insert({
      id: template,
      title: `Fictional bank course ${suffix}`,
    }),
  );
  await checked(
    service.from("course_runs").insert({
      id: run,
      template_id: template,
      organisation_id: organisation,
      published: true,
    }),
  );
  const now = Date.now();
  await checked(
    service.from("course_sessions").insert({
      course_run_id: run,
      starts_at: new Date(now - 2 * 3_600_000).toISOString(),
      ends_at: new Date(now - 3_600_000).toISOString(),
    }),
  );
  await enablePremiumAndLinkParticipant({
    admin: manager,
    company,
    learner,
    organisation,
    service,
    checked,
  });
  await checked(
    manager.client.rpc("manage_course_enrolment", {
      p_course_run_id: run,
      p_user_id: learner.id,
      p_status: "enrolled",
    }),
  );

  const workspace = `/courses/${run}/workspace#course-learning`;
  const prompt = `Welcher Befehl listet das Verzeichnis auf? ${suffix}`;
  await login(page, manager.email);
  await page.goto(workspace);
  const quiz = page.getByRole("region", { name: "Mini-Quiz" });
  await quiz.getByText("Fragenbank", { exact: true }).click();
  await quiz.getByRole("button", { name: "Bankfrage erstellen" }).click();
  const create = quiz.getByRole("group", { name: "Bankfrage erstellen" });
  await create.getByLabel("Thema").fill("Linux-Dateisysteme");
  await create.getByLabel("Fragestellung").fill(prompt);
  await create.getByLabel(/Antwortmöglichkeiten/).fill("ls\npwd");
  await create.getByRole("button", { name: "Fragenfassung speichern" }).click();
  const question = quiz.getByRole("listitem").filter({ hasText: prompt });
  await expect(question).toContainText("Fassung 1");
  await question.getByRole("button", { name: "Ins Quiz übernehmen" }).click();
  await expect(quiz.getByText("Fragenbank · Fassung 1")).toBeVisible();
  await quiz
    .getByLabel("Quiz für eingeschriebene Teilnehmende veröffentlichen")
    .check();
  await quiz
    .getByRole("button", { name: "Neue Quizfassung speichern" })
    .click();
  await expect
    .poll(async () => {
      const staff = await checked(
        manager.client.rpc("course_workspace", { p_run_id: run }),
        { requireData: true },
      );
      return staff.quiz?.questions[0].source?.revision;
    })
    .toBe(1);

  // Saving a new quiz revision remounts and closes the editor before another edit.
  await expect(quiz.locator("details")).not.toHaveAttribute("open", "");
  // Revising the pool leaves the learner's published snapshot unchanged.
  await quiz.getByText("Fragenbank", { exact: true }).click();
  await question
    .getByRole("button", { name: "Neue Fassung bearbeiten" })
    .click();
  const edit = quiz.getByRole("group", { name: "Neue Fassung bearbeiten" });
  await edit.getByLabel("Fragestellung").fill("Eine spätere Fassung");
  await edit.getByRole("button", { name: "Fragenfassung speichern" }).click();
  await expect(
    quiz.getByRole("listitem").filter({ hasText: "Eine spätere Fassung" }),
  ).toContainText("Fassung 2");

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
    await expect(
      learnerQuiz.getByRole("group", { name: prompt }),
    ).toBeVisible();
    await expect(
      learnerQuiz.getByText("Fragenbank", { exact: true }),
    ).toHaveCount(0);
    await expect(learnerQuiz.getByText("Eine spätere Fassung")).toHaveCount(0);
    await learnerQuiz.getByRole("radio", { name: "ls", exact: true }).check();
    await learnerQuiz
      .getByRole("button", { name: "Antworten verbindlich abgeben" })
      .click();
    await expect(
      learnerQuiz.getByText(/Ergebnis: 100 %.*Bestanden/),
    ).toBeVisible();
  } finally {
    await learnerContext.close();
  }
});
