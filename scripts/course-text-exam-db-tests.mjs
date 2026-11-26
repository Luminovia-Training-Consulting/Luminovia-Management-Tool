/** Check timed text exams against actual role grants, immutable answers and release rules. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { courseXapiArchiveSchema } from "../src/features/learning/xapi-schema.ts";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("course_text_exams", async ({ sql, actor }) => {
  const [
    admin,
    teacher,
    otherTeacher,
    learner,
    company,
    otherCompany,
    template,
    run,
    sibling,
    foreign,
    request,
  ] = Array.from({ length: 11 }, randomUUID);
  await sql(`
    insert into auth.users(id,email,email_confirmed_at) values
    ${[admin, teacher, otherTeacher, learner].map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
    insert into public.user_roles(user_id,role) values
      (${q(admin)},'admin'), (${q(teacher)},'lecturer'), (${q(otherTeacher)},'lecturer'), (${q(learner)},'participant');
    insert into public.organisations(id,name) values
      (${q(company)},'Fictional teaching company'), (${q(otherCompany)},'Other fictional company');
    insert into public.course_templates(id,title) values (${q(template)},'Fictional course template');
    insert into public.course_runs(id,template_id,organisation_id,published) values
      (${q(run)},${q(template)},${q(company)},true), (${q(sibling)},${q(template)},${q(company)},true),
      (${q(foreign)},${q(template)},${q(otherCompany)},true);
    insert into public.course_sessions(course_run_id,starts_at,ends_at)
      values (${q(run)},now()-interval '2 hours',now()-interval '1 hour');
    insert into private.company_participant_link_requests(
      id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at
    ) values (${q(request)},${q(company)},${q(admin)},${q(randomUUID())},
      (select luminovia_user_id from public.profiles where id=${q(learner)}),${q(learner)},'accepted',now()+interval '1 day');
    insert into private.company_participant_memberships(
      organisation_id,user_id,status,link_request_id,invited_by,joined_at,version
    ) values (${q(company)},${q(learner)},'active',${q(request)},${q(admin)},now(),1);
    insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
      values (${q(run)},${q(learner)},'enrolled',${q(admin)});
  `);
  for (const instructor of [teacher, otherTeacher]) {
    const job = randomUUID();
    await sql(`
      insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms)
      values (${q(job)},${q(run)},'Fictional teaching job','Fictional company','online','filled',100,'EUR','fixed_total',100,'Training');
      insert into public.job_claims(job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version)
      values (${q(job)},${q(instructor)},${q(randomUUID())},100,'EUR','fixed_total',100,'Training',1);
    `);
  }
  const rpc = async (who, name, ...parameters) =>
    JSON.parse(
      await actor(
        who,
        `select to_jsonb(public.${name}(${parameters.join(",")}))`,
      ),
    );
  for (const org of [company, otherCompany])
    await rpc(admin, "set_company_premium", q(org), "true", 0, q(randomUUID()));
  const secondLearner = randomUUID();
  const secondRequest = randomUUID();
  await sql(`
    insert into auth.users(id,email,email_confirmed_at)
      values (${q(secondLearner)},${q(secondLearner + "@example.invalid")},now());
    insert into public.user_roles(user_id,role) values (${q(secondLearner)},'participant');
    insert into private.company_participant_link_requests(
      id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at
    ) select ${q(secondRequest)},${q(company)},${q(admin)},${q(randomUUID())},luminovia_user_id,id,'accepted',now()+interval '1 day'
      from public.profiles where id=${q(secondLearner)};
    insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at)
      values (${q(company)},${q(secondLearner)},'active',${q(secondRequest)},${q(admin)},now());
    insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
      values (${q(run)},${q(secondLearner)},'enrolled',${q(admin)});
  `);
  const read = (
    who,
    revision = "null",
    subject = "null",
    offset = 0,
    course = run,
  ) => rpc(who, "course_text_exam", q(course), revision, subject, offset);
  const action = (
    who,
    command,
    revision,
    expected,
    payload = {},
    course = run,
  ) =>
    rpc(
      who,
      "course_text_exam_action",
      q(course),
      q(command),
      revision ?? "null",
      expected,
      q(JSON.stringify(payload)),
    );
  const window = {
    title: "Network fundamentals",
    opens_at: new Date(Date.now() + 3600000).toISOString(),
    closes_at: new Date(Date.now() + 7200000).toISOString(),
    pass_percent: 70,
    questions: [
      { prompt: "Explain a default route.", max_points: 6 },
      { prompt: "Explain the purpose of a loopback interface.", max_points: 4 },
    ],
  };

  assert.equal((await read(learner)).exam, null);
  assert.equal((await read(admin)).can_author, true);
  assert.equal((await read(teacher)).can_author, false);
  await assert.rejects(() => read(learner, "null", q(secondLearner)), /42501/);
  await assert.rejects(
    () => read(learner, "null", "null", 0, foreign),
    /42501/,
  );
  await assert.rejects(
    () => read(teacher, "null", "null", 0, sibling),
    /42501/,
  );
  await assert.rejects(
    () =>
      actor(learner, "select count(*) from private.course_text_exam_versions"),
    /42501/,
  );
  await assert.rejects(
    () => action(teacher, "save_exam", null, 0, window),
    /42501/,
  );
  await assert.rejects(
    () => action(admin, "save_exam", null, 0, { ...window, questions: [] }),
    /22023/,
  );

  assert.equal(await action(admin, "save_exam", null, 0, window), 1);
  assert.equal(await action(admin, "save_exam", null, 0, window), 1);
  assert.equal((await read(learner)).exam, null);
  assert.equal(await action(admin, "publish", null, 1), 1);
  assert.equal(await action(admin, "publish", null, 1), 1);
  assert.equal((await read(learner)).exam.questions, null);
  const answers = [
    "Traffic with no more specific prefix uses this route.",
    "It provides a stable logical address.",
  ];
  await assert.rejects(
    () => action(learner, "submit", 1, 0, { answers }),
    /PT409/,
  );
  const edited = { ...window, title: "Network fundamentals revised" };
  assert.equal(await action(admin, "save_exam", null, 1, edited), 2);
  assert.equal((await read(learner)).exam.title, window.title);
  await assert.rejects(() => action(admin, "publish", null, 1), /PT409/);
  await assert.rejects(() => action(admin, "publish", null, 2), /PT409/);

  // Move only the disposable fixture's immutable window through real
  // PostgreSQL time. All candidate and course staff actions use public RPCs.
  await sql(`update private.course_text_exam_versions
    set opens_at=clock_timestamp()-interval '1 minute', closes_at=clock_timestamp()+interval '5 minutes'
    where run_id=${q(run)} and revision=1`);
  assert.deepEqual((await read(learner)).exam.questions, window.questions);
  const draft = { answers: [answers[0], ""] };
  assert.equal(await action(learner, "save_answers", 1, 0, draft), 1);
  assert.deepEqual((await read(learner)).attempt.answers, draft.answers);
  assert.equal((await read(secondLearner)).attempt, null);
  assert.equal((await read(teacher, 1, q(learner))).attempt, null);
  assert.equal((await read(teacher, 1)).submissions.length, 0);
  await assert.rejects(() => action(learner, "submit", 1, 1, draft), /22023/);
  await assert.rejects(
    () => action(learner, "submit", 1, 0, { answers }),
    /PT409/,
  );
  const receipts = await Promise.all(
    [1, 2].map(() => action(learner, "submit", 1, 1, { answers })),
  );
  assert.deepEqual(receipts, [2, 2]);
  assert.deepEqual(
    (await read(teacher, 1, q(learner))).attempt.answers,
    answers,
  );
  assert.equal(
    (await read(teacher, 1)).submissions[0].review_state,
    "ungraded",
  );
  assert.equal((await read(teacher, 1, "null", 25)).submissions.length, 0);
  await assert.rejects(
    () => action(learner, "save_answers", 1, 2, draft),
    /PT409/,
  );
  const score = {
    learner_id: learner,
    points: [5, 2],
    feedback: "Be precise about the stability of logical interfaces.",
  };
  await assert.rejects(
    () => action(teacher, "save_review", 1, 0, score),
    /PT409/,
  );

  await sql(`update private.course_text_exam_versions
    set opens_at=clock_timestamp()-interval '6 minutes', closes_at=clock_timestamp()-interval '1 minute'
    where run_id=${q(run)} and revision=1`);
  await assert.rejects(
    () => action(secondLearner, "submit", 1, 0, { answers }),
    /PT409/,
  );
  await assert.rejects(
    () => action(learner, "save_review", 1, 0, score),
    /42501/,
  );
  await assert.rejects(
    () => action(teacher, "save_review", 1, 0, { ...score, points: [7, 0] }),
    /22023/,
  );
  await assert.rejects(
    () =>
      action(teacher, "save_review", 1, 0, {
        ...score,
        learner_id: secondLearner,
      }),
    /42501/,
  );
  assert.equal(await action(teacher, "save_review", 1, 0, score), 1);
  assert.equal((await read(learner)).review, null);
  const xapi = async () =>
    courseXapiArchiveSchema
      .parse(
        await rpc(
          admin,
          "course_xapi_statements",
          q(run),
          "clock_timestamp() - interval '1 day'",
          "clock_timestamp() + interval '1 day'",
        ),
      )
      .statements.filter((entry) => entry.verb.id.endsWith("/scored"));
  const weightedEvidence = async () =>
    JSON.parse(
      (await sql(
        `select to_jsonb(private.course_weighted_source(${q(run)},${q(learner)},'text_exam'))`,
      )) || "null",
    );
  const gradeNotices = async (who) => (await rpc(who, "notification_inbox")).items
    .filter(({ kind }) => kind === "course_text_exam_graded");
  assert.deepEqual(await xapi(), []);
  assert.equal(await weightedEvidence(), null);
  assert.deepEqual(await gradeNotices(learner), []);
  const moderation = await read(teacher, 1, q(learner));
  assert.equal(moderation.review.score, 7);
  assert.equal(moderation.review.released_at, null);
  assert.equal((await read(teacher, 1)).submissions[0].review_state, "draft");
  assert.equal(
    await action(teacher, "release", 1, 1, { learner_id: learner }),
    1,
  );
  assert.equal((await read(learner)).review.passed, true);
  assert.equal((await read(learner)).review.max_points, 10);
  assert.equal((await read(secondLearner)).review, null);
  assert.equal((await weightedEvidence()).score, 70);
  const [receipt] = await gradeNotices(learner);
  assert.equal(receipt.href, `/courses/${run}/workspace#course-learning`);
  assert.deepEqual(await gradeNotices(secondLearner), []);
  const [firstStatement] = await xapi();
  assert.equal(firstStatement.result.score.raw, 70);
  assert.ok(firstStatement.object.id.endsWith("/text-exam/1"));
  assert.ok(!JSON.stringify(firstStatement).includes(learner));

  const correction = { ...score, points: [3, 2] };
  assert.equal(await action(teacher, "save_review", 1, 1, correction), 2);
  assert.equal((await read(learner)).review.score, 7);
  assert.equal((await weightedEvidence()).score, 70);
  assert.deepEqual(await xapi(), [firstStatement]);
  assert.equal(
    await action(teacher, "release", 1, 2, { learner_id: learner }),
    2,
  );
  assert.equal((await read(learner)).review.passed, false);
  assert.equal((await weightedEvidence()).score, 50);
  const correctedNotices = await gradeNotices(learner);
  assert.deepEqual(correctedNotices.map(({id}) => id), [receipt.id]);
  const scored = await xapi();
  assert.deepEqual(
    scored.map((entry) => entry.result.score.raw),
    [70, 50],
  );
  assert.deepEqual(scored[0], firstStatement);
  assert.notEqual(scored[0].id, scored[1].id);
  assert.equal(
    (await read(teacher, 1)).submissions[0].review_state,
    "released",
  );
  assert.equal(await action(admin, "publish", null, 2), 2);
  assert.equal((await read(learner)).exam.revision, 2);
  assert.equal(await weightedEvidence(), null);
  assert.equal((await read(learner, 1)).review.score, 5);
  assert.equal(await action(learner, "submit", 1, 1, { answers }), 2);

  await actor(
    learner,
    "set local request.path='/rpc/course_text_exam'; set local request.method='POST'; select public.require_portal_access()",
  );
  await actor(
    learner,
    "set local request.path='/rpc/course_text_exam_action'; set local request.method='POST'; select public.require_portal_access()",
  );
  await rpc(
    admin,
    "set_company_premium",
    q(company),
    "false",
    1,
    q(randomUUID()),
  );
  await assert.rejects(() => read(admin), /42501/);
  await assert.rejects(() => read(learner), /42501/);
  assert.deepEqual(await gradeNotices(learner), []);
});
console.log("Course text exam database scenarios passed.");
