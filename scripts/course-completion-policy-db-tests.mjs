/** Verify policy versions and the shared status/issuance decision using synthetic course evidence. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("lms_completion_policy", async ({ sql, actor }) => {
  const [
    manager,
    learner,
    legacy,
    future,
    org,
    template,
    run,
    session,
    assignment,
    attempt,
    framework,
    guided,
    independent,
    competency,
  ] = Array.from({ length: 14 }, randomUUID);
  const accounts = [
    [manager, "admin"],
    ...[learner, legacy, future].map((id) => [id, "participant"]),
  ];
  await sql(`
    insert into auth.users(id,email,email_confirmed_at) values
      ${accounts.map(([id]) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
    insert into public.user_roles(user_id,role) values
      ${accounts.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
    insert into public.organisations(id,name) values (${q(org)},'Fictional completion company');
    insert into public.course_templates(id,title) values(${q(template)},'Fictional completion course');
    insert into public.course_runs(id,template_id,organisation_id) values(${q(run)},${q(template)},${q(org)});
    insert into public.course_sessions(id,course_run_id,starts_at,ends_at)
      values(${q(session)},${q(run)},date_trunc('minute',now())-interval '2 hours',date_trunc('minute',now())-interval '1 hour');
    insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
      values (${q(run)},${q(legacy)},'completed',${q(manager)});
    insert into private.course_assignments(id,run_id,current_version,published_version) values
      (${q(assignment)},${q(run)},1,1);
    insert into private.course_assignment_definitions(assignment_id,version,title,instructions,due_at,max_attempts,rubric)
      values(${q(assignment)},1,'Demonstrate evidence','Synthetic evidence',now(),2,'[]');
  `);
  for (const participant of [learner, legacy, future]) {
    const link = randomUUID();
    await sql(`
      insert into private.company_participant_link_requests(id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
        select ${q(link)},${q(org)},${q(manager)},${q(randomUUID())},luminovia_user_id,id,'accepted',now() + interval '2 days'
        from public.profiles where id=${q(participant)};
      insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at,version)
        values(${q(org)},${q(participant)},'active',${q(link)},${q(manager)},now(),1);
    `);
  }
  const rpc = async (id, endpoint, args, method = "POST") =>
    JSON.parse(
      await actor(
        id,
        `set local request.path=${q("/rpc/" + endpoint)};
      set local request.method=${q(method)};
      select public.require_portal_access();
      select to_jsonb(public.${endpoint}(${args.join(",")}));`,
      ),
    );
  const status = (id, subject = null) =>
    rpc(
      id,
      "course_completion_status",
      [q(run), subject ? q(subject) : "null"],
      "GET",
    );
  const edit = (id, verb, payload, expected) =>
    rpc(id, "course_completion_policy_action", [
      q(run),
      q(verb),
      q(JSON.stringify(payload)),
      expected,
    ]);
  const policy = (id) => rpc(id, "course_completion_policy", [q(run)], "GET");
  const competencyAction = (verb, input, revision = 0) =>
    rpc(manager, "course_competency_action", [
      q(run),
      q(verb),
      q(JSON.stringify(input)),
      revision,
    ]);
  const workspace = (id, verb, input = {}, revision = 0) =>
    rpc(id, "course_workspace_action", [
      q(run),
      q(verb),
      q(JSON.stringify(input)),
      revision,
    ]);
  const enroll = (id) =>
    actor(
      manager,
      `set local request.path='/rpc/manage_course_enrolment';
      set local request.method='POST';
      select public.require_portal_access();
      select public.manage_course_enrolment(${q(run)}, ${q(id)}, 'completed');`,
    );
  const attendance = (id, minutes, revision = 0) =>
    workspace(
      manager,
      "attendance_verify",
      {
        session_id: session,
        user_id: id,
        state: "attended",
        minutes,
        reason: "Fictional verified attendance",
      },
      revision,
    );
  await rpc(manager, "set_company_premium", [
    q(org),
    "true",
    "0",
    q(randomUUID()),
  ]);
  await competencyAction("save_framework", {
    id: framework,
    content: {
      title: "Fictional competency framework",
      levels: [
        { id: guided, title: "Guided" },
        { id: independent, title: "Independent" },
      ],
      competencies: [
        { id: competency, code: "LAB", title: "Demonstrates evidence" },
      ],
    },
  });
  await competencyAction("pin", {
    framework_id: framework,
    framework_revision: 1,
  });

  const first = {
    attendance_percent: 60,
    assignment_id: assignment,
    competency_pin: 1,
    competency_id: competency,
    minimum_level_id: independent,
    lecturer_verification: true,
    target_at: "2026-01-05T10:00:00Z",
  };
  const second = { ...first, attendance_percent: 100 };
  const latest = await policy(manager);
  assert.equal(latest.head, null);
  assert.equal(latest.framework.pin_version, 1);
  assert.deepEqual(latest.assignments, [
    { id: assignment, title: "Demonstrate evidence" },
  ]);
  assert.equal((await status(legacy)).rule_version, 1);
  assert.equal("policy" in (await status(legacy)), false);
  await assert.rejects(policy(legacy), /42501/);
  await assert.rejects(edit(legacy, "publish", first, 0), /42501/);
  await assert.rejects(
    edit(manager, "publish", { ...first, attendance_percent: 0 }, 0),
    /22023/,
  );
  assert.equal(await edit(manager, "publish", first, 0), 1);

  await enroll(learner);
  const publishRace = await Promise.allSettled([
    edit(manager, "publish", second, 1),
    edit(manager, "publish", second, 1),
  ]);
  assert.equal(
    publishRace.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  assert.match(
    String(publishRace.find(({ status }) => status === "rejected").reason),
    /PT409/,
  );
  await enroll(future);
  assert.equal((await status(learner)).policy.version, 1);
  assert.equal((await status(future)).policy.version, 2);
  assert.equal((await status(legacy)).rule_version, 1);
  await assert.rejects(status(future, learner), /42501/);
  await assert.rejects(
    edit(manager, "pin", { user_id: learner, policy_version: 1 }, 1),
    /PT409/,
  );

  await attendance(legacy, 48);
  assert.equal((await status(legacy)).state, "ready");
  const legacyReceipt = await workspace(legacy, "completion_issue");
  assert.equal(
    await sql(
      `select snapshot ? 'completion_policy_version' from private.course_completion_records where id=${q(legacyReceipt.id)}`,
    ),
    "f",
  );
  await assert.rejects(
    edit(manager, "pin", { user_id: legacy, policy_version: 2 }, 0),
    /PT409/,
  );

  await attendance(learner, 36);
  await attendance(future, 36);
  assert.equal((await status(learner)).verified_count, 1);
  assert.equal((await status(future)).verified_count, 0);
  assert.equal((await status(learner)).policy.assignment.met, false);
  const assignmentException = {
    user_id: learner,
    policy_version: 1,
    requirement: "assignment",
    accepted: true,
    reason: "Staff-only alternative assignment evidence",
  };
  await assert.rejects(
    edit(future, "exception", assignmentException, 0),
    /42501/,
  );
  await assert.rejects(
    edit(
      manager,
      "exception",
      { ...assignmentException, requirement: "attendance" },
      0,
    ),
    /22023/,
  );
  assert.equal(await edit(manager, "exception", assignmentException, 0), 1);
  assert.deepEqual((await status(learner)).policy.assignment.exception, {
    accepted: true,
    revision: 1,
  });
  assert.equal((await status(learner)).policy.assignment.met, false);
  assert.equal((await status(learner)).state, "pending");
  await assert.rejects(
    edit(manager, "exception", { ...assignmentException, accepted: false }, 0),
    /PT409/,
  );
  assert.equal(
    await edit(
      manager,
      "exception",
      { ...assignmentException, accepted: false },
      1,
    ),
    2,
  );
  assert.equal(
    (await status(learner)).policy.assignment.exception.accepted,
    false,
  );
  await sql(`
    insert into private.course_assignment_attempts(id,assignment_id,assignment_version,user_id,attempt_no,file_name)
      values(${q(attempt)},${q(assignment)},1,${q(learner)},1,'synthetic-evidence.txt');
    insert into private.course_assignment_reviews(attempt_id,version,state,scores,feedback,private_note)
      values(${q(attempt)},1,'draft','[]','','Staff-only review');
  `);
  assert.equal((await status(learner)).policy.assignment.met, false);
  await sql(`
    insert into private.course_assignment_reviews(attempt_id,version,state,scores,feedback,private_note)
      values(${q(attempt)},2,'released','[]','Released assessment','Staff-only review');
  `);
  assert.equal((await status(learner)).policy.assignment.met, true);
  await competencyAction("assess", {
    pin_revision: 1,
    user_id: learner,
    competency_id: competency,
    level_id: guided,
    evidence_note: "Synthetic guided observation",
    include_quiz: false,
  });
  assert.equal((await status(learner)).policy.competency.met, false);
  await competencyAction(
    "assess",
    {
      pin_revision: 1,
      user_id: learner,
      competency_id: competency,
      level_id: independent,
      evidence_note: "Synthetic independent observation",
      include_quiz: false,
    },
    1,
  );
  assert.equal((await status(learner)).policy.competency.met, true);
  assert.equal((await status(learner)).state, "pending");
  await assert.rejects(workspace(learner, "completion_issue"), /22023/);

  const proof = {
    user_id: learner,
    policy_version: 1,
    accepted: true,
    reason: "Staff-only verification reason",
  };
  await assert.rejects(edit(future, "verify", proof, 0), /42501/);
  assert.equal(await edit(manager, "verify", proof, 0), 1);
  await assert.rejects(edit(manager, "verify", proof, 0), /PT409/);
  const verified = await status(learner);
  assert.equal(verified.state, "ready");
  for (const secret of ["Staff-only", "observation", "synthetic-evidence.txt"])
    assert.equal(JSON.stringify(verified).includes(secret), false);
  assert.equal(
    await edit(manager, "verify", { ...proof, accepted: false }, 1),
    2,
  );
  assert.equal((await status(learner)).state, "pending");
  await assert.rejects(workspace(learner, "completion_issue"), /22023/);
  assert.equal(await edit(manager, "verify", proof, 2), 3);

  const issued = await workspace(learner, "completion_issue");
  assert.equal((await workspace(learner, "completion_issue")).id, issued.id);
  assert.equal((await status(manager, learner)).state, "issued");
  assert.equal((await status(learner)).state, "issued");
  assert.equal(
    await sql(
      `select snapshot->>'completion_policy_version' from private.course_completion_records where id=${q(issued.id)}`,
    ),
    "1",
  );
  await assert.rejects(
    edit(manager, "pin", { user_id: learner, policy_version: 2 }, 1),
    /PT409/,
  );
  await assert.rejects(
    edit(manager, "verify", { ...proof, accepted: false }, 3),
    /PT409/,
  );
  await assert.rejects(
    edit(manager, "exception", assignmentException, 2),
    /PT409/,
  );
  const futureException = {
    ...assignmentException,
    user_id: future,
    policy_version: 2,
  };
  assert.equal(await edit(manager, "exception", futureException, 0), 1);
  assert.equal(
    await edit(
      manager,
      "exception",
      { ...futureException, requirement: "competency" },
      0,
    ),
    1,
  );
  assert.equal(
    await edit(
      manager,
      "verify",
      { ...proof, user_id: future, policy_version: 2 },
      0,
    ),
    1,
  );
  assert.equal((await status(future)).state, "pending");
  await assert.rejects(workspace(future, "completion_issue"), /22023/);
  await attendance(future, 60, 1);
  const waived = await status(future);
  assert.equal(waived.policy.assignment.met, false);
  assert.equal(waived.policy.competency.met, false);
  assert.equal(waived.state, "ready");
  const waivedReceipt = await workspace(future, "completion_issue");
  assert.deepEqual(
    JSON.parse(
      await sql(`select jsonb_build_array(
    snapshot->'assignment_exception_revision', snapshot->'competency_exception_revision')
    from private.course_completion_records where id=${q(waivedReceipt.id)}`),
    ),
    [1, 1],
  );
  console.log(
    "Versioned completion policy, legacy and pinned receipts, assignment, competency, individual exceptions and course-staff verification passed.",
  );
});
