/** The timed exam window is read from the real authenticated course service. */
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { enablePremiumAndLinkParticipant } from "../../scripts/testing/company-participant.mjs";
import { actor, api, checked, login } from "./helpers/accounts-support";

test.skip(
  process.env.PORTAL_TEST_MODE !== "1",
  "Exam time fixtures require isolated services.",
);

test("management assigns an individual exam time allowance and the learner receives the effective deadline", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const manager = await actor("Fictional exam manager", "admin");
  const company = await actor("Fictional exam organisation contact", "client");
  const learner = await actor(
    "Fictional examination participant",
    "participant",
  );
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
  const suffix = randomUUID().slice(0, 8);
  const now = Date.now();
  const at = (minutes: number) =>
    new Date(now + minutes * 60_000).toISOString();
  await checked(
    service.from("organisations").insert({
      id: organisation,
      name: `Fictional exam organisation ${suffix}`,
    }),
  );
  await checked(
    service
      .from("client_organisation_memberships")
      .insert({ user_id: company.id, organisation_id: organisation }),
  );
  await checked(
    service
      .from("course_templates")
      .insert({ id: template, title: `Fictional exam course ${suffix}` }),
  );
  await checked(
    service.from("course_runs").insert({
      id: run,
      template_id: template,
      organisation_id: organisation,
      time_zone: "Australia/Brisbane",
      published: true,
    }),
  );
  await checked(
    service
      .from("course_sessions")
      .insert({ course_run_id: run, starts_at: at(-20), ends_at: at(120) }),
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
      p_title: `Fictional timed exam ${suffix}`,
      p_visible_from: at(-15),
      p_starts_at: at(30),
      p_ends_at: at(60),
      p_pass_percent: 60,
      p_version: 0,
    }),
    { requireData: true },
  );

  await login(page, manager.email);
  await page.goto(`/courses/${run}/workspace#course-exam`);
  const panel = page.getByRole("region", {
    name: "Individuelle Bearbeitungszeit",
  });
  await panel.getByLabel("Teilnehmende Person").selectOption(learner.id);
  await panel.getByLabel("Zusätzliche Minuten").fill("30");
  await panel
    .getByRole("button", { name: "Bearbeitungszeit speichern" })
    .click();
  await expect(panel.getByText("Gespeichert.", { exact: true })).toBeVisible();
  const a11y = await new AxeBuilder({ page })
    .include(
      `[aria-labelledby=${JSON.stringify(await panel.getAttribute("aria-labelledby"))}]`,
    )
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);

  const state = await checked(
    learnerClient.rpc("course_exam_state", { p_run_id: run }),
    { requireData: true },
  );
  expect(state.rows).toEqual([]);
  expect(state.can_set_extra_time).toBe(false);
  expect(Date.parse(state.learner_ends_at) - Date.parse(state.ends_at)).toBe(
    30 * 60_000,
  );
  const write = await learnerClient.rpc("set_course_exam_extra_time", {
    p_run_id: run,
    p_participant_id: learner.id,
    p_extra_minutes: 60,
    p_expected_revision: 1,
  });
  expect(write.error?.code).toBe("42501");
});
