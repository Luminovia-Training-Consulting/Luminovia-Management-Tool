import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const denied = /42501/;
const value = (entry) =>
  entry === null
    ? "null"
    : typeof entry === "string"
      ? q(entry)
      : String(entry);

await withTestDatabase("company_class_feedback", async ({ sql, actor }) => {
  const [
    admin,
    company,
    foreign,
    instructor,
    peer,
    employee,
    org,
    otherOrg,
    course,
    template,
    classroom,
    otherClass,
    job,
    claim,
    slot,
  ] = Array.from({ length: 15 }, randomUUID);
  const people = [
    [admin, "admin"],
    [company, "client"],
    [foreign, "client"],
    [instructor, "lecturer"],
    [peer, "lecturer"],
    [employee, "participant"],
  ];
  await sql(`
    insert into auth.users(id,email,email_confirmed_at) values
      ${people.map(([id]) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
    insert into public.user_roles(user_id,role) values
      ${people.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
    insert into public.organisations(id,name) values
      (${q(org)},'Fictional company'),(${q(otherOrg)},'Other fictional company');
    insert into public.client_organisation_memberships(user_id,organisation_id) values
      (${q(company)},${q(org)}),(${q(foreign)},${q(otherOrg)});
    insert into public.course_templates(id,title) values (${q(template)},'Fictional training');
    insert into public.course_runs(id,template_id,organisation_id) values (${q(course)},${q(template)},${q(org)});
    insert into public.course_sessions(course_run_id,starts_at,ends_at)
      values (${q(course)},now()-interval '3 hours',now()-interval '2 hours');
    insert into private.course_classes(id,organisation_id,name) values
      (${q(classroom)},${q(org)},'Fictional class'),(${q(otherClass)},${q(otherOrg)},'Foreign class');
    insert into private.course_class_assignments(course_id,organisation_id,class_id,version)
      values (${q(course)},${q(org)},${q(classroom)},1);
    insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms)
      values(${q(job)},${q(course)},'Fictional teaching','Fictional training','online','filled',100,'EUR','fixed_total',100,'Fictional course');
    insert into private.job_dispatch(job_id,organisation_id,class_id,class_name)
      values (${q(job)},${q(org)},${q(classroom)},'Fictional class');
    insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version)
      values(${q(claim)},${q(job)},${q(instructor)},${q(randomUUID())},100,'EUR','fixed_total',100,'Fictional course',1);
    insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at)
      values(${q(slot)},${q(claim)},${q(instructor)},now()-interval '1 hour',now()+interval '1 hour');
  `);
  const rpc = (who, name, ...args) =>
    actor(
      who,
      `
    set local request.path=${q(`/rpc/${name}`)};
    set local request.method='POST'; select public.require_portal_access();
    select to_jsonb(public.${name}(${args.map(value).join(",")}));
  `,
    ).then(JSON.parse);
  const feedback = (who, classId = classroom, jobId = null, after = null) =>
    rpc(who, "class_feedback", classId, jobId, after);
  const rate = (
    who,
    classId = classroom,
    score = 4,
    version = 0,
    comment = "Clear exchanges",
  ) => rpc(who, "save_job_class_rating", job, classId, score, version, comment);
  const note = (who, comment, requestId, classId = classroom) =>
    rpc(who, "add_company_class_note", classId, comment, requestId);

  const companyView = await feedback(company);
  assert.deepEqual(companyView, {
    count: 0,
    average: null,
    comments: { items: [], next: null },
    rating: null,
    can_rate: false,
    can_comment: true,
  });
  await assert.rejects(feedback(foreign), denied);
  await assert.rejects(feedback(company, otherClass), denied);
  await assert.rejects(feedback(instructor), denied);
  await assert.rejects(feedback(peer, classroom, job), denied);
  await assert.rejects(feedback(instructor, otherClass, job), denied);
  await assert.rejects(feedback(employee, classroom, job), denied);
  await assert.rejects(
    actor(company, "select * from private.company_class_notes"),
    denied,
  );
  await assert.rejects(rate(company), denied);
  assert.equal((await feedback(instructor, classroom, job)).can_rate, false);
  await assert.rejects(rate(instructor), denied);

  const requestId = randomUUID();
  await assert.rejects(note(foreign, "Foreign comment", requestId), denied);
  await assert.rejects(
    note(instructor, "I am not company staff", requestId),
    denied,
  );
  await assert.rejects(note(company, "  ", requestId), /22023/);
  const writtenNote = await note(company, " Company class note ", requestId);
  assert.equal(
    await note(company, "Company class note", requestId),
    writtenNote,
  );
  await assert.rejects(note(company, "A different note", requestId), /PT409/);
  await note(admin, "Staff class note", randomUUID());
  const notes = (await feedback(instructor, classroom, job)).comments.items;
  assert.deepEqual(
    new Set(notes.map(({ comment }) => comment)),
    new Set(["Company class note", "Staff class note"]),
  );
  for (const item of notes)
    assert.deepEqual(Object.keys(item).sort(), [
      "comment",
      "id",
      "score",
      "source",
    ]);
  console.log(
    "PASS company and staff comment with idempotent receipts; foreign companies and unrelated lecturers are denied",
  );

  await sql(
    `update public.assignment_sessions set starts_at=now()-interval '3 hours',ends_at=now()-interval '2 hours' where id=${q(slot)}`,
  );
  assert.equal((await feedback(instructor, classroom, job)).can_rate, true);
  await assert.rejects(rate(instructor, classroom, 0), /22023/);
  await assert.rejects(
    rate(instructor, classroom, 5, 0, "a".repeat(2001)),
    /22023/,
  );
  const saved = { score: 4, version: 1, comment: "Clear exchanges" };
  assert.deepEqual(await rate(instructor), saved);
  assert.deepEqual(await rate(instructor), saved);
  await assert.rejects(rate(instructor, classroom, 3), /PT409/);
  const firstRating = await feedback(company);
  assert.equal(firstRating.average, 4);
  assert.ok(
    firstRating.comments.items.some(
      (item) => item.score === 4 && item.comment === saved.comment,
    ),
  );
  assert.ok(
    firstRating.comments.items.every(
      (item) => item.source === "lecturer" || item.score === null,
    ),
  );
  assert.deepEqual((await feedback(instructor, classroom, job)).rating, saved);
  assert.equal((await feedback(admin)).count, 1);
  assert.ok(!JSON.stringify(await feedback(company)).includes(instructor));
  assert.equal(
    await sql("select count(*) from private.course_evaluations"),
    "1",
  );

  await rpc(admin, "set_company_premium", org, true, 0, randomUUID());
  const editedInCourse = await rpc(
    instructor,
    "save_course_evaluation",
    course,
    "lecturer",
    "class",
    classroom,
    5,
    1,
    "",
  );
  assert.equal(editedInCourse.version, 2);
  assert.ok(
    (await feedback(company)).comments.items.some(
      (item) =>
        item.source === "lecturer" && item.score === 5 && item.comment === "",
    ),
  );
  assert.deepEqual((await feedback(instructor, classroom, job)).rating, {
    score: 5,
    comment: "",
    version: 2,
  });
  assert.equal(
    await sql("select count(*) from private.course_evaluation_revisions"),
    "2",
  );
  console.log(
    "PASS after the confirmed teaching schedule, the same versioned rating works from assignment and course",
  );

  await rpc(company, "set_company_lecturer_block", org, instructor, true, 0);
  await assert.rejects(feedback(instructor, classroom, job), denied);
  await assert.rejects(rate(instructor, classroom, 4, 2), denied);
  await rpc(company, "set_company_lecturer_block", org, instructor, false, 1);
  assert.equal((await feedback(instructor, classroom, job)).can_rate, true);
  await sql(
    `update public.client_organisation_memberships set removed_at=now() where user_id=${q(company)} and organisation_id=${q(org)}`,
  );
  await assert.rejects(feedback(company), denied);
  await assert.rejects(
    note(company, "I used to have access", requestId),
    denied,
  );

  await sql(`insert into private.company_class_notes(class_id,organisation_id,author_id,request_id,comment)
    select ${q(classroom)},${q(org)},${q(admin)},gen_random_uuid(),'Fictional comment ' || n
    from generate_series(1,25) n`);
  const first = await feedback(admin);
  const next = await feedback(admin, classroom, null, first.comments.next);
  assert.equal(first.comments.items.length, 25);
  assert.equal(next.comments.next, null);
  assert.equal(
    new Set(
      [...first.comments.items, ...next.comments.items].map(({ id }) => id),
    ).size,
    28,
  );
  assert.match(
    await sql(
      `select private.deletion_selector(private.deletion_scope('account',${q(company)}),'private.company_class_notes')`,
    ),
    /author_id/,
  );
  console.log(
    "PASS blocked or removed memberships lose access, and comments page without duplicates",
  );
});
