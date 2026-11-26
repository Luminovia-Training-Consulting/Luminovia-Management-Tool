import { randomUUID } from "node:crypto";
import { enablePremiumAndLinkParticipant } from "../../../scripts/testing/company-participant.mjs";
import { actor, api, checked } from "./accounts-support";

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

/** Fresh fictional course and role-scoped Auth clients in the isolated QA runner. */
export async function createAssessmentCourse(label: string) {
  // Use a fresh course and actors on each project. The isolated runner disposes
  // of their records; the test never modifies shared fixture or grading history.
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const manager = await authenticatedActor(
    `Fictional ${label} manager`,
    "admin",
  );
  const company = await authenticatedActor(
    `Fictional ${label} contact`,
    "client",
  );
  const learner = await authenticatedActor(
    `Fictional ${label} learner`,
    "participant",
  );
  const organisation = randomUUID();
  const template = randomUUID();
  const run = randomUUID();
  const suffix = run.slice(0, 8);
  await checked(
    service.from("organisations").insert({
      id: organisation,
      name: `Fictional ${label} organisation ${suffix}`,
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
      title: `Fictional ${label} course ${suffix}`,
    }),
  );
  await checked(
    service.from("course_runs").insert({
      id: run,
      template_id: template,
      organisation_id: organisation,
      published: true,
      time_zone: "UTC",
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

  return { manager, company, learner, run, suffix };
}
