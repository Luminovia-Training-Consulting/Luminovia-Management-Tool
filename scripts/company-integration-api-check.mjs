/** Native HTTP check for isolated company keys and their separate credential boundary. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withApiFixture } from "./testing/api.mjs";
import { quoteSql as q } from "./testing/database.mjs";

await withApiFixture(async ({ actor, checked, defer, sql, url }) => {
  const admin = await actor("integration-admin", "admin");
  const blocked = await actor("integration-lecturer", "lecturer");
  const learner = await actor("integration-learner", "participant");
  const [companyA, companyB, template, courseA, courseB] = Array.from(
    { length: 5 },
    randomUUID,
  );
  defer(() =>
    sql(`
    delete from public.course_runs where id in ('${courseA}','${courseB}');
    delete from public.course_templates where id='${template}';
    delete from public.organisations where id in ('${companyA}','${companyB}');
  `),
  );
  await sql(`
    insert into public.organisations(id,name) values
      ('${companyA}','Fictional integration A'),('${companyB}','Fictional integration B');
    insert into public.course_templates(id,title) values('${template}','Fictional course listing');
    insert into public.course_runs(id,template_id,organisation_id,published) values
      ('${courseA}','${template}','${companyA}',true),
      ('${courseB}','${template}','${companyB}',true);
  `);

  const issue = (client, previous = null) =>
    client.rpc("issue_company_integration_key", {
      p_organisation_id: companyA,
      p_label: "Fictional server-only key",
      p_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      p_rotate_id: previous?.id ?? null,
      p_expected_version: previous?.version ?? null,
    });
  assert.equal((await issue(blocked.client)).error?.code, "42501");
  const initial = await checked(
    issue(admin.client),
    "Issue fictional organisation key",
  );
  const endpoint = new URL("/functions/v1/company-integration?limit=1", url);
  const request = (credential, headers = {}) =>
    fetch(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${credential}`, ...headers },
    });
  const first = await request(initial.credential);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.deepEqual(await first.json(), {
    items: [
      {
        id: courseA,
        title: "Fictional course listing",
        time_zone: "Europe/Berlin",
      },
    ],
    next_cursor: null,
  });
  assert.equal(
    (await request(initial.credential, { Origin: "http://127.0.0.1:5273" }))
      .status,
    403,
  );
  const rotated = await checked(
    issue(admin.client, initial),
    "Rotate fictional organisation key",
  );
  assert.equal((await request(initial.credential)).status, 401);
  assert.equal((await request(rotated.credential)).status, 200);

  const participant = await sql(
    `select luminovia_user_id from public.profiles where id=${q(learner.id)}`,
  );
  const issueScoped = (scope, previous, client = admin.client) =>
    client.rpc("issue_scoped_company_integration_key", {
      p_organisation_id: companyA,
      p_label: "Fictional LMS integration",
      p_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      p_rotate_id: previous?.id ?? null,
      p_expected_version: previous?.version ?? null,
      p_scope: scope,
    });
  assert.equal(
    (await issueScoped("reports.read", null, blocked.client)).error?.code,
    "42501",
  );
  const writer = await checked(
    issueScoped("enrolments.write"),
    "Issue enrolment key",
  );
  const reader = await checked(issueScoped("reports.read"), "Issue report key");
  assert.equal(
    (await issueScoped("enrolments.write", reader)).error?.code,
    "PT409",
  );
  const managedKeys = await checked(
    admin.client.rpc("company_integration_keys", {
      p_organisation_id: companyA,
    }),
    "List scoped keys without credentials",
  );
  assert.deepEqual(managedKeys.map((key) => key.scope).sort(), [
    "courses.read",
    "enrolments.write",
    "reports.read",
  ]);
  assert.ok(managedKeys.every((key) => !("credential" in key)));

  const enrol = (key, course = courseA) =>
    fetch(new URL("/functions/v1/company-integration/enrolments", url), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key.credential}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ course_id: course, participant_id: participant }),
    });
  const report = (key, course = courseA) =>
    fetch(
      new URL(
        `/functions/v1/company-integration/participation?course_id=${course}`,
        url,
      ),
      {
        headers: { Authorization: `Bearer ${key.credential}` },
      },
    );
  assert.equal((await request(reader.credential)).status, 401);
  assert.equal((await report(writer)).status, 401);
  assert.equal((await enrol(rotated)).status, 401);
  assert.equal((await report(reader, courseB)).status, 404);
  assert.equal((await report(reader)).status, 404, "Premium defaults to OFF");
  await sql(`insert into private.company_premium_settings(organisation_id,enabled)
    values (${q(companyA)},true) on conflict(organisation_id) do update set enabled=true;`);
  assert.equal(
    (await enrol(writer)).status,
    404,
    "A participant role alone is insufficient",
  );
  await sql(`
    with accepted as (
      insert into private.company_participant_link_requests(
        organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at
      ) values (${q(companyA)},${q(admin.id)},gen_random_uuid(),${q(participant)},${q(learner.id)},'accepted',now()+interval '1 day')
      returning id
    )
    insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at)
    select ${q(companyA)},${q(learner.id)},'active',id,${q(admin.id)},now() from accepted;`);
  assert.equal((await enrol(writer, courseB)).status, 404);
  for (const response of await Promise.all([enrol(writer), enrol(writer)])) {
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      course_id: courseA,
      participant_id: participant,
      status: "enrolled",
    });
  }
  assert.equal(
    await sql(`select count(*) from public.audit_events where resource_id=${q(courseA)}
    and details->>'integration_key_id'=${q(writer.id)}`),
    "1",
  );
  const counts = await report(reader);
  assert.equal(counts.status, 200);
  assert.deepEqual(await counts.json(), {
    course_id: courseA,
    session_count: 0,
    enrolled_count: 1,
    completed_count: 0,
  });
  await checked(
    admin.client.rpc("manage_course_enrolment", {
      p_course_run_id: courseA,
      p_user_id: learner.id,
      p_status: "removed",
    }),
    "Remove the enrolment using the portal workflow",
  );
  assert.equal((await enrol(writer)).status, 409);
  assert.equal((await (await report(reader)).json()).enrolled_count, 0);
  await sql(
    `update private.company_premium_settings set enabled=false where organisation_id=${q(companyA)};`,
  );
  assert.equal((await report(reader)).status, 404);
  assert.equal(
    (await request(rotated.credential)).status,
    200,
    "Public catalogue scope remains independent",
  );

  await checked(
    admin.client.rpc("revoke_company_integration_key", {
      p_id: rotated.id,
      p_expected_version: rotated.version,
    }),
    "Revoke fictional organisation key",
  );
  assert.equal((await request(rotated.credential)).status, 401);
  console.log(
    "PASS real Edge/REST scoped catalogue, enrolment and aggregate report, role denial, Premium OFF, foreign scope, concurrent exact retry, human removal and key rotation/revocation",
  );
});
