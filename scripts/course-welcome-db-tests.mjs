import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("course_welcome_test", async ({ sql, actor }) => {
  const [
    admin,
    client,
    stranger,
    learner,
    organisation,
    template,
    run,
    association,
  ] = Array.from({ length: 8 }, randomUUID);
  await sql(`
      insert into auth.users(id,email,email_confirmed_at)
      values ${[admin, client, stranger, learner].map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles values
        (${q(admin)},'admin'),(${q(client)},'client'),(${q(stranger)},'client'),(${q(learner)},'participant');
      insert into public.organisations(id,name) values (${q(organisation)},'Fictional academy');
      insert into public.client_organisation_memberships(user_id,organisation_id) values (${q(client)},${q(organisation)});
      insert into public.course_templates(id,title) values (${q(template)},'Fictional course');
      insert into public.course_runs(id,template_id,organisation_id) values (${q(run)},${q(template)},${q(organisation)});
      insert into private.company_participant_link_requests(
        id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at
      ) values (
        ${q(association)},${q(organisation)},${q(admin)},${q(randomUUID())},
        (select luminovia_user_id from public.profiles where id=${q(learner)}),${q(learner)},'accepted',now()+interval '1 day'
      );
      insert into private.company_participant_memberships(
        organisation_id,user_id,status,link_request_id,invited_by,joined_at,version
      ) values (${q(organisation)},${q(learner)},'active',${q(association)},${q(admin)},now(),1);
      insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
        values (${q(run)},${q(learner)},'enrolled',${q(admin)});
    `);
  const fetch = (who) =>
    actor(who, `select public.course_welcome_content(${q(run)})`).then(
      JSON.parse,
    );
  const publish = (who, version, description) =>
    actor(
      who,
      `select public.publish_course_welcome_content(${q(run)},${q(description)},'Objective','Join here',${version})`,
    ).then(JSON.parse);
  const toggle = (enabled, version) =>
    actor(
      admin,
      `select public.set_company_premium(${q(organisation)},${enabled},${version},${q(randomUUID())})`,
    ).then(JSON.parse);
  await assert.rejects(fetch(client), /welcome unavailable/i);
  assert.equal((await toggle(true, 0)).status, "updated");
  assert.equal((await fetch(client)).version, 0);
  assert.equal((await publish(client, 0, "First version")).version, 1);
  assert.equal((await fetch(learner)).description, "First version");
  await assert.rejects(fetch(stranger), /Course unavailable/i);
  await assert.rejects(publish(learner, 1, "Learner edit"), /editor required/i);
  await assert.rejects(publish(client, 0, "Stale edit"), /welcome changed/i);
  assert.equal((await publish(admin, 1, "Current version")).version, 2);
  assert.equal((await toggle(false, 1)).status, "updated");
  await assert.rejects(fetch(learner), /Course unavailable/i);
  await assert.rejects(fetch(admin), /welcome unavailable/i);
  assert.equal(
    await sql(
      `select count(*) from private.course_welcome_revisions where course_run_id=${q(run)}`,
    ),
    "2",
  );
  assert.equal((await toggle(true, 2)).status, "updated");
  assert.equal((await fetch(learner)).description, "Current version");
  console.log(
    "PASS versioned course welcome, editor scope, conflict, learner isolation and Premium retention",
  );
});
