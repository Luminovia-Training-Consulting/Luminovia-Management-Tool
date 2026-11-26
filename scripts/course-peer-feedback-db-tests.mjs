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
    assert.deepEqual(Object.keys(view.assignment).sort(), ["body", "feedback"]);
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
  const newRound = { round: 2, body: "Review a solution to another problem" };
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
      `select count(*) from private.lms_peer_matches where run_id=${q(course)}`,
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
    "PASS isolated round history, concurrent open, anonymous matching, dispute resolution and linked subject cleanup",
  );
});
