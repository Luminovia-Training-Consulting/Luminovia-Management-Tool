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
  const create = async (status = "published") =>
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
        status,
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
  // The edit must persist for management, while the exact venue stays
  // protected for lecturers until the assignment disclosure policy permits it.
  assert.equal((await detail()).location, payload.location);
  assert.equal(after.location, "");
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
  assert.equal((await detail(lecturer)).location, "");
  const settings = JSON.parse(
    await actor(manager, "select public.assignment_customer_settings()"),
  );
  await actor(
    manager,
    `select public.save_assignment_customer_settings('on_confirmation',168,${settings.revision})`,
  );
  assert.equal((await detail(lecturer)).location, payload.location);
  const accepted = await lifecycle();
  assert.equal(accepted.can_edit_schedule, false);
  await assert.rejects(
    edit(manager, accepted.version, { sessions: [next] }),
    /22023/,
  );
  const runPayload = async (runId) =>
    JSON.parse(
      await sql(`
      select jsonb_build_object(
        'template_id', run.template_id, 'organisation_id', run.organisation_id,
        'time_zone', run.time_zone, 'delivery_type', run.delivery_type,
        'venue', run.venue, 'published', run.published,
        'sessions', (select jsonb_agg(jsonb_build_object('starts_at', starts_at, 'ends_at', ends_at) order by starts_at)
          from public.course_sessions where course_run_id = run.id)
      ) from public.course_runs run where id = ${q(runId)}
    `),
    );
  const saveRun = (who, runId, body) =>
    actor(
      who,
      `select public.save_course_run(${q(runId)},${q(JSON.stringify(body))}::jsonb)`,
      "aal1",
    );

  // A real confirmed job remains available through the venue-only route.
  const acceptedRun = await sql(`select course_run_id from public.jobs where id = ${q(job)}`);
  const retained = await runPayload(acceptedRun);
  const acceptedPlanning = {
    ...retained,
    expected_job_version: accepted.version,
    job_request_id: randomUUID(),
  };
  await assert.rejects(
    saveRun(manager, acceptedRun, {
      ...acceptedPlanning,
      sessions: [next],
      venue: "Must roll back",
    }),
    /22023/,
  );
  assert.deepEqual(await runPayload(acceptedRun), retained);
  assert.equal(
    await saveRun(manager, acceptedRun, {
      ...acceptedPlanning,
      venue: "Updated course meeting room",
    }),
    acceptedRun,
  );

  const draft = String(await create("draft"));
  const draftRun = await sql(
    `select course_run_id from public.jobs where id = ${q(draft)}`,
  );
  const newTemplate = randomUUID();
  const newCompany = randomUUID();
  await sql(`
    insert into public.course_templates(id,title) values (${q(newTemplate)},'Fictional updated course');
    insert into public.organisations(id,name) values (${q(newCompany)},'Fictional replacement company');
  `);
  const draftBefore = JSON.parse(
    await actor(manager, `select public.job_lifecycle(${q(draft)})`),
  );
  assert.equal(draftBefore.can_edit_course_details, true);
  assert.equal(draftBefore.can_edit_schedule, true);
  assert.equal(draftBefore.can_reassign_company, true);
  const draftBody = {
    ...(await runPayload(draftRun)),
    template_id: newTemplate,
    organisation_id: newCompany,
    time_zone: "Australia/Brisbane",
    delivery_type: "online",
    sessions: [first, next],
    expected_job_version: draftBefore.version,
    job_request_id: randomUUID(),
  };
  await assert.rejects(saveRun(lecturer, draftRun, draftBody), /42501/);
  assert.equal(await saveRun(manager, draftRun, draftBody), draftRun);
  assert.equal(await saveRun(manager, draftRun, draftBody), draftRun);
  const updated = await runPayload(draftRun);
  assert.equal(updated.template_id, newTemplate);
  assert.equal(updated.organisation_id, newCompany);
  assert.equal(updated.time_zone, draftBody.time_zone);
  assert.equal(updated.delivery_type, draftBody.delivery_type);
  assert.deepEqual(
    updated.sessions.map(({ starts_at }) => Date.parse(starts_at)),
    [Date.parse(first.starts_at), Date.parse(next.starts_at)],
  );
  await assert.rejects(
    saveRun(manager, draftRun, {
      ...draftBody,
      time_zone: "Asia/Tokyo",
      job_request_id: randomUUID(),
    }),
    /40001/,
  );
  assert.deepEqual(await runPayload(draftRun), updated);
  assert.deepEqual(
    JSON.parse(
      await sql(`
    select jsonb_build_object('zone', time_zone, 'mode', delivery_type, 'company', customer_name)
    from public.jobs where id = ${q(draft)}
  `),
    ),
    {
      zone: "Australia/Brisbane",
      mode: "online",
      company: "Fictional replacement company",
    },
  );
  const draftVersion = +(await sql(
    `select lifecycle_version from public.jobs where id = ${q(draft)}`,
  ));
  await actor(
    manager,
    `select public.manage_job_offer(${q(draft)}, 'published', ${draftVersion}, ${q(randomUUID())}, '{}'::jsonb)`,
  );
  const open = JSON.parse(
    await actor(manager, `select public.job_lifecycle(${q(draft)})`),
  );
  assert.equal(open.can_edit_course_details, false);
  assert.equal(open.can_edit_schedule, true);
  await assert.rejects(
    saveRun(manager, draftRun, {
      ...draftBody,
      template_id: retained.template_id,
      expected_job_version: open.version,
      job_request_id: randomUUID(),
    }),
    /course_locked/,
  );
  assert.equal(
    await saveRun(manager, draftRun, {
      ...draftBody,
      sessions: [first, added],
      expected_job_version: open.version,
      job_request_id: randomUUID(),
    }),
    draftRun,
  );
  assert.equal(
    await sql(`
    select count(*) from public.job_sessions offer
      join public.course_sessions course on course.id = offer.course_session_id
      where offer.job_id = ${q(draft)} and (offer.starts_at, offer.ends_at) = (course.starts_at, course.ends_at)
  `),
    "2",
  );
  console.log(
    "PASS versioned published job edits, atomic linked course planning, access and immutable claims.",
  );
});
