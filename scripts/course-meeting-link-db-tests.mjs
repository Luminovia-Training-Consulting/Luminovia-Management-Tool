/** Exercises current course scopes, publication and audit against an owned PostgreSQL replay. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("course_meeting_link", async ({ actor, sql }) => {
  const [
    manager,
    teacher,
    learner,
    client,
    unrelated,
    company,
    otherCompany,
    template,
    run,
    onsite,
    foreign,
    session,
    job,
    claim,
  ] = Array.from({ length: 14 }, randomUUID);
  const venue = "https://training.example.invalid/scheduled";
  const firstUrl =
    "https://training.example.invalid:444/Join%20Now?pwd=one#classroom";
  const secondUrl = "https://other.example.invalid/j/345?pwd=two";
  await sql(`
    insert into auth.users(id,email,email_confirmed_at) values
      ${[manager, teacher, learner, client, unrelated]
        .map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`)
        .join(",")};
    insert into public.user_roles(user_id,role) values
      (${q(manager)},'admin'),(${q(teacher)},'lecturer'),(${q(learner)},'participant'),
      (${q(client)},'client'),(${q(unrelated)},'lecturer');
    insert into public.organisations(id,name) values
      (${q(company)},'Fictional academy A'),(${q(otherCompany)},'Fictional academy B');
    insert into public.client_organisation_memberships(user_id,organisation_id)
      values (${q(client)},${q(company)});
    insert into public.course_templates(id,title) values (${q(template)},'Fictional course');
    insert into public.course_runs(id,template_id,organisation_id,delivery_type,venue) values
      (${q(run)},${q(template)},${q(company)},'online',${q(venue)}),
      (${q(onsite)},${q(template)},${q(company)},'onsite','Fictional location'),
      (${q(foreign)},${q(template)},${q(otherCompany)},'online','');
    insert into public.course_sessions(id,course_run_id,starts_at,ends_at)
      values (${q(session)},${q(run)},now()+interval '1 day',now()+interval '2 days');
    insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms)
      values (${q(job)},${q(run)},'Fictional teaching assignment','Fictional customer','online','filled',100,'EUR','fixed_total',100,'Fictional terms');
    insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version)
      values (${q(claim)},${q(job)},${q(teacher)},${q(randomUUID())},100,'EUR','fixed_total',100,'Fictional terms',1);
    insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at)
      select ${q(claim)},${q(teacher)},starts_at,ends_at from public.course_sessions where id=${q(session)};
  `);
  const toggle = (enabled, version, organisation = company) =>
    actor(
      manager,
      `select public.set_company_premium(${q(organisation)},${enabled},${version},${q(randomUUID())})`,
    );
  const workspace = (who, course = run) =>
    actor(who, `select public.course_workspace(${q(course)})`).then(JSON.parse);
  const save = (who, url, version, course = run) =>
    actor(
      who,
      `select public.set_course_meeting_link(${q(course)},${url === null ? "null" : q(url)},${version})`,
    ).then(JSON.parse);

  await assert.rejects(save(teacher, firstUrl, 0), /premium/i);
  await toggle(true, 0);
  await toggle(true, 0, otherCompany);
  const identity = await sql(
    `select luminovia_user_id from public.profiles where id=${q(learner)}`,
  );
  await actor(
    manager,
    `select public.request_company_participant_link(${q(company)},${q(identity)},${q(randomUUID())})`,
  );
  await actor(
    learner,
    `select public.accept_company_participant_invitation(${q(company)},1,${q(randomUUID())})`,
  );
  await actor(
    manager,
    `select public.manage_course_enrolment(${q(run)},${q(learner)},'enrolled')`,
  );

  const original = await workspace(teacher);
  assert.deepEqual(original.meeting_link, {
    url: null,
    version: 0,
    can_edit: true,
  });
  assert.equal(original.venue, venue);
  await assert.rejects(save(unrelated, firstUrl, 0), /unavailable/i);
  await assert.rejects(save(teacher, firstUrl, 0, foreign), /unavailable/i);
  await assert.rejects(save(learner, firstUrl, 0), /editor required/i);
  assert.equal((await workspace(client)).meeting_link.can_edit, true);
  await assert.rejects(save(client, firstUrl, 0, foreign), /unavailable/i);
  assert.equal((await workspace(manager, onsite)).meeting_link, null);
  await assert.rejects(save(manager, firstUrl, 0, onsite), /unavailable/i);
  await assert.rejects(workspace(learner, foreign), /unavailable/i);
  console.log(
    "PASS scoped lecturer editing and current enrolled learner access",
  );

  for (const invalid of [
    "https:training.example.invalid",
    "https://user@training.example.invalid",
    "https://secret:password@training.example.invalid",
    "https://training.example.invalid\\path",
    "https://training.example.invalid/with space",
    "https://training.example.invalid/\u0009path",
    "https://training.example.invalid:65536/",
    "https://training.example.invalid:0/",
    "https://training..invalid/",
    "https://training.example.invalid/" + "x".repeat(2048),
    "http://training.example.invalid",
    "javascript:alert(1)",
    "",
  ]) {
    await assert.rejects(
      save(teacher, invalid, 0),
      /Invalid HTTPS course meeting link/i,
    );
  }
  assert.deepEqual(await save(client, firstUrl, 0), {
    url: firstUrl,
    version: 1,
    can_edit: true,
  });
  assert.deepEqual((await workspace(learner)).meeting_link, {
    url: firstUrl,
    version: 1,
    can_edit: false,
  });
  assert.equal((await workspace(client)).meeting_link.url, firstUrl);
  await actor(
    manager,
    "select public.save_assignment_customer_settings('management_only',168,0)",
  );
  assert.equal((await workspace(teacher)).meeting_link, null);
  assert.equal((await workspace(teacher)).venue, "");
  assert.equal((await workspace(learner)).meeting_link.url, firstUrl);
  assert.equal((await workspace(client)).meeting_link.url, firstUrl);
  await assert.rejects(save(teacher, secondUrl, 1), /unavailable/i);
  await actor(
    manager,
    "select public.save_assignment_customer_settings('scheduled',168,1)",
  );
  assert.equal((await workspace(teacher)).meeting_link.url, firstUrl);
  assert.equal((await workspace(learner)).venue, venue);
  assert.deepEqual(
    (await workspace(learner)).sessions.map(({ id }) => id),
    [session],
  );
  assert.ok(
    !(await actor(learner, "select public.my_course_workspaces()")).includes(
      firstUrl,
    ),
  );
  await assert.rejects(
    save(manager, secondUrl, 0),
    /PT409: Course meeting link changed/i,
  );
  assert.equal((await save(manager, firstUrl, 1)).version, 1);
  assert.equal((await save(manager, secondUrl, 1)).version, 2);
  assert.equal((await workspace(learner)).meeting_link.url, secondUrl);
  console.log(
    "PASS HTTPS validation, exact links, unchanged locations and sessions, and version conflicts",
  );

  await toggle(false, 1);
  const learnerStandard = await workspace(learner);
  assert.equal(learnerStandard.access.learner, true);
  for (const who of [manager, teacher, client, learner]) {
    const standard = await workspace(who);
    assert.equal(standard.lms_enabled, false);
    assert.equal(standard.meeting_link, null);
    assert.equal(standard.venue, "");
    assert.deepEqual(
      standard.sessions.map(({ id }) => id),
      [session],
    );
  }
  await assert.rejects(save(teacher, firstUrl, 2), /premium/i);
  await assert.rejects(save(client, firstUrl, 2), /premium/i);
  await toggle(true, 2);
  assert.equal((await workspace(learner)).meeting_link.url, secondUrl);

  await sql(
    `update public.job_claims set status='cancelled' where id=${q(claim)}`,
  );
  await assert.rejects(save(teacher, firstUrl, 2), /unavailable/i);
  await assert.rejects(workspace(teacher), /unavailable/i);
  await sql(`update public.course_sessions set starts_at=now()-interval '2 days',
    ends_at=now()-interval '1 day' where id=${q(session)}`);
  assert.equal((await workspace(learner)).meeting_link, null);
  await assert.rejects(save(manager, firstUrl, 2), /unavailable/i);
  await sql(`update public.course_sessions set starts_at=now()+interval '1 day',
    ends_at=now()+interval '2 days' where id=${q(session)}`);
  assert.deepEqual(await save(manager, null, 2), {
    url: null,
    version: 3,
    can_edit: true,
  });
  assert.deepEqual((await workspace(learner)).meeting_link, {
    url: null,
    version: 3,
    can_edit: false,
  });
  assert.deepEqual(
    JSON.parse(
      await sql(`select jsonb_agg(details order by (details->>'version')::integer)
      from public.audit_events where action='course.meeting_link.updated' and resource_id=${q(run)}`),
    ),
    [
      { version: 1, configured: true },
      { version: 2, configured: true },
      { version: 3, configured: false },
    ],
  );
  await assert.rejects(
    actor(learner, "select * from private.course_meeting_links"),
    /permission denied/i,
  );
  assert.equal(
    await sql(
      `select has_function_privilege('anon','public.set_course_meeting_link(uuid,text,integer)','execute')`,
    ),
    "f",
  );
  console.log(
    "PASS live Premium and instructor revocations, ended courses, clear and URL-free audit",
  );
});
