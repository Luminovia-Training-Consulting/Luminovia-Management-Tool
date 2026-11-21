/** Proves direct instructor assignment on a licensed, disposable customer database. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { signAcademyLicence } from "./academy-licence.mjs";
import { prepareAcademyInstallation } from "./academy-installation.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("academy_instructor", async ({ sql, actor }) => {
  const [
    installation,
    org,
    template,
    run,
    conflictingRun,
    admin,
    teacher,
    participant,
  ] = Array.from({ length: 8 }, randomUUID);
  const key = generateKeyPairSync("ed25519");
  const now = Date.now();
  const date = (days) => new Date(now + days * 86_400_000).toISOString();
  const terms = {
    installation_id: installation,
    edition: "customer-self-hosted",
    release_commit: "ab".repeat(20),
    issued_at: date(-2),
    starts_at: date(-1),
    expires_at: date(20),
    grace_until: date(25),
    limits: {
      seat_count: 20,
      storage_bytes: 20000000,
      api_requests_per_minute: 60,
    },
    modules: ["lms"],
  };
  const signed = signAcademyLicence(terms, key.privateKey);
  const prepared = await prepareAcademyInstallation(
    {
      envelope: signed,
      publicKey: key.publicKey,
      expected: terms,
      now,
    },
    sql,
  );
  assert.equal(prepared.licence_status, "active");
  assert.equal(prepared.customer_ready, false);
  assert.deepEqual(
    await prepareAcademyInstallation(
      {
        envelope: signed,
        publicKey: key.publicKey,
        expected: terms,
        now,
      },
      sql,
    ),
    prepared,
  );

  // The provider still uses the ordinary migrated actor and scheduling tables.
  await sql(`insert into auth.users(id,email,email_confirmed_at) values
      (${q(admin)},'academy-admin@example.invalid',now()),
      (${q(teacher)},'academy-teacher@example.invalid',now()),
      (${q(participant)},'academy-learner@example.invalid',now());
    update public.profiles set display_name='Fictional instructor' where id=${q(teacher)};
    insert into public.user_roles(user_id,role) values
      (${q(admin)},'admin'),(${q(teacher)},'lecturer'),(${q(participant)},'participant');
    insert into public.organisations(id,name) values(${q(org)},'Fictional academy');
    insert into public.course_templates(id,title) values(${q(template)},'Practical training');
    insert into public.course_runs(id,template_id,organisation_id)
      values(${q(run)},${q(template)},${q(org)}),(${q(conflictingRun)},${q(template)},${q(org)});
    insert into public.course_sessions(course_run_id,starts_at,ends_at)
      values(${q(run)},now()+interval '1 day',now()+interval '25 hours'),
        (${q(run)},now()+interval '2 days',now()+interval '49 hours'),
        (${q(conflictingRun)},now()+interval '1 day',now()+interval '26 hours');`);
  const requestId = randomUUID();
  const assign = async (who, course, target, id = requestId) =>
    JSON.parse(
      await actor(
        who,
        `select public.academy_assign_course_instructor(${q(course)},${q(target)},${q(id)})`,
      ),
    );
  await assert.rejects(assign(teacher, run, teacher), /42501/);
  assert.equal((await assign(admin, run, participant)).status, "not_eligible");

  // Test the real pre-request boundary separately: installing a verified
  // licence still does not activate remote access on initial editions.
  await assert.rejects(
    actor(
      admin,
      "select set_config('request.path','/rpc/academy_assign_course_instructor',true);select public.require_portal_access()",
    ),
    /42501/,
  );
  const candidates = await actor(
    admin,
    `select public.academy_course_instructor_candidates(${q(run)},'fictional')`,
  ).then(JSON.parse);
  assert.deepEqual(candidates, [
    { id: teacher, name: "Fictional instructor", assignment_id: null },
  ]);
  const result = await assign(admin, run, teacher);
  assert.equal(result.status, "confirmed");
  assert.deepEqual(await assign(admin, run, teacher), result);
  assert.equal(
    (await assign(admin, conflictingRun, teacher)).status,
    "idempotency_conflict",
  );
  assert.equal(
    (await assign(admin, conflictingRun, teacher, randomUUID())).status,
    "conflict",
  );
  assert.equal(
    await sql("select count(*) from public.jobs where status='filled'"),
    "1",
  );
  assert.equal(
    await sql("select count(*) from public.jobs where status='published'"),
    "0",
  );
  assert.equal(
    await sql("select count(*) from public.assignment_sessions"),
    "2",
  );
  assert.equal(
    await sql("select count(*) from private.claim_revenue_ledger"),
    "0",
  );
  assert.equal(
    await sql(
      `select count(*) from public.job_claims where id=${q(result.claim_id)} and contract_id is null and amount=0 and total_amount=0`,
    ),
    "1",
  );
  const releaseKey = randomUUID();
  const release = (who, course, request = releaseKey) =>
    actor(
      who,
      `select public.academy_release_course_instructor(${q(course)},${q(result.claim_id)},'Fictional scheduling change',${q(request)})`,
    ).then(JSON.parse);
  await assert.rejects(release(teacher, run), /42501/);
  await assert.rejects(release(admin, conflictingRun), /42501/);
  assert.deepEqual(await release(admin, run), {
    status: "cancelled",
    claim_id: result.claim_id,
  });
  assert.deepEqual(await release(admin, run), {
    status: "cancelled",
    claim_id: result.claim_id,
  });
  assert.equal(
    await sql("select count(*) from public.jobs where status='archived'"),
    "1",
  );
  assert.equal(
    await sql("select count(*) from public.jobs where status='published'"),
    "0",
  );
  assert.equal(
    await sql(
      "select count(*) from public.assignment_sessions where released_at is not null",
    ),
    "2",
  );
  assert.deepEqual(await assign(admin, run, teacher), {
    status: "cancelled",
    claim_id: result.claim_id,
  });
  assert.equal(
    (await assign(admin, run, teacher, randomUUID())).status,
    "confirmed",
  );
  console.log(
    "PASS direct instructor allocation, licence and actor boundaries, full schedule, retry, conflict rollback and zero brokerage",
  );
});
