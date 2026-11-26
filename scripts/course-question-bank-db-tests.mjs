/** Replays the real quiz and bank migrations with fictional organizations and current role scopes. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("course_question_bank", async ({ sql, actor }) => {
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
  const bank = (who, course = run, search = "", archived = false) =>
    rpc(who, "course_question_bank", q(course), q(search), String(archived), 0);
  const bankAction = (who, action, payload, version, course = run) =>
    rpc(
      who,
      "course_question_bank_action",
      q(course),
      q(action),
      q(JSON.stringify(payload)),
      version,
    );
  const workspace = (who) => rpc(who, "course_workspace", q(run));
  const id = randomUUID();
  const item = {
    id,
    topic: "File systems",
    difficulty: "introductory",
    content: {
      prompt: "List a directory?",
      options: ["ls", "pwd"],
      correct: 0,
    },
  };
  const settings = {
    entries: [{ question_id: id, revision: 1 }],
    pass_percent: 80,
    max_attempts: 1,
    published: true,
    shuffle: true,
  };

  await assert.rejects(bank(learner), /42501/);
  await assert.rejects(bank(teacher, sibling), /42501/);
  await assert.rejects(
    actor(learner, "select from private.course_bank_question_revisions"),
    /42501/,
  );
  await assert.rejects(bankAction(learner, "save", item, 0), /42501/);
  await assert.rejects(
    bankAction(
      teacher,
      "save",
      { ...item, content: { ...item.content, correct: 2 } },
      0,
    ),
    /22023/,
  );

  assert.deepEqual(await bankAction(teacher, "save", item, 0), {
    id,
    version: 1,
  });
  assert.deepEqual(await bankAction(teacher, "save", item, 0), {
    id,
    version: 1,
  });
  assert.equal((await bank(teacher, run, "FILE SYS")).items[0].can_edit, true);
  assert.equal((await bank(otherTeacher)).items[0].can_edit, false);
  await assert.rejects(bankAction(otherTeacher, "save", item, 1), /42501/);
  assert.equal((await bank(admin, sibling)).items[0].id, id);
  assert.deepEqual((await bank(admin, foreign)).items, []);
  await assert.rejects(
    bankAction(admin, "configure", settings, 0, foreign),
    /PT409/,
  );
  await assert.rejects(
    bankAction(
      teacher,
      "configure",
      { ...settings, entries: [...settings.entries, ...settings.entries] },
      0,
    ),
    /22023/,
  );

  const manual = {
    prompt: "Show the current directory?",
    options: ["ls", "pwd"],
    correct: 1,
  };
  assert.equal(
    (
      await bankAction(
        teacher,
        "configure",
        { ...settings, entries: [...settings.entries, manual] },
        0,
      )
    ).version,
    1,
  );
  const staffQuiz = (await workspace(teacher)).quiz;
  const learnerQuiz = (await workspace(learner)).quiz;
  const expectedLearnerQuestions = staffQuiz.questions.map(
    ({ prompt, options }) => ({ prompt, options }),
  );
  assert.deepEqual(learnerQuiz.questions, expectedLearnerQuestions);
  const pinned = staffQuiz.questions.find(({ source }) => source);
  assert.deepEqual(pinned.source, { question_id: id, revision: 1 });

  // Competing editors cannot overwrite one another or alter already selected content.
  const [left, right] = await Promise.allSettled([
    bankAction(teacher, "save", { ...item, topic: "Version A" }, 1),
    bankAction(admin, "save", { ...item, topic: "Version B" }, 1, sibling),
  ]);
  assert.equal(
    [left, right].filter((entry) => entry.status === "fulfilled").length,
    1,
  );
  assert.match(
    String([left, right].find((entry) => entry.status === "rejected").reason),
    /PT409/,
  );
  assert.equal((await bank(teacher)).items[0].revision, 2);
  assert.deepEqual(
    (await workspace(learner)).quiz.questions,
    expectedLearnerQuestions,
  );
  await assert.rejects(
    bankAction(admin, "configure", settings, 0, sibling),
    /PT409/,
  );

  const answers = staffQuiz.questions.map(({ correct }) => correct);
  const attempt = (requestId) =>
    rpc(
      learner,
      "course_workspace_action",
      q(run),
      q("quiz_attempt"),
      q(JSON.stringify({ answers, request_id: requestId })),
      1,
    );
  const attemptId = randomUUID();
  const accepted = await attempt(attemptId);
  assert.equal(accepted.score, 100);
  assert.deepEqual(await attempt(attemptId), accepted);
  await assert.rejects(attempt(randomUUID()), /22023/);

  // A current quiz may retain its own snapshot even after the bank row is archived.
  assert.equal(
    (await bankAction(teacher, "set_archived", { id, archived: true }, 2))
      .version,
    3,
  );
  assert.deepEqual((await bank(teacher)).items, []);
  assert.equal((await bank(teacher, run, "", true)).items[0].archived, true);
  assert.equal(
    (await bankAction(teacher, "configure", settings, 1)).version,
    2,
  );
  assert.equal(
    (await bankAction(teacher, "set_archived", { id, archived: false }, 3))
      .version,
    4,
  );
  assert.equal((await bank(teacher)).items[0].revision, 4);
  await assert.rejects(bankAction(teacher, "configure", settings, 1), /PT409/);
  assert.equal(
    await sql(
      `select count(*) from private.course_bank_question_revisions where question_id=${q(id)}`,
    ),
    "4",
  );

  await assert.rejects(
    sql(
      `update private.course_bank_question_revisions set topic='Force overwrite' where question_id=${q(id)} and revision=1`,
    ),
    /55000/,
  );

  await sql(
    `delete from public.user_roles where user_id=${q(teacher)} and role='lecturer'`,
  );
  await assert.rejects(bank(teacher), /42501/);
  await assert.rejects(
    bankAction(teacher, "set_archived", { id, archived: true }, 4),
    /42501/,
  );
  console.log(
    "PASS question bank scope, validation, immutable revisions, competing authors, archive/restore and canonical quiz attempts",
  );
});
