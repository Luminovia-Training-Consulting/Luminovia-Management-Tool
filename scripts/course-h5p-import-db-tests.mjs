/** Verify licensed H5P provenance through bank revisions, scoped quizzes and canonical scoring. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("course_hfivep_import", async ({ sql, actor }) => {
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
  const saveImport = (who, payload, course = run) =>
    rpc(
      who,
      "course_h5p_question_import",
      q(course),
      q(JSON.stringify(payload)),
    );
  const question = {
    prompt: "Which command lists a directory?",
    options: ["ls", "pwd"],
    correct: 0,
  };
  const attribution = {
    title: "A fictional H5P question",
    language: "en",
    license: "CC-BY-4.0",
    library: "H5P.MultiChoice 1.16",
    authors: [{ name: "Fictional author", role: "Author" }],
    source_url: "https://example.invalid/resource",
    license_notice: null,
    changes: [],
  };
  const payload = { package_sha256: "12".repeat(32), attribution, question };
  await assert.rejects(saveImport(learner, payload), /42501/);
  await assert.rejects(saveImport(teacher, payload, sibling), /42501/);
  await assert.rejects(
    saveImport(teacher, {
      ...payload,
      attribution: { ...attribution, license: "U" },
    }),
    /22023/,
  );
  await assert.rejects(
    saveImport(teacher, {
      ...payload,
      attribution: { ...attribution, authors: [] },
    }),
    /22023/,
  );
  await assert.rejects(
    saveImport(teacher, {
      ...payload,
      attribution: { ...attribution, source_url: "invalid-url" },
    }),
    /22023/,
  );
  await assert.rejects(
    saveImport(teacher, {
      ...payload,
      uploaded_binary: "not part of the contract",
    }),
    /22023/,
  );

  const [left, right] = await Promise.all([
    saveImport(teacher, payload),
    saveImport(admin, payload, sibling),
  ]);
  assert.equal(left.id, right.id);
  assert.equal(left.revision, 1);
  assert.deepEqual(left.h5p_attribution, attribution);
  assert.equal(
    await sql("select count(*) from private.lms_h5p_question_imports"),
    "1",
  );
  await assert.rejects(
    saveImport(teacher, { ...payload, question: { ...question, correct: 1 } }),
    /PT409/,
  );
  await assert.rejects(
    actor(learner, "select * from private.lms_h5p_question_imports"),
    /42501/,
  );
  const foreignItem = await saveImport(admin, payload, foreign);
  assert.notEqual(foreignItem.id, left.id);
  const bank = await rpc(
    teacher,
    "course_question_bank",
    q(run),
    q(""),
    "false",
    0,
  );
  assert.deepEqual(bank.items[0].h5p_attribution, attribution);
  assert.equal(bank.items[0].id, left.id);
  const action = (who, actionName, body, version = 0) =>
    rpc(
      who,
      "course_question_bank_action",
      q(run),
      q(actionName),
      q(JSON.stringify(body)),
      version,
    );
  const revised = {
    ...question,
    prompt: "Which command displays the files in a directory?",
  };
  await action(
    admin,
    "save",
    {
      id: left.id,
      topic: left.topic,
      difficulty: left.difficulty,
      content: revised,
    },
    1,
  );
  assert.equal((await saveImport(teacher, payload)).revision, 2);
  assert.deepEqual(
    (await saveImport(teacher, payload)).h5p_attribution,
    attribution,
  );
  await action(teacher, "configure", {
    entries: [{ question_id: left.id, revision: 2 }],
    pass_percent: 80,
    max_attempts: 1,
    published: true,
    shuffle: false,
  });
  const learnerQuiz = (await rpc(learner, "course_workspace", q(run))).quiz;
  assert.deepEqual(learnerQuiz.questions, [
    {
      prompt: revised.prompt,
      options: revised.options,
      h5p_attribution: attribution,
    },
  ]);
  const teacherQuiz = (await rpc(teacher, "course_workspace", q(run))).quiz;
  assert.deepEqual(teacherQuiz.questions[0].source, {
    question_id: left.id,
    revision: 2,
  });
  assert.equal(teacherQuiz.questions[0].correct, 0);
  const attempt = await rpc(
    learner,
    "course_workspace_action",
    q(run),
    q("quiz_attempt"),
    q(JSON.stringify({ answers: [0], request_id: randomUUID() })),
    1,
  );
  assert.equal(attempt.score, 100);
  await assert.rejects(
    sql("update private.lms_h5p_question_imports set attribution='{}'"),
    /55000/,
  );
  console.log(
    "PASS H5P import validation, concurrent receipt, organisation and actor scope, immutable attribution and canonical grading",
  );
  const saveCollection = (who, collection, course = run) =>
    rpc(
      who,
      "course_h5p_collection_import",
      q(course),
      q(JSON.stringify(collection)),
    );
  const nestedCredits = {
    ...attribution,
    title: "An independently attributed item",
    library: "H5P.TrueFalse 1.8",
    authors: [{ name: "Fictional second author", role: "Author" }],
  };
  const second = {
    question: {
      prompt: "The command pwd writes the working directory.",
      options: ["True", "False"],
      correct: 0,
    },
    library: "H5P.TrueFalse 1.8",
    subcontent: nestedCredits,
  };
  const collection = {
    package_sha256: "34".repeat(32),
    attribution: {
      ...attribution,
      title: "Fictional collection",
      library: "H5P.QuestionSet 1.21",
    },
    questions: [
      { question, library: attribution.library, subcontent: null },
      second,
    ],
  };
  await assert.rejects(saveCollection(learner, collection), /42501/);
  await assert.rejects(saveCollection(teacher, collection, sibling), /42501/);
  await assert.rejects(
    saveCollection(admin, {
      ...collection,
      questions: [
        collection.questions[0],
        {
          ...second,
          question: { ...second.question, options: ["True", "False", "Other"] },
        },
      ],
    }),
    /22023/,
  );
  assert.equal(
    await sql(
      `select count(*) from private.lms_h5p_question_imports where package_sha256=${q(collection.package_sha256)}`,
    ),
    "0",
  );
  const [firstReceipt, concurrentReceipt] = await Promise.all([
    saveCollection(teacher, collection),
    saveCollection(admin, collection, sibling),
  ]);
  const ids = firstReceipt.questions.map(({ id }) => id);
  assert.equal(new Set(ids).size, 2);
  assert.deepEqual(
    concurrentReceipt.questions.map(({ id }) => id),
    ids,
  );
  assert.deepEqual(firstReceipt.questions[1].h5p_attribution, {
    ...collection.attribution,
    subcontent: nestedCredits,
  });
  assert.equal(
    await sql(`select string_agg(package_position::text, ',' order by package_position)
    from private.lms_h5p_question_imports where package_sha256=${q(collection.package_sha256)}`),
    "1,2",
  );
  await assert.rejects(
    saveCollection(teacher, {
      ...collection,
      questions: [second, collection.questions[0]],
    }),
    /PT409/,
  );
  await assert.rejects(
    saveCollection(teacher, { ...collection, questions: [second] }),
    /PT409/,
  );
  await assert.rejects(
    saveImport(teacher, {
      ...payload,
      package_sha256: collection.package_sha256,
    }),
    /PT409/,
  );
  const otherCompanyReceipt = await saveCollection(admin, collection, foreign);
  assert.ok(otherCompanyReceipt.questions.every(({ id }) => !ids.includes(id)));

  const singleChoice = {
    package_sha256: "56".repeat(32),
    attribution: { ...attribution, library: "H5P.SingleChoiceSet 1.11" },
    questions: [
      {
        library: "H5P.SingleChoiceSet 1.11",
        subcontent: null,
        question: { ...question, correct: 1 },
      },
    ],
  };
  await assert.rejects(saveCollection(teacher, singleChoice), /22023/);
  singleChoice.questions[0].question.correct = 0;
  assert.equal(
    (await saveCollection(teacher, singleChoice)).questions[0].content.correct,
    0,
  );
  await action(
    teacher,
    "configure",
    {
      entries: ids.map((question_id) => ({ question_id, revision: 1 })),
      pass_percent: 50,
      max_attempts: 1,
      published: true,
      shuffle: false,
    },
    1,
  );
  const published = (await rpc(learner, "course_workspace", q(run))).quiz;
  assert.deepEqual(
    published.questions.map(({ prompt }) => prompt),
    [question.prompt, second.question.prompt],
  );
  assert.deepEqual(
    published.questions[1].h5p_attribution.subcontent,
    nestedCredits,
  );
  assert.ok(
    published.questions.every(
      (item) => !("correct" in item) && !("source" in item),
    ),
  );
  assert.equal(
    (
      await rpc(
        learner,
        "course_workspace_action",
        q(run),
        q("quiz_attempt"),
        q(JSON.stringify({ answers: [0, 1], request_id: randomUUID() })),
        2,
      )
    ).score,
    50,
  );
  console.log(
    "PASS both H5P collection types, package atomicity, scoped retry and native grading",
  );
});
