/** Verify retained competency revisions, evidence lineage and real role checks with fictional actors. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("course_competencies", async ({ sql, actor }) => {
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
  const read = (who, course = run, target = null) =>
    rpc(who, "course_competencies", q(course), target ? q(target) : "null", 0);
  const action = (who, command, payload, revision, course = run) =>
    rpc(
      who,
      "course_competency_action",
      q(course),
      q(command),
      q(JSON.stringify(payload)),
      revision,
    );
  const [id, beginner, experienced, competencyId] = Array.from(
    { length: 4 },
    randomUUID,
  );
  const framework = {
    id,
    content: {
      title: "Command-line competency",
      levels: [
        { id: beginner, title: "Guided" },
        { id: experienced, title: "Independent" },
      ],
      competencies: [
        { id: competencyId, code: "CLI", title: "Navigate directories" },
      ],
    },
  };
  const pin = { framework_id: id, framework_revision: 1 };
  const assessment = {
    pin_revision: 1,
    user_id: learner,
    competency_id: competencyId,
    level_id: beginner,
    evidence_note: "Practised resolving directories with assistance",
    include_quiz: true,
  };
  assert.equal((await read(learner)).pinned_framework, null);
  await assert.rejects(read(teacher, sibling), /42501/);
  await assert.rejects(read(learner, run, admin), /42501/);
  await assert.rejects(
    action(teacher, "save_framework", framework, 0),
    /42501/,
  );
  await assert.rejects(
    action(
      admin,
      "save_framework",
      {
        ...framework,
        content: {
          ...framework.content,
          levels: [framework.content.levels[0]],
        },
      },
      0,
    ),
    /22023/,
  );

  assert.deepEqual(await action(admin, "save_framework", framework, 0), {
    id,
    revision: 1,
  });
  assert.deepEqual(await action(admin, "save_framework", framework, 0), {
    id,
    revision: 1,
  });
  assert.equal((await read(admin, sibling)).frameworks[0].id, id);
  assert.deepEqual((await read(admin, foreign)).frameworks, []);
  await assert.rejects(action(admin, "pin", pin, 0, foreign), /42501/);
  assert.equal((await action(admin, "pin", pin, 0)).revision, 1);
  assert.equal((await read(learner)).pinned_framework.id, id);
  assert.deepEqual((await read(learner)).frameworks, []);
  assert.equal((await read(learner)).can_assess, false);
  await assert.rejects(
    action(learner, "assess", { ...assessment, include_quiz: false }, 0),
    /42501/,
  );
  await assert.rejects(
    action(teacher, "assess", { ...assessment, level_id: randomUUID() }, 0),
    /22023/,
  );
  await assert.rejects(
    action(teacher, "assess", { ...assessment, user_id: admin }, 0),
    /42501/,
  );
  await assert.rejects(action(teacher, "assess", assessment, 0), /22023/);

  const quiz = {
    questions: [
      { prompt: "Working directory?", options: ["ls", "pwd"], correct: 1 },
    ],
    pass_percent: 80,
    max_attempts: 3,
    published: true,
  };
  await rpc(
    teacher,
    "course_workspace_action",
    q(run),
    q("quiz_config"),
    q(JSON.stringify(quiz)),
    0,
  );
  const learnerAttempt = await rpc(
    learner,
    "course_workspace_action",
    q(run),
    q("quiz_attempt"),
    q(JSON.stringify({ answers: [1], request_id: randomUUID() })),
    1,
  );
  assert.equal((await action(teacher, "assess", assessment, 0)).revision, 1);
  assert.equal((await action(teacher, "assess", assessment, 0)).revision, 1);
  await assert.rejects(
    action(otherTeacher, "assess", { ...assessment, level_id: experienced }, 0),
    /PT409/,
  );
  assert.equal(
    (
      await action(
        otherTeacher,
        "assess",
        {
          ...assessment,
          level_id: experienced,
          evidence_note: "Navigated independently after practice",
        },
        1,
      )
    ).revision,
    2,
  );
  const learnerView = await read(learner);
  assert.equal(learnerView.decisions[0].level_title, "Independent");
  assert.equal(learnerView.decisions[0].quiz_evidence.id, learnerAttempt.id);
  assert.equal(learnerView.decisions[0].quiz_evidence.score, 100);
  assert.equal(learnerView.decisions[1].level_title, "Guided");
  assert.equal(learnerView.current_revisions[competencyId], 2);
  assert.deepEqual(
    (await read(teacher, run, learner)).decisions,
    learnerView.decisions,
  );
  assert.deepEqual((await read(teacher)).decisions, []);
  await assert.rejects(
    actor(learner, "select * from private.lms_competency_decisions"),
    /42501/,
  );

  const updatedFramework = {
    ...framework,
    content: {
      ...framework.content,
      title: "Updated framework",
      levels: [
        framework.content.levels[0],
        { id: experienced, title: "Confident" },
      ],
    },
  };
  assert.equal(
    (await action(admin, "save_framework", updatedFramework, 1, sibling))
      .revision,
    2,
  );
  assert.equal((await read(learner)).pinned_framework.revision, 1);
  assert.equal(
    (await action(admin, "pin", { ...pin, framework_revision: 2 }, 1)).revision,
    2,
  );
  const remapped = await read(learner);
  assert.equal(remapped.pinned_framework.revision, 2);
  assert.equal(remapped.decisions[0].level_title, "Independent");
  assert.deepEqual(remapped.current_revisions, {});
  await assert.rejects(action(teacher, "assess", assessment, 2), /PT409/);
  const secondPage = await rpc(
    learner,
    "course_competencies",
    q(run),
    "null",
    50,
  );
  assert.deepEqual(secondPage.decisions, []);
  assert.equal(secondPage.has_more, false);
  await assert.rejects(
    sql(
      "update private.lms_competency_decisions set evidence_note='Force overwrite'",
    ),
    /55000/,
  );
  await sql(
    `update public.course_enrolments set status='removed' where course_run_id=${q(run)} and user_id=${q(learner)}`,
  );
  await assert.rejects(read(learner), /42501/);
  await assert.rejects(read(teacher, run, learner), /42501/);
  console.log(
    "PASS competency authoring, scoped pins, learner evidence, idempotent corrections and retained revision history",
  );
});
