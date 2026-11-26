/** Verify assignment lifecycle, current permissions and exact scan binding in a disposable database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("course_assignments", async ({ sql, actor }) => {
  const [
    admin,
    learner,
    peer,
    client,
    org,
    template,
    run,
    assignment,
    outsider,
  ] = Array.from({ length: 9 }, randomUUID);
  await sql(`
    insert into auth.users(id,email,email_confirmed_at) values
      ${[admin, learner, peer, client, outsider].map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
    insert into public.user_roles(user_id,role) values
      (${q(admin)},'admin'),(${q(learner)},'participant'),(${q(peer)},'participant'),(${q(client)},'client'),(${q(outsider)},'participant');
    insert into public.organisations(id,name) values (${q(org)},'Fictional assignment company');
    insert into public.client_organisation_memberships(user_id,organisation_id) values(${q(client)},${q(org)});
    insert into public.course_templates(id,title,syllabus) values(${q(template)},'Fictional course','Practical work');
    insert into public.course_runs(id,template_id,organisation_id) values(${q(run)},${q(template)},${q(org)});
    insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
      values (${q(run)},${q(learner)},'enrolled',${q(admin)}),(${q(run)},${q(peer)},'enrolled',${q(admin)}),(${q(run)},${q(outsider)},'enrolled',${q(admin)});
  `);
  for (const participant of [learner, peer, outsider]) {
    const link = randomUUID();
    await sql(`
      insert into private.company_participant_link_requests(id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
        select ${q(link)},${q(org)},${q(admin)},${q(randomUUID())},luminovia_user_id,id,'accepted',now() + interval '2 days'
        from public.profiles where id=${q(participant)};
      insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at,version)
        values(${q(org)},${q(participant)},'active',${q(link)},${q(admin)},now(),1);
    `);
  }
  const rpc = async (id, name, args) =>
    JSON.parse(
      await actor(id, `select to_jsonb(public.${name}(${args.join(",")}));`),
    );
  await rpc(admin, "set_company_premium", [
    q(org),
    "true",
    "0",
    q(randomUUID()),
  ]);
  const action = (id, command, input, version, target = assignment) =>
    rpc(id, "course_assignment_action", [
      q(run),
      q(target),
      q(command),
      q(JSON.stringify(input)),
      version,
    ]);
  const view = (id, detail = true, target = assignment) =>
    rpc(id, "course_assignments", [q(run), detail ? q(target) : "null", "0"]);
  const dueAt = new Date(Date.now() + 60_000 * 60).toISOString();
  const rubric = [
    {
      label: "Evidence",
      levels: [
        { label: "Missing", points: 0 },
        { label: "Meets criteria", points: 8 },
      ],
    },
  ];
  const definition = {
    title: "Practical lab",
    instructions: "Upload your fictional evidence.",
    due_at: dueAt,
    max_attempts: 2,
    rubric,
  };
  await assert.rejects(action(client, "save", definition, 0), /42501/);
  await assert.rejects(
    action(
      admin,
      "save",
      {
        ...definition,
        rubric: [
          {
            label: "Evidence",
            levels: [
              { label: "A", points: 2 },
              { label: "B", points: 1 },
            ],
          },
        ],
      },
      0,
    ),
    /22023/,
  );
  await action(admin, "save", definition, 0);
  assert.deepEqual((await view(learner, false)).assignments, []);
  await assert.rejects(view(learner), /42501/);
  await assert.rejects(action(admin, "publish", {}, 0), /PT409/);
  await action(admin, "publish", {}, 1);
  assert.equal((await view(learner)).detail.can_submit, true);
  await assert.rejects(view(client), /42501/);

  const digest = "a".repeat(64);
  const reserve = (id, token = randomUUID(), target = assignment) =>
    rpc(id, "reserve_course_assignment_submission", [
      q(run),
      q(target),
      q("evidence.pdf"),
      q("application/pdf"),
      "120",
      q(token),
      q(digest),
    ]);
  const token = randomUUID();
  const file = await reserve(learner, token);
  assert.deepEqual(await reserve(learner, token), file);
  assert.equal(
    (
      await rpc(learner, "course_submission_status", [
        q(run),
        q(file.document_id),
        q(file.version_id),
      ])
    ).document.kind,
    "participant_submission",
  );
  await assert.rejects(
    action(learner, "submit", { file_version_id: file.version_id }, 1),
    /42501/,
  );
  await assert.rejects(
    action(peer, "submit", { file_version_id: file.version_id }, 1),
    /42501/,
  );
  assert.deepEqual(
    (await rpc(admin, "course_submissions", [q(run), "null"])).entries,
    [],
  );
  await assert.rejects(
    rpc(client, "course_submission_access", [
      q(run),
      q(file.version_id),
      "false",
    ]),
    /42501/,
  );

  const scan = (version, verb, lease, hash, scanner) =>
    sql(
      `begin;set local role service_role;select public.course_submission_scan(${[
        version.document_id,
        version.version_id,
        verb,
        lease,
        hash,
        scanner,
      ]
        .map((value) => (value === null ? "null" : q(value)))
        .join(",")});commit;`,
    );
  const promote = async (version, verdict) => {
    const lease = await scan(version, "begin", null, digest, null);
    await scan(version, verdict, lease, digest, "ClamAV test fixture");
    await scan(version, "end", lease, null, null);
  };
  const rejected = await reserve(learner);
  await promote(rejected, "rejected");
  await assert.rejects(
    action(learner, "submit", { file_version_id: rejected.version_id }, 1),
    /42501/,
  );
  await promote(file, "clean");
  const receipt = await action(
    learner,
    "submit",
    { file_version_id: file.version_id },
    1,
  );
  assert.deepEqual(
    await action(learner, "submit", { file_version_id: file.version_id }, 1),
    receipt,
  );
  assert.equal((await view(peer)).detail.attempts.length, 0);
  assert.equal((await view(learner)).detail.can_submit, false);
  assert.equal(
    (
      await rpc(admin, "course_submission_access", [
        q(run),
        q(file.version_id),
        "false",
      ])
    ).sha256,
    digest,
  );
  await assert.rejects(
    rpc(client, "course_submission_access", [
      q(run),
      q(file.version_id),
      "false",
    ]),
    /42501/,
  );
  await assert.rejects(
    rpc(peer, "course_submission_access", [
      q(run),
      q(file.version_id),
      "false",
    ]),
    /42501/,
  );

  const review = {
    attempt_id: receipt.id,
    scores: [8],
    feedback: "Please revise the lab notes.",
    private_note: "Staff-only moderation note",
    state: "draft",
  };
  await assert.rejects(action(peer, "review", review, 0), /42501/);
  await assert.rejects(
    action(admin, "review", { ...review, scores: [7] }, 0),
    /22023/,
  );
  await action(admin, "review", review, 0);
  assert.equal((await view(learner)).detail.attempts[0].review, null);
  await assert.rejects(
    action(admin, "review", { ...review, state: "revision_requested" }, 0),
    /PT409/,
  );
  await action(admin, "review", { ...review, state: "revision_requested" }, 1);
  const resubmissionView = (await view(learner)).detail;
  assert.equal(resubmissionView.attempts[0].review.feedback, review.feedback);
  assert.equal(resubmissionView.attempts[0].review.private_note, null);
  assert.equal(resubmissionView.can_submit, true);
  assert.equal(
    await sql(
      `select count(*) from public.notifications where user_id=${q(learner)} and kind='course_assignment_feedback'`,
    ),
    "1",
  );
  await action(
    admin,
    "save",
    { ...definition, rubric: [{ ...rubric[0], label: "Updated evidence" }] },
    1,
  );
  await action(admin, "publish", {}, 2);
  assert.equal(
    (await view(learner)).detail.attempts[0].rubric[0].label,
    "Evidence",
  );
  const newer = await reserve(learner);
  const rival = await reserve(learner);
  await promote(newer, "clean");
  await promote(rival, "clean");
  const results = await Promise.allSettled(
    [newer, rival].map((version) =>
      action(learner, "submit", { file_version_id: version.version_id }, 2),
    ),
  );
  assert.equal(
    results.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  const final = results.find(({ status }) => status === "fulfilled").value;
  await action(
    admin,
    "review",
    { ...review, attempt_id: final.id, state: "released" },
    0,
  );
  assert.equal(
    (await view(learner)).detail.attempts[0].review.state,
    "released",
  );
  assert.equal((await view(learner)).detail.can_submit, false);

  const extended = new Date(Date.now() + 3 * 60_000 * 60).toISOString();
  await action(admin, "extend", { user_id: peer, due_at: extended }, 0);
  await assert.rejects(
    action(admin, "extend", { user_id: peer, due_at: extended }, 0),
    /PT409/,
  );
  assert.equal(
    Date.parse((await view(peer)).detail.effective_due_at),
    Date.parse(extended),
  );
  assert.equal(
    Date.parse((await view(learner)).detail.effective_due_at),
    Date.parse(dueAt),
  );

  const teamAssignment = randomUUID();
  const teamId = randomUUID();
  const team = {
    team_id: teamId,
    title: "Lab team",
    member_ids: [learner, peer],
    due_at: extended,
  };
  const teamAction = (id, command, input, version) =>
    action(id, command, input, version, teamAssignment);
  const teamView = async (id) => (await view(id, true, teamAssignment)).detail;
  const reserveForTeam = (id) => reserve(id, randomUUID(), teamAssignment);
  const download = (id, version) =>
    rpc(id, "course_submission_access", [q(run), q(version), "false"]);
  await teamAction(admin, "save", { ...definition, title: "Shared lab" }, 0);
  await teamAction(admin, "publish", {}, 1);
  await assert.rejects(teamAction(learner, "save_team", team, 0), /42501/);
  assert.equal((await teamAction(admin, "save_team", team, 0)).id, teamId);
  await assert.rejects(
    teamAction(
      admin,
      "save_team",
      { ...team, title: "Competing team", team_id: randomUUID() },
      0,
    ),
    /PT409/,
  );
  await assert.rejects(teamAction(admin, "save_team", team, 0), /PT409/);
  assert.deepEqual(
    new Set((await teamView(admin)).teams[0].member_ids),
    new Set([learner, peer]),
  );
  assert.equal(
    Date.parse((await teamView(peer)).effective_due_at),
    Date.parse(extended),
  );
  assert.deepEqual((await teamView(peer)).teams[0].member_ids, []);
  assert.deepEqual((await teamView(outsider)).teams, []);

  const [teamFile, otherFile] = await Promise.all([
    reserveForTeam(learner),
    reserveForTeam(peer),
  ]);
  await promote(teamFile, "clean");
  await promote(otherFile, "clean");
  await assert.rejects(download(peer, teamFile.version_id), /42501/);
  const submitted = await teamAction(
    learner,
    "submit",
    { file_version_id: teamFile.version_id },
    1,
  );
  await assert.rejects(
    teamAction(peer, "submit", { file_version_id: otherFile.version_id }, 1),
    /42501/,
  );
  assert.equal((await teamView(peer)).attempts[0].id, submitted.id);
  assert.equal((await teamView(peer)).attempts[0].team_title, team.title);
  assert.equal((await download(peer, teamFile.version_id)).sha256, digest);
  assert.equal((await teamView(peer)).teams[0].locked, true);
  assert.equal((await teamView(outsider)).attempts.length, 0);
  await assert.rejects(download(outsider, teamFile.version_id), /42501/);
  await assert.rejects(
    teamAction(admin, "remove_team", { team_id: teamId }, 1),
    /PT409/,
  );
  await assert.rejects(
    teamAction(
      admin,
      "save_team",
      { ...team, member_ids: [learner, outsider] },
      1,
    ),
    /PT409/,
  );

  const teamReview = {
    ...review,
    attempt_id: submitted.id,
    state: "revision_requested",
  };
  await teamAction(admin, "review", teamReview, 0);
  const revised = await teamAction(
    peer,
    "submit",
    { file_version_id: otherFile.version_id },
    1,
  );
  assert.equal((await teamView(learner)).attempts[0].id, revised.id);
  assert.equal((await teamView(learner)).attempts[0].attempt_no, 2);
  const completionEvidence = (id) =>
    sql(
      `select private.course_completion_assignment_released(${q(teamAssignment)},${q(id)})`,
    );
  assert.equal(await completionEvidence(learner), "f");
  await teamAction(
    admin,
    "review",
    { ...teamReview, attempt_id: revised.id, state: "released" },
    0,
  );
  assert.equal((await teamView(learner)).attempts[0].review.state, "released");
  assert.equal((await teamView(peer)).attempts[0].review.private_note, null);
  for (const member of [learner, peer]) {
    assert.equal(await completionEvidence(member), "t");
    const evidence = JSON.parse(
      await sql(
        `select private.course_weighted_source(${q(run)},${q(member)},${q(teamAssignment)})`,
      ),
    );
    assert.equal(evidence.attempt, revised.id);
    assert.equal(evidence.score, 100);
  }
  assert.equal(await completionEvidence(outsider), "f");
  assert.equal(
    await sql(
      `select count(*) from public.notifications where resource_id=${q(revised.id)} and kind='course_assignment_feedback'`,
    ),
    "2",
  );

  await sql(
    `update public.course_enrolments set status='removed' where course_run_id=${q(run)} and user_id=${q(learner)};`,
  );
  await assert.rejects(view(learner), /42501/);
  await assert.rejects(teamView(learner), /42501/);
  assert.equal(await completionEvidence(learner), "f");
  await assert.rejects(download(learner, otherFile.version_id), /42501/);
  assert.equal((await download(peer, teamFile.version_id)).sha256, digest);
  await assert.rejects(
    rpc(learner, "course_submission_access", [
      q(run),
      q(file.version_id),
      "false",
    ]),
    /42501/,
  );
  assert.equal(
    await sql(
      "select has_function_privilege('anon','public.course_assignment_action(uuid,uuid,text,jsonb,integer)','execute')",
    ),
    "f",
  );
  console.log(
    "PASS individual and team assignment publication, exact scans, current membership, shared revisions and feedback, notifications and revocation",
  );
});
