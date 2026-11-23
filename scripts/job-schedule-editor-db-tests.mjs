/** Verify the public offer editor against actual job, course and claim records. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("job_schedule_editor", async ({ sql, actor }) => {
  const [admin, manager, lecturer, company, originalTopic, nextTopic] =
    Array.from({ length: 6 }, randomUUID);
  await sql(`
    insert into auth.users(id,email) values
    ${[admin, manager, lecturer, company].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
    insert into public.user_roles(user_id,role) values
    (${q(admin)},'admin'),(${q(manager)},'management'),(${q(lecturer)},'lecturer'),(${q(company)},'client');
    insert into public.topics(id,label_de,label_en,kind) values
    (${q(originalTopic)},'Prüfthema Alt','Original topic','topic'),(${q(nextTopic)},'Prüfthema Neu','Next topic','topic');
    insert into public.lecturer_topics(user_id,topic_id,verified) values
    (${q(lecturer)},${q(originalTopic)},true),(${q(lecturer)},${q(nextTopic)},true);
  `);

  const slot = (day, start, end) => ({
    starts_at: `2042-04-${day}T${start}:00:00Z`,
    ends_at: `2042-04-${day}T${end}:00:00Z`,
  });
  const first = slot("01", "08", "12");
  const next = slot("03", "09", "14");
  const added = slot("04", "08", "12");
  const create = async () =>
    actor(
      admin,
      `
    select public.create_capacity_job(${q(
      JSON.stringify({
        title: "Fictional future teaching offer",
        description: "Existing description",
        delivery_type: "onsite",
        location: "Training room A",
        customer_name: "Fictional Training",
        time_zone: "Europe/Berlin",
        currency: "EUR",
        rate_unit: "fixed_total",
        amount: 100,
        total_amount: 100,
        terms: "Training delivery under agreed terms",
        status: "published",
        sessions: [first, slot("02", "08", "12")],
        topic_ids: [originalTopic],
      }),
    )}::jsonb, 1, ${q(randomUUID())});
  `,
      "aal1",
    );
  const job = String(await create());
  const detail = async (who = manager) =>
    JSON.parse(await actor(who, `select public.job_detail(${q(job)})`, "aal1"));
  const lifecycle = async () =>
    JSON.parse(
      await actor(manager, `select public.job_lifecycle(${q(job)})`, "aal1"),
    );
  const edit = (who, version, payload, key = randomUUID()) =>
    actor(
      who,
      `
      select public.manage_job_offer(${q(job)},'edit',${version},${q(key)},${q(JSON.stringify(payload))}::jsonb)
    `,
      "aal1",
    );

  const initial = await detail();
  const previous = await lifecycle();
  assert.equal(previous.can_edit_schedule, true);
  const payload = {
    description: "Bring printed handouts",
    location: "Training room B",
    sessions: [first, next, added],
    topic_ids: [nextTopic],
  };
  await assert.rejects(edit(lecturer, previous.version, payload), /42501/);
  await assert.rejects(edit(company, previous.version, payload), /42501/);
  await assert.rejects(
    edit(manager, previous.version, {
      ...payload,
      sessions: [first, slot("01", "10", "14")],
    }),
    /22023/,
  );
  await assert.rejects(
    edit(manager, previous.version, {
      ...payload,
      claim_deadline: "2042-04-02T08:00:00Z",
    }),
    /22023/,
  );
  assert.deepEqual(
    await detail(),
    initial,
    "rejected multi-field edits must roll back",
  );

  const key = randomUUID();
  assert.equal(await edit(manager, previous.version, payload, key), job);
  assert.equal(await edit(manager, previous.version, payload, key), job);
  await assert.rejects(edit(manager, previous.version, payload), /40001/);
  const after = await detail(lecturer);
  assert.equal(after.description, payload.description);
  assert.equal(after.location, payload.location);
  assert.deepEqual(after.job_requirements, [{ topic_id: nextTopic }]);
  assert.equal(after.job_sessions.length, 3);
  assert.equal(after.job_sessions[0].id, initial.job_sessions[0].id);
  assert.equal(
    Date.parse(after.job_sessions[1].starts_at),
    Date.parse(next.starts_at),
  );
  assert.equal(after.terms_version, initial.terms_version + 1);
  assert.equal(
    await sql(`
    select count(*) from public.jobs j
      join public.job_sessions offer on offer.job_id = j.id
      join public.course_sessions course on course.id = offer.course_session_id and course.course_run_id = j.course_run_id
    where j.id = ${q(job)} and (course.starts_at, course.ends_at) = (offer.starts_at, offer.ends_at)
  `),
    "3",
  );

  // A later enrolment makes even an unaccepted published schedule read-only.
  await sql(`
    insert into public.course_enrolments(course_run_id,user_id,enrolled_by)
    select course_run_id,${q(company)},${q(admin)} from public.jobs where id = ${q(job)}
  `);
  const protectedCourse = await lifecycle();
  assert.equal(protectedCourse.can_edit_schedule, false);
  await assert.rejects(
    edit(manager, protectedCourse.version, { sessions: [next] }),
    /22023/,
  );
  await sql(
    `delete from public.course_enrolments where user_id = ${q(company)}`,
  );

  const claim = (version) =>
    actor(
      lecturer,
      `
    select public.claim_job(${q(job)},${q(randomUUID())},${version})
  `,
      "aal1",
    ).then(JSON.parse);
  assert.equal((await claim(initial.terms_version)).status, "terms_changed");
  assert.equal((await claim(after.terms_version)).status, "confirmed");
  const accepted = await lifecycle();
  assert.equal(accepted.can_edit_schedule, false);
  await assert.rejects(
    edit(manager, accepted.version, { sessions: [next] }),
    /22023/,
  );
  console.log(
    "PASS versioned published job edits, course synchronisation, access and immutable claims.",
  );
});
