/** Verify candidate isolation, real randomized forms, draft recovery and canonical attempt scoring. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("course_quiz_pools", async ({ sql, actor }) => {
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
  const questions = [
    {
      prompt: "Show the current directory",
      options: ["pwd", "ls"],
      correct: 0,
    },
    { prompt: "List directory entries", options: ["pwd", "ls"], correct: 1 },
    {
      prompt: "Print the beginning of a file",
      options: ["head", "tail"],
      correct: 0,
    },
  ];
  const ids = questions.map(() => randomUUID());
  const bankAction = (who, action, payload, version = 0, course = run) =>
    rpc(
      who,
      "course_question_bank_action",
      q(course),
      q(action),
      q(JSON.stringify(payload)),
      version,
    );
  for (const [index, content] of questions.entries()) {
    await bankAction(teacher, "save", {
      id: ids[index],
      content,
      topic: "File systems",
      difficulty: "introductory",
    });
  }
  const setup = {
    entries: ids.map((question_id) => ({ question_id, revision: 1 })),
    pass_percent: 80,
    max_attempts: 2,
    published: true,
    shuffle: false,
    draw_count: 2,
  };
  const read = (who) => rpc(who, "course_workspace", q(run));
  const start = (who, version = 1, course = run) =>
    rpc(who, "start_course_quiz_pool", q(course), version);
  const submit = (requestId, answers, version = 1) =>
    rpc(
      learner,
      "course_workspace_action",
      q(run),
      q("quiz_attempt"),
      q(JSON.stringify({ answers, request_id: requestId })),
      version,
    );
  const saveDraft = (requestId, answers, revision = 0) =>
    rpc(
      learner,
      "save_course_quiz_draft",
      q(run),
      1,
      1,
      q(requestId),
      revision,
      q(JSON.stringify(answers)),
    );

  await assert.rejects(
    bankAction(teacher, "configure", { ...setup, draw_count: 3 }),
    /22023/,
  );
  await assert.rejects(
    bankAction(teacher, "configure", {
      ...setup,
      entries: [...setup.entries, questions[0]],
    }),
    /22023/,
  );
  await assert.rejects(
    bankAction(teacher, "configure", { ...setup, shuffle: true }),
    /22023/,
  );
  assert.equal((await bankAction(teacher, "configure", setup)).version, 1);
  const staff = (await read(teacher)).quiz;
  assert.equal(staff.questions.length, 3);
  assert.equal(staff.questions[0].source.question_id, ids[0]);
  assert.deepEqual(staff.pool, { draw_count: 2, request_id: null });
  const unopened = (await read(learner)).quiz;
  assert.deepEqual(unopened.questions, []);
  assert.deepEqual(unopened.pool, { draw_count: 2, request_id: null });
  await assert.rejects(start(admin), /42501/);
  await assert.rejects(start(learner, 2), /PT409/);
  await assert.rejects(submit(randomUUID(), [0, 0]), /PT409/);
  await assert.rejects(saveDraft(randomUUID(), [0, null]), /PT409/);

  const [left, right] = await Promise.all([start(learner), start(learner)]);
  assert.deepEqual(left, right);
  assert.equal(left.attempt_number, 1);
  const opened = (await read(learner)).quiz;
  assert.equal(opened.pool.request_id, left.request_id);
  assert.equal(opened.questions.length, 2);
  assert.equal(new Set(opened.questions.map(({ prompt }) => prompt)).size, 2);
  for (const question of opened.questions)
    assert.deepEqual(Object.keys(question).sort(), ["options", "prompt"]);
  assert.deepEqual((await read(learner)).quiz.questions, opened.questions);
  assert.equal((await read(teacher)).quiz.pool.request_id, null);
  assert.deepEqual((await read(secondLearner)).quiz.questions, []);
  await assert.rejects(
    rpc(
      secondLearner,
      "course_workspace_action",
      q(run),
      q("quiz_attempt"),
      q(JSON.stringify({ answers: [0, 0], request_id: left.request_id })),
      1,
    ),
    /PT409/,
  );
  const independent = await start(secondLearner);
  assert.notEqual(independent.request_id, left.request_id);
  assert.equal((await read(secondLearner)).quiz.questions.length, 2);
  await sql(
    `update public.course_enrolments set status='removed' where course_run_id=${q(run)} and user_id=${q(secondLearner)}`,
  );
  await assert.rejects(read(secondLearner), /42501/);
  await assert.rejects(start(secondLearner), /42501/);

  const correct = (items) =>
    items.map(
      ({ prompt }) =>
        questions.find((question) => question.prompt === prompt).correct,
    );
  const wrong = correct(opened.questions).map((index) => 1 - index);
  await assert.rejects(saveDraft(left.request_id, [...wrong, null]), /22023/);
  assert.equal(await saveDraft(left.request_id, [wrong[0], null]), 1);
  assert.deepEqual((await read(learner)).quiz.draft.answers, [wrong[0], null]);
  assert.deepEqual(await start(learner), left);
  assert.equal(await saveDraft(left.request_id, wrong, 1), 2);
  const score = await submit(left.request_id, wrong);
  assert.equal(score.score, 0);
  assert.equal(score.passed, false);
  const used = (await read(learner)).quiz;
  assert.equal(used.attempts, 1);
  assert.deepEqual(used.questions, []);
  assert.equal(used.draft, null);
  const next = await start(learner);
  assert.equal(next.attempt_number, 2);
  assert.notEqual(next.request_id, left.request_id);
  const second = (await read(learner)).quiz;
  assert.deepEqual(await submit(left.request_id, wrong), score);
  assert.equal(
    (await submit(next.request_id, correct(second.questions))).score,
    100,
  );
  await assert.rejects(start(learner), /PT409/);
  assert.equal((await read(learner)).quiz.passed, true);
  assert.equal(
    await sql(
      `select count(*) from private.course_quiz_pool_draws where run_id=${q(run)} and user_id=${q(learner)}`,
    ),
    "2",
  );
  await assert.rejects(
    sql("update private.course_quiz_pool_draws set positions=array[0,1]"),
    /55000/,
  );
  await assert.rejects(
    actor(learner, "select * from private.course_quiz_pool_draws"),
    /42501/,
  );

  // Fixed quizzes and the old attempt shape continue to work without starting a draw.
  assert.equal(
    (
      await bankAction(
        teacher,
        "configure",
        {
          entries: setup.entries,
          pass_percent: 80,
          max_attempts: 1,
          published: true,
          shuffle: false,
        },
        1,
      )
    ).version,
    2,
  );
  const fixed = (await read(learner)).quiz;
  assert.equal(fixed.pool, null);
  assert.equal(fixed.questions.length, 3);
  assert.equal(
    (await submit(randomUUID(), correct(fixed.questions), 2)).score,
    100,
  );
  await assert.rejects(start(learner), /PT409/);
  console.log(
    "PASS immutable per-attempt draws, access boundaries, draft recovery, retry and fixed-quiz compatibility",
  );
});
