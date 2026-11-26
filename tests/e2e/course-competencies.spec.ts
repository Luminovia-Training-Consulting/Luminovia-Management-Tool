/** Managers map competencies and participants read their released evidence on the isolated QA stack. */
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { enablePremiumAndLinkParticipant } from "../../scripts/testing/company-participant.mjs";
import { actor, api, checked, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Competency fixtures require the canonical disposable services.",
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

test("a manager pins a competency framework and releases a learner evidence decision", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  // Use a fresh course and actors on each project. The isolated runner disposes
  // of their records; the test never modifies shared fixture or grading history.
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const manager = await authenticatedActor(
    "Fictional competency manager",
    "admin",
  );
  const company = await authenticatedActor(
    "Fictional competency contact",
    "client",
  );
  const learner = await authenticatedActor(
    "Fictional competency learner",
    "participant",
  );
  const organisation = randomUUID();
  const template = randomUUID();
  const run = randomUUID();
  const suffix = run.slice(0, 8);
  await checked(
    service.from("organisations").insert({
      id: organisation,
      name: `Fictional competency organisation ${suffix}`,
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
      title: `Fictional competency course ${suffix}`,
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

  await checked(
    manager.client.rpc("course_workspace_action", {
      p_run_id: run,
      p_action: "quiz_config",
      p_expected_version: 0,
      p_payload: {
        questions: [
          {
            prompt: "Which command lists a directory?",
            options: ["ls", "pwd"],
            correct: 0,
          },
        ],
        pass_percent: 80,
        max_attempts: 1,
        published: true,
      },
    }),
  );
  await checked(
    learner.client.rpc("course_workspace_action", {
      p_run_id: run,
      p_action: "quiz_attempt",
      p_expected_version: 1,
      p_payload: { answers: [0], request_id: randomUUID() },
    }),
  );

  const workspace = `/courses/${run}/workspace#course-learning`;
  const name = `Kommandozeilenpraxis ${suffix}`;
  const evidence = "Die Verzeichnisstruktur selbstständig geprüft";
  await login(page, manager.email);
  await page.goto(workspace);
  const competencies = page
    .locator("details")
    .filter({ has: page.getByText("Kompetenzen", { exact: true }) });
  await competencies.getByText("Kompetenzen", { exact: true }).click();
  await competencies
    .getByRole("button", { name: "Kompetenzrahmen erstellen" })
    .click();
  await competencies.getByLabel("Name des Kompetenzrahmens").fill(name);
  await competencies
    .getByLabel("Stufe 1", { exact: true })
    .fill("Mit Anleitung");
  await competencies
    .getByLabel("Stufe 2", { exact: true })
    .fill("Selbstständig");
  await competencies.getByLabel("Kürzel").fill("CLI");
  await competencies
    .getByLabel("Bezeichnung", { exact: true })
    .fill("Dateien finden");
  await competencies
    .getByRole("button", { name: "Rahmenfassung speichern" })
    .click();
  await competencies
    .getByLabel("Kompetenzrahmen auswählen")
    .selectOption({ label: `${name} · Fassung 1` });
  const pin = competencies.getByRole("button", {
    name: "Fassung dem Kurs zuordnen",
  });
  await pin.click();
  await expect(pin).toBeDisabled();
  await competencies
    .getByLabel("Teilnehmende Person")
    .selectOption({ label: learner.name });
  await competencies
    .getByLabel("Kompetenz", { exact: true })
    .selectOption({ label: "CLI · Dateien finden" });
  await competencies
    .getByLabel("Stufe", { exact: true })
    .selectOption({ label: "Selbstständig" });
  await competencies.getByLabel("Begründung und Lernnachweis").fill(evidence);
  await competencies
    .getByLabel(/Besten Versuch des aktuell veröffentlichten Quiz/)
    .check();
  await competencies
    .getByRole("button", { name: "Beurteilung freigeben" })
    .click();
  await expect(competencies.getByText(evidence, { exact: true })).toBeVisible();

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
    const learnerCompetencies = learnerPage.locator("details").filter({
      has: learnerPage.getByText("Kompetenzen", { exact: true }),
    });
    await learnerCompetencies.getByText("Kompetenzen", { exact: true }).click();
    await expect(
      learnerCompetencies.getByText(evidence, { exact: true }),
    ).toBeVisible();
    await expect(
      learnerCompetencies.getByText(/Quizfassung 1 · 100 %/),
    ).toBeVisible();
    await expect(
      learnerCompetencies.getByRole("button", {
        name: "Beurteilung freigeben",
      }),
    ).toHaveCount(0);
    expect(
      await learnerCompetencies.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
  } finally {
    await learnerContext.close();
  }
});
