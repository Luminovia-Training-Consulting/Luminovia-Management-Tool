/** Exercise anonymous assignment, controlled release, safeguarding and deletion on real PostgreSQL. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("course_peer_feedback", async ({ sql, actor }) => {
  const [
    admin,
    organisation,
    foreignOrg,
    template,
    course,
    foreignCourse,
    ...learners
  ] = Array.from({ length: 10 }, randomUUID);
  const requests = learners.map(() => randomUUID());
  await sql(`
    insert into auth.users(id,email,email_confirmed_at) values
      ${[admin, ...learners].map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
    insert into public.user_roles(user_id,role) values (${q(admin)},'admin'),
      ${learners.map((id) => `(${q(id)},'participant')`).join(",")};
    insert into public.organisations(id,name) values
      (${q(organisation)},'Fictional peer course'),(${q(foreignOrg)},'Other peer course');
    insert into public.course_templates(id,title) values (${q(template)},'Fictional learning exercise');
    insert into public.course_runs(id,template_id,organisation_id,published) values
      (${q(course)},${q(template)},${q(organisation)},true),(${q(foreignCourse)},${q(template)},${q(foreignOrg)},true);
    insert into private.company_participant_link_requests(
      id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at
    ) values ${learners
      .map(
        (
          id,
          index,
        ) => `(${q(requests[index])},${q(organisation)},${q(admin)},${q(randomUUID())},
      (select luminovia_user_id from public.profiles where id=${q(id)}),${q(id)},'accepted',now()+interval '1 day')`,
      )
      .join(",")};
    insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at)
      values ${learners.map((id, index) => `(${q(organisation)},${q(id)},'active',${q(requests[index])},${q(admin)},now())`).join(",")};
    insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
      values ${learners.map((id) => `(${q(course)},${q(id)},'enrolled',${q(admin)})`).join(",")};
  `);
  const rpc = async (who, name, ...parameters) =>
    JSON.parse(
      await actor(
        who,
        `select to_jsonb(public.${name}(${parameters.join(",")}))`,
      ),
    );
  for (const org of [organisation, foreignOrg])
    await rpc(admin, "set_company_premium", q(org), "true", 0, q(randomUUID()));
  const read = (who, run = course, round) =>
    rpc(who, "course_peer_feedback", q(run), ...(round ? [round] : []));
  const command = (who, action, payload = {}) =>
    rpc(
      who,
      "course_peer_feedback_action",
      q(course),
      q(action),
      q(JSON.stringify(payload)),
    );
  const [first, second, third, withdrawn] = learners;

  await assert.rejects(read(first, foreignCourse), /42501/);
  await assert.rejects(
    command(first, "open", { body: "An unauthorized round" }),
    /42501/,
  );
  assert.equal(
    await command(admin, "open", {
      body: "Explain the problem you investigated",
    }),
    true,
  );
  await assert.rejects(
    command(admin, "open", { round: 2, body: "Round one is still open" }),
    /PT409/,
  );
  assert.equal((await read(first)).own_entry, null);
  for (const [index, learner] of learners.entries())
    assert.equal(
      await command(learner, "entry", { revision: 0, body: "Entry " + index }),
      true,
    );
  await assert.rejects(
    command(first, "approve_entry", { revision: 1, id: randomUUID() }),
    /42501/,
  );
  assert.equal(await command(withdrawn, "withdraw", { revision: 1 }), true);
  assert.equal((await read(withdrawn)).own_entry, null);
  assert.equal((await read(first)).assignment, null);
  assert.equal((await read(first)).entries.length, 0);
  await assert.rejects(command(admin, "start"), /22023/);

  for (const row of (await read(admin)).entries) {
    assert.deepEqual(Object.keys(row).sort(), [
      "approved",
      "attachment",
      "body",
      "id",
      "revision",
    ]);
    await command(admin, "approve_entry", {
      id: row.id,
      revision: row.revision,
    });
  }
  const original = (await read(admin)).entries.find(
    ({ body }) => body === "Entry 0",
  );
  assert.equal(
    await command(first, "entry", { revision: 1, body: "Updated entry 0" }),
    true,
  );
  assert.equal((await read(first)).own_entry.approved, false);
  await assert.rejects(
    command(admin, "approve_entry", { id: original.id, revision: 1 }),
    /PT409/,
  );
  await command(admin, "approve_entry", { id: original.id, revision: 2 });
  assert.equal(await command(admin, "start"), true);
  assert.equal((await read(withdrawn)).assignment, null);
  const active = [first, second, third];
  const views = await Promise.all(active.map((who) => read(who)));
  for (const view of views) {
    assert.deepEqual(Object.keys(view.assignment).sort(), [
      "attachment",
      "body",
      "feedback",
      "scores",
    ]);
    assert.notEqual(view.own_entry.body, view.assignment.body);
    assert.equal(view.received, null);
  }
  const linkedBodies = new Set(views.map((view) => view.assignment.body));
  assert.equal(linkedBodies.size, 3);
  await assert.rejects(command(first, "withdraw", { revision: 2 }), /PT409/);
  await assert.rejects(
    command(withdrawn, "feedback", { body: "Unassigned feedback" }),
    /42501/,
  );
  for (const [index, learner] of active.entries())
    assert.equal(
      await command(learner, "feedback", { body: "Review " + index }),
      true,
    );
  await assert.rejects(command(admin, "release"), /22023/);
  const selected = (await read(admin)).reviews.find(
    ({ feedback }) => feedback === "Review 0",
  );
  await command(admin, "approve_feedback", { id: selected.id });
  assert.equal((await read(second)).received, null);
  assert.equal(await command(admin, "release"), true);
  const recipients = await Promise.all(active.map((who) => read(who)));
  assert.equal(
    recipients.filter(({ received }) => received?.feedback).length,
    1,
  );
  const recipient =
    active[
      recipients.findIndex(({ received }) => received?.feedback === "Review 0")
    ];
  await assert.rejects(
    command(first, "dispute", { body: "This is not my review" }),
    /42501/,
  );
  const localAssignment = randomUUID();
  const outOfScope = randomUUID();
  const definition = (title, label) => ({
    title,
    instructions: "Provide a written solution.",
    due_at: new Date(Date.now() + 86_400_000).toISOString(),
    max_attempts: 1,
    rubric: [
      {
        label,
        levels: [
          { label: "Missing", points: 0 },
          { label: "Provided", points: 1 },
        ],
      },
    ],
  });
  const assignment = (run, id, action, body, version) =>
    rpc(
      admin,
      "course_assignment_action",
      q(run),
      q(id),
      q(action),
      q(JSON.stringify(body)),
      version,
    );
  await assignment(
    course,
    localAssignment,
    "save",
    definition("Fictional rubric", "Explain results"),
    0,
  );
  assert.deepEqual((await read(admin)).available_assignments, []);
  await assignment(course, localAssignment, "publish", {}, 1);
  await assignment(
    foreignCourse,
    outOfScope,
    "save",
    definition("Foreign rubric", "Foreign results"),
    0,
  );
  await assignment(foreignCourse, outOfScope, "publish", {}, 1);
  assert.deepEqual((await read(first)).available_assignments, []);
  assert.deepEqual(
    (await read(admin)).available_assignments.map(({ id }) => id),
    [localAssignment],
  );
  const newRound = {
    round: 2,
    body: "Review a solution to another problem",
    assignment_id: localAssignment,
    assignment_version: 1,
    scored: true,
  };
  await assert.rejects(
    command(admin, "open", {
      round: 2,
      body: "Scored without a rubric",
      scored: true,
    }),
    /22023/,
  );
  await assert.rejects(
    command(admin, "open", { ...newRound, assignment_id: outOfScope }),
    /PT409/,
  );
  await assert.rejects(
    command(admin, "open", { ...newRound, assignment_version: 2 }),
    /PT409/,
  );
  const concurrentOpens = await Promise.allSettled([
    command(admin, "open", newRound),
    command(admin, "open", newRound),
  ]);
  assert.equal(
    concurrentOpens.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  assert.match(
    String(concurrentOpens.find(({ status }) => status === "rejected").reason),
    /PT409/,
  );
  const secondRound = await read(first);
  assert.equal(secondRound.round_number, 2);
  assert.deepEqual(secondRound.assignment_rubric, {
    title: "Fictional rubric",
    version: 1,
    criteria: ["Explain results"],
  });
  assert.equal((await read(first, course, 1)).assignment_rubric, null);
  assert.equal((await read(first, course, 1)).scoring_rubric, null);
  assert.deepEqual(
    secondRound.scoring_rubric,
    definition("", "Explain results").rubric,
  );
  await assignment(
    course,
    localAssignment,
    "save",
    definition("Revised rubric", "New criteria"),
    1,
  );
  await assignment(course, localAssignment, "publish", {}, 2);
  assert.equal(
    (await read(first)).assignment_rubric.criteria[0],
    "Explain results",
  );
  assert.deepEqual(
    secondRound.rounds.map(({ number, stage }) => [number, stage]),
    [
      [2, "collecting"],
      [1, "released"],
    ],
  );
  assert.equal(secondRound.assignment, null);
  assert.equal(secondRound.own_entry, null);
  assert.equal(
    (await read(recipient, course, 1)).received.feedback,
    "Review 0",
  );
  await assert.rejects(read(first, foreignCourse, 1), /42501/);
  await assert.rejects(read(first, course, 3), /22023/);
  await assert.rejects(
    command(first, "entry", {
      revision: 0,
      body: "Cannot overwrite a released entry",
    }),
    /PT409/,
  );
  await assert.rejects(
    command(admin, "approve_entry", { round: 2, id: original.id, revision: 2 }),
    /PT409/,
  );
  assert.equal(
    await command(first, "entry", {
      round: 2,
      revision: 0,
      body: "An independent second entry",
    }),
    true,
  );
  assert.equal(
    (await read(first)).own_entry.body,
    "An independent second entry",
  );
  assert.equal(
    (await read(first, course, 1)).own_entry.body,
    "Updated entry 0",
  );
  const sha = "d".repeat(64);
  const upload = await rpc(
    first,
    "reserve_learning_portfolio_evidence",
    q("learner-name.txt"),
    q("text/plain"),
    33,
    q(randomUUID()),
    q(sha),
  );
  const attachment = (
    who,
    version = upload.version_id,
    run = course,
    round = 2,
  ) => rpc(who, "course_peer_feedback_attachment", q(run), round, q(version));
  const attach = (who, revision) =>
    command(who, "entry", {
      round: 2,
      revision,
      body: "An independent second entry",
      attachment_version: upload.version_id,
    });
  await assert.rejects(attach(first, 1), /42501/);
  await sql(`
    update public.document_versions set status='clean', sha256=${q(sha)}, scanner_version='ClamAV fixture'
      where id=${q(upload.version_id)};
    update public.documents set status='clean', current_version_id=${q(upload.version_id)}
      where id=${q(upload.document_id)};
  `);
  await assert.rejects(attach(second, 0), /42501/);
  assert.equal(await attach(first, 1), true);
  const clean = await attachment(first);
  assert.deepEqual(clean, {
    version_id: upload.version_id,
    name: "peer-attachment.txt",
    sha256: sha,
    size_bytes: 33,
    mime_type: "text/plain",
  });
  assert.deepEqual((await read(first)).own_entry.attachment, {
    version_id: upload.version_id,
    name: "peer-attachment.txt",
  });
  assert.deepEqual(await attachment(admin), clean);
  await assert.rejects(attachment(second), /42501/);
  await assert.rejects(
    attachment(first, upload.version_id, foreignCourse),
    /42501/,
  );
  await assert.rejects(
    attachment(first, upload.version_id, course, 1),
    /42501/,
  );
  for (const learner of [second, third]) {
    await command(learner, "entry", {
      round: 2,
      revision: 0,
      body: "Another second entry",
    });
  }
  for (const row of (await read(admin)).entries) {
    await command(admin, "approve_entry", {
      round: 2,
      id: row.id,
      revision: row.revision,
    });
  }
  await command(admin, "start", { round: 2 });
  const match = await Promise.all([second, third].map((who) => read(who)));
  const reviewerIndex = match.findIndex(
    (view) => view.assignment?.attachment?.version_id === upload.version_id,
  );
  assert.notEqual(reviewerIndex, -1);
  const reviewer = [second, third][reviewerIndex];
  const other = [third, second][reviewerIndex];
  assert.deepEqual(await attachment(reviewer), clean);
  await assert.rejects(attachment(other), /42501/);
  await assert.rejects(attachment(withdrawn), /42501/);
  const reviewBody = { round: 2, body: "The revised result is reproducible" };
  await assert.rejects(command(reviewer, "feedback", reviewBody), /22023/);
  await assert.rejects(
    command(reviewer, "feedback", { ...reviewBody, scores: [2] }),
    /22023/,
  );
  await assert.rejects(
    command(reviewer, "feedback", { ...reviewBody, scores: ["1"] }),
    /22023/,
  );
  assert.equal(
    await command(reviewer, "feedback", { ...reviewBody, scores: [1] }),
    true,
  );
  assert.equal(
    await command(reviewer, "feedback", { ...reviewBody, scores: [1] }),
    true,
  );
  await assert.rejects(
    command(reviewer, "feedback", { ...reviewBody, scores: [0] }),
    /42501/,
  );
  assert.equal((await read(first)).received, null);
  const scoredReview = (await read(admin)).reviews[0];
  assert.deepEqual(scoredReview.scores, [1]);
  await command(admin, "approve_feedback", { round: 2, id: scoredReview.id });
  assert.equal((await read(first)).received, null);
  await command(admin, "release", { round: 2 });
  assert.deepEqual((await read(first)).received.scores, [1]);
  await command(first, "dispute", {
    round: 2,
    body: "Please check the rating",
  });
  assert.equal((await read(first)).received.scores, null);
  await command(admin, "resolve", {
    round: 2,
    id: scoredReview.id,
    keep: false,
    body: "The rating was withdrawn",
  });
  assert.equal((await read(first)).received.scores, null);
  await assert.rejects(attachment(reviewer), /42501/);
  assert.deepEqual(await attachment(first), clean);
  await command(recipient, "dispute", { body: "Please review the tone" });
  const withheld = await read(recipient, course, 1);
  assert.equal(withheld.received.feedback, null);
  assert.equal(withheld.received.dispute, "Please review the tone");
  await command(admin, "resolve", {
    id: selected.id,
    keep: false,
    body: "Feedback was withdrawn",
  });
  assert.equal(
    (await read(recipient, course, 1)).received.resolution,
    "Feedback was withdrawn",
  );
  assert.equal((await read(recipient, course, 1)).received.feedback, null);
  await assert.rejects(
    actor(first, "select feedback from private.lms_peer_matches"),
    /42501/,
  );

  await sql(
    `update public.course_enrolments set status='removed' where course_run_id=${q(course)} and user_id=${q(first)}`,
  );
  await assert.rejects(read(first), /42501/);
  assert.equal((await read(recipient, course, 1)).received, null);
  await sql(
    `delete from private.lms_peer_entries where run_id=${q(course)} and user_id=${q(first)}`,
  );
  assert.equal(
    await sql(
      `select count(*) from private.lms_peer_matches where run_id=${q(course)} and round_number=1`,
    ),
    "1",
  );
  assert.equal(
    await sql(
      `select count(*) from private.course_quiz_attempts where run_id=${q(course)}`,
    ),
    "0",
  );
  console.log(
    "PASS isolated round history, pinned scores, scanned attachments, anonymous matching, disputes and linked cleanup",
  );
});
