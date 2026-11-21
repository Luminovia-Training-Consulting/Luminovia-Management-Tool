/** Exercises transactional course events and live delivery authorization in a disposable DB. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";
import { verifyWebhookDeliveryHttp } from "./testing/company-course-webhook-http.mjs";

await withTestDatabase("company_course_webhooks", async ({ actor, sql }) => {
  const [
    admin,
    staff,
    company,
    other,
    course,
    foreignCourse,
    template,
    session,
  ] = Array.from({ length: 8 }, randomUUID);
  await sql(`
    insert into auth.users(id,email,email_confirmed_at) values
      (${q(admin)},'webhooks-admin@example.invalid',now()),(${q(staff)},'webhooks-staff@example.invalid',now());
    insert into public.user_roles(user_id,role) values (${q(admin)},'admin'),(${q(staff)},'management');
    insert into public.organisations(id,name) values (${q(company)},'Fictional company'),(${q(other)},'Other fictional company');
    insert into public.course_templates(id,title) values (${q(template)},'Private title');
    insert into public.course_runs(id,template_id,organisation_id) values
      (${q(course)},${q(template)},${q(company)}),(${q(foreignCourse)},${q(template)},${q(other)});
  `);
  const issue = (organisation, key = null) =>
    actor(
      admin,
      `select public.issue_company_integration_key(${q(organisation)},'Schedule sync',now()+interval '7 days',
      ${key ? q(key.id) + "," + key.version : "null,null"})`,
    );
  const key = JSON.parse(await issue(company));
  const subscribe = (organisation = company, who = admin) =>
    actor(
      who,
      `select public.company_course_webhook_subscribe(${q(organisation)},${q(key.id)},'schedule-sync')`,
    );
  const subscriptionList = async () =>
    JSON.parse(
      await actor(
        admin,
        `select public.company_course_webhook_list(${q(company)})`,
      ),
    );
  const service = (statement) => sql("set role service_role; " + statement);
  const lease = async (organisation = company, alias = "schedule-sync") =>
    JSON.parse(
      await service(
        `select coalesce(public.lease_company_course_webhook(array[${q(organisation + "/" + alias)}]), 'null')`,
      ),
    );
  const prepare = async (row) =>
    JSON.parse(
      await service(
        `select coalesce(public.prepare_company_course_webhook(${q(row.id)},${q(row.token)}),'null')`,
      ),
    );
  const finish = (row, status) =>
    service(
      `select public.finish_company_course_webhook(${q(row.id)},${q(row.token)},${q(status)})`,
    );

  await assert.rejects(subscribe(company, staff), /42501/);
  await assert.rejects(subscribe(other), /42501/);
  await assert.rejects(
    actor(admin, "select public.lease_company_course_webhook(array['x'])"),
    /42501/,
  );
  await assert.rejects(
    service("select signing_secret from private.company_course_webhooks"),
    /42501/,
  );
  const subscription = JSON.parse(await subscribe());
  assert.match(subscription.signing_secret, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(
    JSON.stringify(await subscriptionList()),
    /signing_secret/,
  );
  await assert.rejects(subscribe(), /23505/);

  await sql(
    `begin; update public.course_runs set published=true where id=${q(course)}; rollback`,
  );
  await sql(
    `update public.course_runs set published=true where id=${q(foreignCourse)}`,
  );
  assert.equal(await lease(), null);
  await sql(
    `update public.course_runs set published=true where id=${q(course)}`,
  );
  assert.equal(await lease(other), null);
  const first = await lease();
  assert.equal(first.destination, company + "/schedule-sync");
  assert.equal(await lease(), null);
  const prepared = await prepare(first);
  assert.equal(prepared.signing_secret, subscription.signing_secret);
  assert.equal(prepared.event.course_id, course);
  assert.equal(prepared.event.type, "course.published");
  assert.deepEqual(Object.keys(prepared.event).sort(), [
    "course_id",
    "id",
    "occurred_at",
    "type",
    "version",
  ]);

  await finish(first, "retry");
  assert.equal(await lease(), null);
  await sql(
    `update private.company_course_webhook_deliveries set available_at=now() where id=${q(first.id)}`,
  );
  const retry = await lease();
  assert.notEqual(retry.token, first.token);
  assert.deepEqual((await prepare(retry)).event, prepared.event);
  await finish(first, "failed");
  assert.ok(await prepare(retry));
  await finish(retry, "delivered");
  assert.equal((await subscriptionList())[0].deliveries[0].state, "delivered");

  await sql(`insert into public.course_sessions(id,course_run_id,starts_at,ends_at)
    values(${q(session)},${q(course)},now()+interval '1 day',now()+interval '25 hours')`);
  const schedule = await lease();
  assert.equal((await prepare(schedule)).event.type, "course.schedule_changed");
  await sql(
    `update public.course_runs set published=false where id=${q(course)}`,
  );
  assert.equal(await prepare(schedule), null);

  await sql(
    `update public.course_runs set published=true where id=${q(course)}`,
  );
  const beforeRotation = await lease();
  await issue(company, key);
  assert.equal(await prepare(beforeRotation), null);
  assert.equal((await subscriptionList())[0].active, false);

  const replacementKey = JSON.parse(await issue(company));
  const replacement = JSON.parse(
    await actor(
      admin,
      `select public.company_course_webhook_subscribe(${q(company)},${q(replacementKey.id)},'schedule-sync')`,
    ),
  );
  assert.notEqual(replacement.signing_secret, subscription.signing_secret);
  await sql(
    `update public.course_sessions set ends_at=ends_at+interval '1 hour' where id=${q(session)}`,
  );
  const beforeRevoke = await lease();
  await actor(
    admin,
    `select public.company_course_webhook_revoke(${q(company)},${q(replacement.id)})`,
  );
  assert.equal(await prepare(beforeRevoke), null);
  assert.equal(await lease(), null);
  assert.equal(
    await sql(
      "select count(*) from public.audit_events where action like 'integration.webhook_%'",
    ),
    "3",
  );

  const [learner, document, cleanVersion, secondDocument, secondVersion] =
    Array.from({ length: 5 }, randomUUID);
  const uid = (id) => q(id);
  const premiumKey = JSON.parse(await issue(company));
  const subscribePremium = () =>
    actor(
      admin,
      `select public.company_course_webhook_subscribe(${q(company)},${q(premiumKey.id)},'premium-sync',true)`,
    );
  const leasePremium = () => lease(company, "premium-sync");
  await assert.rejects(subscribePremium(), /42501/);
  await sql(`insert into private.company_premium_settings(organisation_id,enabled,version)
    values(${q(company)},true,1) on conflict(organisation_id) do update set enabled=true,version=1`);
  await subscribePremium();
  await actor(
    admin,
    `select public.company_course_webhook_subscribe(${q(company)},${q(premiumKey.id)},'ordinary-sync')`,
  );
  await sql(`
    insert into auth.users(id,email,email_confirmed_at) values (${q(learner)},'learner@example.invalid',now());
    insert into public.course_enrolments(course_run_id,user_id,enrolled_by) values
      (${q(course)},${q(learner)},${q(admin)});
  `);
  assert.equal(await lease(company, "ordinary-sync"), null);
  const enrolment = await leasePremium();
  assert.equal(
    (await prepare(enrolment)).event.type,
    "course.enrolment_changed",
  );
  await sql(`update private.company_premium_settings set enabled=false,version=2 where organisation_id=${q(company)};
    update private.company_premium_settings set enabled=true,version=3 where organisation_id=${q(company)}`);
  assert.equal(await prepare(enrolment), null);

  await sql(`
    insert into public.documents(id,owner_id,uploaded_by,client_id,scope,kind,original_name,mime_type,size_bytes,status)
      values (${uid(document)},${uid(admin)},${uid(admin)},gen_random_uuid(),'personal','material','Fictional.pdf','application/pdf',10,'clean'),
        (${uid(secondDocument)},${uid(admin)},${uid(admin)},gen_random_uuid(),'personal','material','Fictional 2.pdf','application/pdf',10,'quarantined');
    insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)
      values (${uid(cleanVersion)},${uid(document)},${uid(admin)},gen_random_uuid(),1,'fixture/published','Fictional.pdf','application/pdf',10,'clean',repeat('a',64)),
        (${uid(secondVersion)},${uid(secondDocument)},${uid(admin)},gen_random_uuid(),1,'fixture/pending','Fictional 2.pdf','application/pdf',10,'quarantined',null);
    insert into private.course_exam_documents(run_id,version_id,audience,created_by)
      values (${q(course)},${q(cleanVersion)},'students',${q(admin)});
  `);
  assert.equal(await leasePremium(), null);
  await sql(
    `insert into private.course_exam_settings(run_id,required) values(${q(course)},true)`,
  );
  const exam = await leasePremium();
  assert.equal((await prepare(exam)).event.type, "course.exam_published");
  await finish(exam, "delivered");

  await sql(`insert into private.course_resources(run_id,version_id,audience,category,created_by)
    values (${q(course)},${q(cleanVersion)},'staff','material',${q(admin)}),
      (${q(course)},${q(secondVersion)},'all','material',${q(admin)})`);
  assert.equal(await leasePremium(), null);
  await sql(`insert into private.course_resources(run_id,version_id,audience,category,created_by)
    values (${q(course)},${q(cleanVersion)},'all','material',${q(admin)})`);
  const material = await leasePremium();
  assert.equal(
    (await prepare(material)).event.type,
    "course.material_published",
  );
  await finish(material, "delivered");

  await sql(`begin;
    insert into private.course_attendance(session_id,user_id,state) values(${q(session)},${q(learner)},'attended');
    update private.course_attendance set minutes=45 where session_id=${q(session)} and user_id=${q(learner)};
    commit`);
  const attendance = await leasePremium();
  assert.equal(
    (await prepare(attendance)).event.type,
    "course.attendance_changed",
  );
  assert.equal(await leasePremium(), null);
  await finish(attendance, "delivered");
  console.log(
    "PASS Premium opt-in, entitlement epochs, scanned-only publication and bulk change coalescing",
  );

  const [httpCourse, revokedCourse] = [randomUUID(), randomUUID()];
  const httpKey = JSON.parse(await issue(company));
  const httpSubscription = JSON.parse(
    await actor(
      admin,
      `select public.company_course_webhook_subscribe(${q(company)},${q(httpKey.id)},'signed-http')`,
    ),
  );
  const publish = (id) =>
    sql(`
    insert into public.course_runs(id,template_id,organisation_id,published)
    values (${q(id)},${q(template)},${q(company)},true)
  `);
  await publish(httpCourse);
  await verifyWebhookDeliveryHttp({
    sql,
    destination: company + "/signed-http",
    subscription: httpSubscription,
    course: httpCourse,
    publishNext: () => publish(revokedCourse),
    revoke: () =>
      actor(
        admin,
        `select public.company_course_webhook_revoke(${q(company)},${q(httpSubscription.id)})`,
      ),
  });
  console.log(
    "PASS signed loopback HTTP delivery, database-backed retry, duplicate receipt and leased-event revocation",
  );

  console.log(
    "PASS transactional course events, tenant filtering, signed delivery material, retry fencing and revocation",
  );
});
