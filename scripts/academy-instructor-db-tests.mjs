/** Exercises dedicated academy licence, course access and assignments on disposable databases. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { signAcademyLicence } from "./academy-licence.mjs";
import { prepareAcademyInstallation } from "./academy-installation.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const gate = (name, method = "POST", headers = {}) =>
  `set local request.path=${q(`/rpc/${name}`)}; set local request.method=${q(method)};
    set local request.headers=${q(JSON.stringify(headers))}; select public.require_portal_access();`;
const configure = (id, release, enabled = true) =>
  `select private.configure_academy_course_access(${q(id)},${q(release)},${enabled})`;

const checkCourseAccess = async ({ sql, actor }, edition) => {
  const [
    installation,
    org,
    template,
    run,
    conflictingRun,
    admin,
    teacher,
    participant,
    guest,
    foreign,
    membership,
  ] = Array.from({ length: 11 }, randomUUID);
  const key = generateKeyPairSync("ed25519");
  const now = Date.now();
  const date = (days) => new Date(now + days * 86_400_000).toISOString();
  const terms = {
    installation_id: installation,
    edition,
    release_commit: "ab".repeat(20),
    issued_at: date(-8),
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
      (${q(participant)},'academy-learner@example.invalid',now()),
      (${q(guest)},'academy-guest@example.invalid',now()),
      (${q(foreign)},'academy-other-learner@example.invalid',now());
    update public.profiles set display_name='Fictional instructor' where id=${q(teacher)};
    insert into public.user_roles(user_id,role) values
      (${q(admin)},'admin'),(${q(teacher)},'lecturer'),(${q(participant)},'participant'),
      (${q(guest)},'guest'),(${q(foreign)},'participant');
    insert into public.organisations(id,name) values(${q(org)},'Fictional academy');
    insert into public.course_templates(id,title) values(${q(template)},'Practical training');
    insert into public.course_runs(id,template_id,organisation_id)
      values(${q(run)},${q(template)},${q(org)}),(${q(conflictingRun)},${q(template)},${q(org)});
    insert into public.course_sessions(course_run_id,starts_at,ends_at)
      values(${q(run)},now()+interval '1 day',now()+interval '25 hours'),
        (${q(run)},now()+interval '2 days',now()+interval '49 hours'),
        (${q(conflictingRun)},now()+interval '1 day',now()+interval '26 hours');
    insert into private.company_participant_link_requests(
      id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at
    ) select ${q(membership)},${q(org)},${q(admin)},${q(randomUUID())},luminovia_user_id,id,'accepted',now()+interval '2 days'
      from public.profiles where id=${q(participant)};
    insert into private.company_participant_memberships(
      organisation_id,user_id,status,link_request_id,invited_by,joined_at
    ) values(${q(org)},${q(participant)},'active',${q(membership)},${q(admin)},now());`);
  const call = (who, endpoint, args = [], method = "POST") =>
    actor(
      who,
      `${gate(endpoint, method)} select public.${endpoint}(${args.map(q).join(",")})`,
    );
  const workspace = (who, course) =>
    call(who, "course_workspace", [course], "GET").then(JSON.parse);
  const workspaces = (who) =>
    call(who, "my_course_workspaces").then(JSON.parse);
  const enrol = (who, target, status = "enrolled") =>
    call(who, "manage_course_enrolment", [run, target, status]);
  const candidateConfiguration = configure(installation, terms.release_commit);
  await assert.rejects(actor(admin, candidateConfiguration), /42501/);
  await assert.rejects(
    sql(`set role service_role;${candidateConfiguration}`),
    /42501/,
  );
  await assert.rejects(
    sql(configure(randomUUID(), terms.release_commit)),
    /55000/,
  );
  await assert.rejects(sql(configure(installation, "ee".repeat(20))), /55000/);
  await assert.rejects(workspace(admin, run), /42501/);
  await assert.rejects(enrol(admin, participant), /42501/);
  await assert.rejects(
    actor(
      admin,
      `select public.manage_course_enrolment(${q(run)},${q(participant)},'enrolled')`,
    ),
    /42501/,
  );
  const requestId = randomUUID();
  const assign = async (who, course, target, id = requestId) =>
    call(who, "academy_assign_course_instructor", [course, target, id]).then(
      JSON.parse,
    );
  await assert.rejects(assign(admin, run, teacher), /42501/);
  await sql(candidateConfiguration);
  await sql(candidateConfiguration);
  assert.deepEqual(
    JSON.parse(await sql("select public.installation_capabilities()")),
    prepared,
  );
  await assert.rejects(workspaces(guest), /42501/);
  for (const role of ["anon", "service_role"]) {
    await assert.rejects(
      sql(
        `begin;set local role ${role};${gate("my_course_workspaces")};commit;`,
      ),
      /42501/,
    );
  }
  for (const endpoint of [
    "set_company_premium",
    "company_premium_settings",
    "commission_report",
    "search_portal",
    "course_workspace_action",
    "course_document_access",
    "set_course_meeting_link",
    "repeat_client_request",
    "course_chat_rooms",
    "company_course_webhook_subscribe",
    "account_me",
  ]) {
    await assert.rejects(actor(admin, gate(endpoint)), /42501/);
  }
  for (const [path, method] of [
    ["/jobs", "GET"],
    ["/profiles", "GET"],
    ["/", "GET"],
    ["/rpc/course_workspace/", "GET"],
    ["/rpc/course_workspace", "PATCH"],
    ["/rpc/academy_assign_course_instructor", "GET"],
  ]) {
    await assert.rejects(
      actor(
        admin,
        `set local request.path=${q(path)};set local request.method=${q(method)};select public.require_portal_access()`,
      ),
      /42501/,
    );
  }
  for (const header of ["accept-profile", "content-profile"]) {
    await assert.rejects(
      actor(
        admin,
        gate("course_workspace", "POST", { [header]: "graphql_public" }),
      ),
      /42501/,
    );
  }
  await assert.rejects(assign(teacher, run, teacher), /42501/);
  assert.equal((await assign(admin, run, participant)).status, "not_eligible");

  const candidates = await call(
    admin,
    "academy_course_instructor_candidates",
    [run, "fictional"],
    "GET",
  ).then(JSON.parse);
  assert.deepEqual(candidates, [
    { id: teacher, name: "Fictional instructor", assignment_id: null },
  ]);
  assert.equal(
    await sql(`select private.company_premium_enabled(${q(org)})`),
    "f",
  );
  const adminView = await workspace(admin, run);
  assert.equal(adminView.lms_enabled, true);
  assert.deepEqual(adminView.meeting_link, {
    url: null,
    can_edit: false,
    version: 0,
  });
  await assert.rejects(workspace(teacher, run), /42501/);
  await assert.rejects(workspace(participant, run), /42501/);
  await assert.rejects(enrol(teacher, participant), /42501/);
  await assert.rejects(enrol(admin, foreign), /42501/);
  assert.deepEqual(
    (
      await call(admin, "course_enrolment_candidates", [run], "GET").then(
        JSON.parse,
      )
    ).map(({ user_id }) => user_id),
    [participant],
  );
  await enrol(admin, participant);
  const participantView = await workspace(participant, run);
  assert.equal(participantView.access.learner, true);
  assert.equal(participantView.access.staff, false);
  assert.deepEqual(participantView.roster, []);
  assert.equal(participantView.repeat_request, null);
  assert.deepEqual(
    (await workspaces(participant)).map(({ id }) => id),
    [run],
  );
  assert.deepEqual(await workspaces(foreign), []);
  await assert.rejects(workspace(participant, conflictingRun), /42501/);
  await assert.rejects(
    call(participant, "course_enrolments", [run], "GET"),
    /42501/,
  );
  assert.deepEqual(
    (await call(admin, "course_enrolments", [run], "GET").then(JSON.parse)).map(
      ({ user_id }) => user_id,
    ),
    [participant],
  );
  await enrol(admin, participant, "removed");
  await assert.rejects(workspace(participant, run), /42501/);
  await enrol(admin, participant);
  const result = await assign(admin, run, teacher);
  assert.equal(result.status, "confirmed");
  assert.equal((await workspace(teacher, run)).access.teacher, true);
  assert.deepEqual(
    (await workspaces(teacher)).map(({ id }) => id),
    [run],
  );
  await assert.rejects(workspace(teacher, conflictingRun), /42501/);
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
    call(who, "academy_release_course_instructor", [
      course,
      result.claim_id,
      "Fictional scheduling change",
      request,
    ]).then(JSON.parse);
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
  await assert.rejects(workspace(teacher, run), /42501/);
  assert.deepEqual(await workspaces(teacher), []);
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
  const renew = (changes) => {
    const renewal = { ...terms, ...changes };
    return sql(
      `select private.apply_verified_installation_licence(${q(JSON.stringify(renewal))}::jsonb)`,
    );
  };
  // Apply successively issued fixtures, exercising the actual release binding.
  const nextRelease = "11".repeat(20);
  await renew({ release_commit: nextRelease, issued_at: date(-7) });
  await assert.rejects(workspaces(admin), /42501/);
  await sql(configure(installation, nextRelease));
  await sql(configure(installation, terms.release_commit, false));
  assert.equal((await workspace(participant, run)).access.learner, true);
  await renew({
    release_commit: nextRelease,
    issued_at: date(-6),
    starts_at: date(-5),
    expires_at: date(-2),
  });
  assert.equal((await workspace(participant, run)).access.learner, true);
  await assert.rejects(assign(admin, run, teacher), /42501/);
  await assert.rejects(enrol(admin, participant, "removed"), /42501/);
  await assert.rejects(sql(configure(installation, nextRelease)), /55000/);
  await assert.rejects(
    actor(
      admin,
      `select public.manage_course_enrolment(${q(run)},${q(participant)},'removed')`,
    ),
    /42501/,
  );
  await renew({
    release_commit: nextRelease,
    issued_at: date(-5),
    starts_at: date(-4),
    expires_at: date(-2),
    grace_until: date(-1),
  });
  await assert.rejects(workspaces(participant), /42501/);
  await assert.rejects(workspace(admin, run), /42501/);
  assert.equal(
    await sql(
      "select count(*) from public.course_enrolments where status='enrolled'",
    ),
    "1",
  );
  assert.equal(
    await sql(
      "select count(*) from private.academy_course_instructors where released_at is null",
    ),
    "1",
  );
  await renew({ release_commit: nextRelease, issued_at: date(-4) });
  assert.equal((await workspace(participant, run)).access.learner, true);
  await sql(configure(installation, nextRelease, false));
  await assert.rejects(workspace(admin, run), /42501/);
  assert.equal(
    JSON.parse(await sql("select public.installation_capabilities()"))
      .customer_ready,
    false,
  );
  console.log(
    `PASS ${edition} course scope, assignments, enrolments, release binding, grace/read-only, expiry and dormant browser`,
  );
};

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_instructor", (db) =>
    checkCourseAccess(db, edition),
  );
}
