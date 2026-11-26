/** Staff release a real quiz grade to an enrolled learner on the disposable QA stack. */
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { enablePremiumAndLinkParticipant } from "../../scripts/testing/company-participant.mjs";
import { actor, api, checked, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Course gradebook fixtures require the canonical disposable services.",
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

test("staff save the default quiz grading scale and release a grade to the enrolled learner", async ({
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
      name: `Fictional gradebook organisation ${suffix}`,
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
      title: `Fictional gradebook course ${suffix}`,
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

  // The existing quiz RPCs create the source attempt; only the browsers save
  // the grading scale and release the grade. One correct answer yields 50%.
  await checked(
    manager.client.rpc("course_workspace_action", {
      p_run_id: run,
      p_action: "quiz_config",
      p_expected_version: 0,
      p_payload: {
        questions: [
          { prompt: "List a directory?", options: ["ls", "pwd"], correct: 0 },
          {
            prompt: "Print the working directory?",
            options: ["ls", "pwd"],
            correct: 1,
          },
        ],
        pass_percent: 50,
        max_attempts: 1,
        published: true,
      },
    }),
  );
  const attempt = await checked(
    learner.client.rpc("course_workspace_action", {
      p_run_id: run,
      p_action: "quiz_attempt",
      p_expected_version: 1,
      p_payload: { answers: [0, 0], request_id: randomUUID() },
    }),
    { requireData: true },
  );
  expect(attempt).toMatchObject({ score: 50 });

  const workspace = `/courses/${run}/workspace#course-gradebook`;
  const title = { name: "Quiz-Notenbuch", exact: true };
  const saveScale = { name: "Notenskala speichern", exact: true };
  const releaseGrade = { name: "Note freigeben", exact: true };
  const unpublished = "Noch keine Note freigegeben.";

  await login(page, manager.email);
  await page.goto(workspace);
  const staffGradebook = page.getByRole("region", title);
  await expect(staffGradebook.getByRole("heading", title)).toBeVisible();
  await expect(staffGradebook.getByRole("combobox")).toHaveValue("percentage");
  const learnerRow = staffGradebook.getByRole("listitem").filter({
    has: page.getByRole("heading", { name: learner.name, exact: true }),
  });
  const release = learnerRow.getByRole("button", releaseGrade);
  await expect(learnerRow).toBeVisible();
  await expect(release).toHaveCount(0);
  await staffGradebook.getByRole("button", saveScale).click();
  await expect(release).toBeEnabled();
  // The release action must still be available after loading the saved scale.
  await page.reload();
  await expect(release).toBeEnabled();

  const context = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport,
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
  });
  try {
    const learnerPage = await context.newPage();
    await login(learnerPage, learner.email, /\/learning$/);
    await learnerPage.goto(workspace);
    const learnerGradebook = learnerPage.getByRole("region", title);
    const learnerStatus = learnerGradebook.getByRole("status");
    await expect(learnerGradebook.getByRole("heading", title)).toBeVisible();
    await expect(learnerStatus).toHaveText(unpublished);
    await expect(learnerGradebook.getByRole("button", saveScale)).toHaveCount(
      0,
    );
    await expect(
      learnerGradebook.getByRole("button", releaseGrade),
    ).toHaveCount(0);

    const staffUnpublished = learnerRow.getByText(unpublished, { exact: true });
    await expect(staffUnpublished).toBeVisible();
    await release.click();
    await expect(staffUnpublished).toHaveCount(0);
    await learnerPage.reload();
    await expect(learnerStatus).toHaveText(/\b50\s*%/);
  } finally {
    await context.close();
  }
});
