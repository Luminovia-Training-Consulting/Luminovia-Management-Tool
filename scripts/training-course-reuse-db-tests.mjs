/** Native course reuse must stay atomic, tenant-scoped and free of live access data. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("training_reuse", async ({ sql, actor }) => {
  const [
    admin,
    lecturer,
    company,
    otherCompany,
    contact,
    foreignContact,
    venue,
    foreignVenue,
    template,
    source,
    session,
    alternateSession,
    sourceJob,
  ] = Array.from({ length: 13 }, () => randomUUID());
  await sql(`
    insert into auth.users(id) values ('${admin}'),('${lecturer}');
    insert into public.user_roles(user_id,role) values ('${admin}','admin'),('${lecturer}','lecturer');
    insert into public.organisations(id,name) values ('${company}','Fictional first customer'),('${otherCompany}','Fictional second customer');
    insert into public.organisation_contacts(id,organisation_id,name) values
      ('${contact}','${company}','Fictional contact'),('${foreignContact}','${otherCompany}','Foreign contact');
    insert into public.course_templates(id,title,description,owner_organisation_id) values
      ('${template}','Fictional source course','Selected course description','${company}');
    insert into public.course_runs(id,template_id,organisation_id,delivery_type,time_zone,published,venue)
    values ('${source}','${template}','${company}','onsite','Europe/Berlin',true,'https://example.invalid/access?token=old-secret');
    insert into public.course_sessions(id,course_run_id,starts_at,ends_at) values
      ('${session}','${source}','2040-03-14 08:30Z','2040-03-14 11:30Z'),
      ('${alternateSession}','${source}','2040-03-16 11:00Z','2040-03-16 13:00Z');
    insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)
    values ('${sourceJob}','${source}','Fictional source offer','Fictional first customer','onsite','draft',200,200,'EUR','fixed_total','Existing terms');
    insert into private.course_preparation_items(run_id,label,client_visible,done,updated_by)
    values ('${source}','Alternate projection setup',false,true,'${admin}');
    insert into private.course_workspace_settings(run_id,contact_id,version) values ('${source}','${contact}',3);
    insert into private.training_venues(id,organisation_id,details) values
      ('${venue}','${company}','{"name":"Fictional classroom","city":"Berlin","country":"DE","time_zone":"Europe/Berlin","house_number":"1","reception":"private-access"}'),
      ('${foreignVenue}','${otherCompany}','{"name":"Foreign room","city":"Berlin","country":"DE","time_zone":"Europe/Berlin"}');
    insert into private.training_course_delivery(course_run_id,defaults,overrides_enabled)
    values ('${source}',${quoteSql(
      JSON.stringify({
        mode: "hybrid",
        venue_id: venue,
        meeting_platform: "meet",
        meeting_url: "https://example.invalid/private",
        meeting_id: "existing-id",
        meeting_access: "old-secret",
        teaching_instructions: "old-door-code",
      }),
    )},true);
    insert into private.training_session_delivery(course_session_id,config)
    values ('${alternateSession}',${quoteSql(
      JSON.stringify({
        mode: "online",
        venue_id: foreignVenue,
        meeting_platform: "teams",
        meeting_url: "https://example.invalid/override",
      }),
    )});
  `);
  await actor(
    admin,
    `select public.set_company_premium('${company}',true,0,'${randomUUID()}')`,
  );
  const [
    adminDocument,
    adminVersion,
    adminShare,
    lecturerDocument,
    lecturerVersion,
    lecturerShare,
  ] = Array.from({ length: 6 }, () => randomUUID());
  for (const [owner, document, version, link] of [
    [admin, adminDocument, adminVersion, adminShare],
    [lecturer, lecturerDocument, lecturerVersion, lecturerShare],
  ]) {
    await sql(`
      insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
        values ('${document}','${owner}','${owner}','personal','material','Fictional.pdf','application/pdf',10,'clean','${randomUUID()}');
      insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)
        values ('${version}','${document}','${owner}','${randomUUID()}',1,'fictional/${version}.pdf','Fictional.pdf','application/pdf',10,'clean','${"a".repeat(64)}');
      update public.documents set current_version_id = '${version}' where id = '${document}';
      insert into private.course_resources(id,run_id,version_id,audience,category,created_by)
        values ('${link}','${source}','${version}','staff','material','${owner}');
    `);
  }
  const options = {
    template: "copy",
    title: "Independent content copy",
    schedule: "shift",
    first_day: "2040-07-10",
    delivery: true,
    venue: true,
    preparation: true,
    contact: true,
    materials: true,
  };
  const call = (
    person,
    action,
    plan = options,
    revision = null,
    request = null,
  ) =>
    actor(
      person,
      `select public.copy_training_course('${source}',${quoteSql(action)},${quoteSql(JSON.stringify(plan))},
      ${revision ? quoteSql(revision) : "null"},${request ? quoteSql(request) : "null"})`,
    ).then(JSON.parse);
  await assert.rejects(
    call(lecturer, "preview"),
    /insufficient_privilege|42501/,
  );
  const review = await call(admin, "preview");
  assert.equal(review.title, options.title);
  assert.equal(review.preparation_count, 1);
  assert.equal(review.structured_delivery, true);
  assert.equal(review.contact, true);
  assert.equal(review.material_count, 1);
  assert.equal(
    new Date(review.sessions[0].starts_at).toISOString(),
    "2040-07-10T07:30:00.000Z",
  );
  assert.equal(
    new Date(review.sessions[1].starts_at).toISOString(),
    "2040-07-12T10:00:00.000Z",
  );
  const previewText = JSON.stringify(review);
  assert.ok(
    !/private-access|old-secret|existing-id|private|Forbidden room|old-door-code/.test(
      previewText,
    ),
  );
  await sql(
    `update private.course_preparation_items set label = 'Revised projection setup' where run_id = '${source}'`,
  );
  const request = randomUUID();
  await assert.rejects(
    call(admin, "save", options, review.revision, request),
    /review the new preview/,
  );
  assert.equal(await sql("select count(*) from public.course_runs"), "1");
  const fresh = await call(admin, "preview");
  const copied = await call(admin, "save", options, fresh.revision, request);
  assert.deepEqual(
    await call(admin, "save", options, fresh.revision, request),
    copied,
  );
  await assert.rejects(
    call(
      admin,
      "save",
      { ...options, contact: false },
      fresh.revision,
      request,
    ),
    /committed values/,
  );
  const target = copied.course_run_id;
  assert.notEqual(target, source);
  const run = JSON.parse(
    await sql(
      `select to_jsonb(run) from public.course_runs run where id='${target}'`,
    ),
  );
  assert.equal(run.organisation_id, company);
  assert.equal(run.published, false);
  assert.equal(run.venue, "");
  assert.equal(run.archived_at, null);
  assert.equal(
    await sql(
      `select version_id from private.course_resources where run_id = '${target}'`,
    ),
    adminVersion,
  );
  assert.notEqual(
    await sql(
      `select id from private.course_resources where run_id = '${target}'`,
    ),
    adminShare,
  );

  assert.notEqual(run.template_id, template);
  assert.equal(
    await sql(
      `select description from public.course_templates where id='${run.template_id}'`,
    ),
    "Selected course description",
  );
  assert.equal(
    await sql(
      `select count(*) from public.jobs where course_run_id='${target}'`,
    ),
    "0",
  );
  assert.equal(
    await sql(
      `select contact_id from private.course_workspace_settings where run_id='${target}'`,
    ),
    contact,
  );
  assert.equal(
    await sql(
      `select done::text||':'||label from private.course_preparation_items where run_id='${target}'`,
    ),
    "false:Revised projection setup",
  );
  const delivery = JSON.parse(
    await sql(
      `select defaults from private.training_course_delivery where course_run_id='${target}'`,
    ),
  );
  assert.equal(delivery.venue_id, venue);
  assert.equal(delivery.venue.house_number, "1");
  assert.equal(delivery.meeting_platform, "meet");
  assert.ok(
    !/private-access|old-secret|existing-id|meeting_url|meeting_id/.test(
      JSON.stringify(delivery),
    ),
  );
  const override = JSON.parse(
    await sql(`select o.config from private.training_session_delivery o
    join public.course_sessions s on s.id=o.course_session_id where s.course_run_id='${target}'`),
  );
  assert.deepEqual(override, {
    mode: "online",
    meeting_platform: "teams",
    venue_id: null,
    venue: null,
  });
  console.log(
    "PASS Review, shifted local times, stale source rejection, idempotence, tenant-scoped delivery and stripped credentials",
  );
  assert.ok(
    (
      await sql(`select private.deletion_selector(private.deletion_scope('course_run','${target}'),
    'private.training_course_copy_requests')`)
    ).includes(target),
  );
  console.log(
    "PASS Exact own scanned material share reused and unrelated personal material stays on source",
  );

  await sql(
    `update private.course_workspace_settings set contact_id='${foreignContact}' where run_id='${source}'`,
  );
  const none = {
    ...options,
    template: "blank",
    title: "Clear draft",
    schedule: "none",
    delivery: false,
    venue: false,
  };
  const blankReview = await call(admin, "preview", none);
  assert.equal(blankReview.contact, false);
  const blank = await call(
    admin,
    "save",
    none,
    blankReview.revision,
    randomUUID(),
  );
  assert.equal(
    await sql(
      `select count(*) from public.course_sessions where course_run_id='${blank.course_run_id}'`,
    ),
    "0",
  );
  assert.equal(
    await sql(
      `select count(*) from private.course_workspace_settings where run_id='${blank.course_run_id}'`,
    ),
    "0",
  );
  assert.equal(
    await sql(
      `select description from public.course_templates t join public.course_runs r on t.id = r.template_id where r.id='${blank.course_run_id}'`,
    ),
    "",
  );
  console.log(
    "PASS Blank course copy excludes sessions and unrelated customer contacts",
  );

  assert.equal(
    await sql(
      `select private.training_copy_session_instant(timestamp '2040-01-01 02:45','Europe/Berlin') at time zone 'UTC'`,
    ),
    "2040-01-01 01:45:00",
  );
  await assert.rejects(
    sql(`select private.training_copy_session_instant(
    (date '2040-03-31' - extract(dow from date '2040-03-31')::integer) + time '02:45','Europe/Berlin')`),
    /missing or ambiguous/,
  );
  await assert.rejects(
    sql(`select private.training_copy_session_instant(
    (date '2040-10-31' - extract(dow from date '2040-10-31')::integer) + time '02:45','Europe/Berlin')`),
    /missing or ambiguous/,
  );
  console.log(
    "PASS DST folds and gaps reject from server-side shifted scheduling",
  );

  const management = randomUUID();
  await sql(`
    insert into auth.users(id) values ('${management}');
    insert into public.user_roles(user_id,role) values ('${management}','management');
    insert into public.job_sessions(job_id,course_session_id,starts_at,ends_at)
      select '${sourceJob}',id,starts_at,ends_at from public.course_sessions where course_run_id = '${source}';
    insert into private.job_matching_requirements(job_id,qualification_topics,teaching_languages)
      values ('${sourceJob}','{}',array['de']);
  `);
  await actor(
    admin,
    `select public.set_job_commission('${sourceJob}',200,200,20)`,
  );
  const originalPrice = JSON.parse(
    await actor(
      admin,
      `select public.training_offer_compensation('${sourceJob}','read')`,
    ),
  );
  const templatePrice = {
    configuration: {
      unit_minutes: 60,
      components: [
        {
          kind: "travel",
          label: "",
          basis: "fixed_total",
          treatment: "pass_through",
          customer_rate: "45.00",
          reason: "",
        },
      ],
    },
    unpaid_breaks: {},
  };
  await actor(
    admin,
    `select public.training_offer_compensation('${sourceJob}','save',${originalPrice.terms_version},
    ${quoteSql(JSON.stringify(templatePrice))})`,
  );
  const financeOptions = await call(admin, "options", {});
  assert.deepEqual(financeOptions, [
    { id: sourceJob, title: "Fictional source offer", currency: "EUR" },
  ]);
  assert.deepEqual(await call(management, "options", {}), []);
  const offerPlan = {
    ...options,
    offer_id: sourceJob,
    offer_requirements: true,
  };
  await assert.rejects(
    call(management, "preview", offerPlan),
    /insufficient_privilege|42501/,
  );
  const offerReview = await call(admin, "preview", offerPlan);
  assert.equal(offerReview.offer.base_total, 200);
  const copiedOfferRun = await call(
    admin,
    "save",
    offerPlan,
    offerReview.revision,
    randomUUID(),
  );
  const withOffer = JSON.parse(
    await sql(`select to_jsonb(job) from public.jobs job
    where course_run_id='${copiedOfferRun.course_run_id}'`),
  );
  assert.notEqual(withOffer.id, sourceJob);
  assert.equal(withOffer.status, "draft");
  assert.notEqual(withOffer.terms, "Existing terms");
  assert.equal(
    await sql(
      `select count(*) from public.job_claims where job_id='${withOffer.id}'`,
    ),
    "0",
  );
  assert.equal(
    await sql(
      `select gross_total_amount from private.job_commission_offers where job_id='${withOffer.id}'`,
    ),
    "200.00",
  );
  assert.equal(
    await sql(`select training_components->'configuration'->'components'->0->>'customer_rate'
    from private.job_commission_offers where job_id='${withOffer.id}'`),
    "45.00",
  );
  assert.equal(
    await sql(
      `select teaching_languages[1] from private.job_matching_requirements where job_id='${withOffer.id}'`,
    ),
    "de",
  );
  console.log(
    "PASS Optional paid offer draft copies scoped base pricing, compensation and requirements without prior terms or claims",
  );
});
