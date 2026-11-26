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
  const assignment = randomUUID(),
    attempt = randomUUID();
  const rubric = JSON.stringify([
    {
      label: "Accuracy",
      levels: [0, 8, 10].map((points) => ({ label: String(points), points })),
    },
  ]);
  await sql(`
    insert into private.course_assignments(id,run_id,current_version,published_version)
      values (${q(assignment)},${q(run)},1,1);
    insert into private.course_assignment_definitions(assignment_id,version,title,instructions,due_at,max_attempts,rubric)
      values (${q(assignment)},1,'Fictional lab write-up','Attach work',now(),2,${q(rubric)});
    insert into private.course_assignment_attempts(id,assignment_id,assignment_version,user_id,attempt_no,file_name)
      values (${q(attempt)},${q(assignment)},1,${q(learner)},1,'evidence.txt');
    insert into private.course_assignment_reviews(attempt_id,version,state,scores,feedback,private_note)
      values (${q(attempt)},1,'draft','[8]','','Private draft');
  `);
  const assignmentEvidence = {
    assignment_id: assignment,
    attempt_id: attempt,
    review_version: 2,
  };
  assert.deepEqual((await read(teacher, run, learner)).assignment_options, []);
  await assert.rejects(
    action(
      otherTeacher,
      "assess",
      { ...assessment, assignment_evidence: assignmentEvidence },
      1,
    ),
    /PT409/,
  );
  await sql(`insert into private.course_assignment_reviews(attempt_id,version,state,scores,feedback,private_note)
    values (${q(attempt)},2,'released','[8]','','Private note')`);
  const supportedAssessment = {
    ...assignmentEvidence,
    title: "Fictional lab write-up",
    score: 80,
  };
  assert.deepEqual((await read(teacher, run, learner)).assignment_options, [
    supportedAssessment,
  ]);
  assert.deepEqual((await read(learner)).assignment_options, []);
  await assert.rejects(
    action(
      otherTeacher,
      "assess",
      {
        ...assessment,
        assignment_evidence: {
          ...assignmentEvidence,
          attempt_id: randomUUID(),
        },
      },
      1,
    ),
    /PT409/,
  );
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
          assignment_evidence: assignmentEvidence,
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
  assert.deepEqual(
    learnerView.decisions[0].assignment_evidence,
    supportedAssessment,
  );
  assert.equal(learnerView.decisions[1].assignment_evidence, null);
  assert.equal(learnerView.decisions[1].level_title, "Guided");
  assert.equal(learnerView.current_revisions[competencyId], 2);
  assert.deepEqual(
    (await read(teacher, run, learner)).decisions,
    learnerView.decisions,
  );
  assert.deepEqual((await read(teacher)).decisions, []);
  await sql(`insert into private.course_assignment_reviews(attempt_id,version,state,scores,feedback,private_note)
    values (${q(attempt)},3,'released','[10]','','Private correction')`);
  assert.deepEqual((await read(learner)).decisions, learnerView.decisions);
  assert.equal(
    (await read(teacher, run, learner)).assignment_options[0].score,
    100,
  );
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
  const archive = { id, archived: true };
  await assert.rejects(
    action(teacher, "archive_framework", archive, 2),
    /42501/,
  );
  assert.equal(
    (await action(admin, "archive_framework", archive, 2)).revision,
    3,
  );
  assert.equal(
    (await action(admin, "archive_framework", archive, 2)).revision,
    3,
  );
  await assert.rejects(
    action(admin, "save_framework", updatedFramework, 3),
    /42501/,
  );
  await assert.rejects(
    action(admin, "pin", { ...pin, framework_revision: 3 }, 2),
    /42501/,
  );
  assert.equal((await read(admin)).frameworks[0].archived, true);
  assert.equal((await read(learner)).pinned_framework.revision, 2);
  assert.equal(
    (await action(admin, "archive_framework", { id, archived: false }, 3))
      .revision,
    4,
  );
  assert.equal((await read(admin)).frameworks[0].archived, false);

  const examQuestions = [{ prompt: "Explain the route.", max_points: 10 }];
  await sql(`insert into private.course_text_exam_versions (run_id,revision,title,opens_at,closes_at,questions,pass_percent,published_at)
      values (${q(run)},1,'Fictional text evidence',now()-interval '2 hours',now()-interval '1 hour',
        ${q(JSON.stringify(examQuestions))},50,now()-interval '2 hours');
    insert into private.course_text_exam_attempts (run_id,exam_revision,learner_id,revision,answers,submitted_at)
      values (${q(run)},1,${q(learner)},1,'["Private exam answer"]',now()-interval '1 hour');
    insert into private.course_text_exam_reviews (run_id,exam_revision,learner_id,revision,points,feedback,released_at)
      values (${q(run)},1,${q(learner)},1,'[7]','Private review feedback',null);`);
  const assessExam = (revision, expected) =>
    action(
      teacher,
      "assess",
      {
        ...assessment,
        include_quiz: false,
        pin_revision: 2,
        text_exam_evidence: { exam_revision: 1, review_revision: revision },
      },
      expected,
    );
  assert.equal((await read(teacher, run, learner)).text_exam_option, null);
  await assert.rejects(assessExam(1, 0), /PT409/);
  await sql(`update private.course_text_exam_reviews set released_at=now()
    where run_id=${q(run)} and learner_id=${q(learner)} and revision=1`);
  const examEvidence = (await read(teacher, run, learner)).text_exam_option;
  assert.deepEqual(examEvidence, {
    exam_revision: 1,
    review_revision: 1,
    title: "Fictional text evidence",
    score: 7,
    max_points: 10,
  });
  assert.equal((await assessExam(1, 0)).revision, 1);
  const learnerEvidence = await read(learner);
  assert.equal(learnerEvidence.text_exam_option, null);
  assert.deepEqual(
    learnerEvidence.decisions[0].text_exam_evidence,
    examEvidence,
  );
  assert.ok(!JSON.stringify(learnerEvidence).includes("Private review"));
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
