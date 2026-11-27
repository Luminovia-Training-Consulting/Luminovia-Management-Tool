/** Exercises the own-course dashboard projection against two fictional companies. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("course_overview", async ({ actor, sql }) => {
  const [admin, learner, a, b, template, runA, runB] = Array.from(
    { length: 7 },
    randomUUID,
  );
  await sql(`
    insert into auth.users(id,email,email_confirmed_at) values
      (${q(admin)},'overview-admin@example.invalid',now()),
      (${q(learner)},'overview-learner@example.invalid',now());
    insert into public.user_roles(user_id,role) values (${q(admin)},'admin'),(${q(learner)},'participant');
    insert into public.organisations(id,name) values (${q(a)},'Fictional studio A'),(${q(b)},'Fictional studio B');
    insert into public.course_templates(id,title) values (${q(template)},'Fictional timetable');
    insert into public.course_runs(id,template_id,organisation_id)
      values(${q(runA)},${q(template)},${q(a)}),(${q(runB)},${q(template)},${q(b)});
    insert into public.course_sessions(course_run_id,starts_at,ends_at) values
      (${q(runA)},now()-interval '2 days',now()-interval '1 day'),
      (${q(runA)},now()+interval '1 day',now()+interval '25 hours'),
      (${q(runB)},now()-interval '3 days',now()-interval '2 days');
  `);
  const list = (who) =>
    actor(who, "select public.my_course_workspaces()").then(JSON.parse);
  const switchPremium = (company, enabled, version) =>
    actor(
      admin,
      `select public.set_company_premium(${q(company)},${enabled},${version},${q(randomUUID())})`,
    );
  for (const [org, run] of [
    [a, runA],
    [b, runB],
  ]) {
    await switchPremium(org, true, 0);
    const identity = await sql(
      `select luminovia_user_id from public.profiles where id=${q(learner)}`,
    );
    await actor(
      admin,
      `select public.request_company_participant_link(${q(org)},${q(identity)},${q(randomUUID())})`,
    );
    await actor(
      learner,
      `select public.accept_company_participant_invitation(${q(org)},1,${q(randomUUID())})`,
    );
    await actor(
      admin,
      `select public.manage_course_enrolment(${q(run)},${q(learner)},'enrolled')`,
    );
  }
  const rows = await list(learner);
  assert.equal(rows.length, 2);
  const upcoming = rows.find((row) => row.id === runA);
  const completed = rows.find((row) => row.id === runB);
  assert.equal(upcoming.organisation_name, "Fictional studio A");
  assert.equal(completed.organisation_name, "Fictional studio B");
  assert.equal(completed.next_start_at, null);
  assert.equal(
    Date.parse(upcoming.next_start_at),
    Date.parse(
      await sql(
        `select min(starts_at) from public.course_sessions where course_run_id=${q(runA)} and starts_at>now()`,
      ),
    ),
  );
  await switchPremium(a, false, 1);
  const afterDowngrade = await list(learner);
  assert.equal(afterDowngrade.length, 2);
  assert.equal(afterDowngrade.find(({ id }) => id === runA).lms_enabled, false);
  assert.equal(afterDowngrade.find(({ id }) => id === runB).lms_enabled, true);
  const standardCourse = JSON.parse(
    await actor(learner, `select public.course_workspace(${q(runA)})`),
  );
  assert.equal(standardCourse.access.learner, true);
  assert.equal(standardCourse.lms_enabled, false);
  await assert.rejects(
    actor(learner, `select public.course_gradebook(${q(runA)})`),
    /42501/,
  );
  await sql(`update private.company_participant_memberships set status='removed'
    where organisation_id=${q(a)} and user_id=${q(learner)}`);
  assert.deepEqual(
    (await list(learner)).map(({ id }) => id),
    [runB],
  );
  assert.equal(
    (await list(admin)).find(({ id }) => id === runA).lms_enabled,
    false,
  );
  console.log(
    "PASS live organisation names and next sessions with retained Standard courses and exact company membership revocation",
  );
});
