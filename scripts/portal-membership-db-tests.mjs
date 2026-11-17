/** Retained participant JWT denial and current company lecturer-review authority. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase } from "./testing/database.mjs";
await withTestDatabase("portal_membership", async ({ sql, actor }) => {
  const participant = randomUUID(),
    lecturer = randomUUID(),
    company = randomUUID();
  await sql(
    `insert into auth.users(id,email) values('${participant}','participant@example.invalid'),('${lecturer}','lecturer@example.invalid'),('${company}','company@example.invalid');insert into public.user_roles(user_id,role) values('${participant}','participant'),('${lecturer}','lecturer'),('${company}','client');`,
  );
  assert.equal(await actor(participant, "select private.actor_active()"), "f");
  assert.equal(
    await actor(participant, "select count(*) from public.profiles"),
    "0",
  );
  await assert.rejects(
    actor(participant, "select public.require_portal_access()"),
    /Portal access requires/,
  );
  assert.equal(await actor(lecturer, "select public.portal_access()"), "t");
  await actor(lecturer, "select public.require_portal_access()");
  await actor(company, "select public.require_portal_access()");
  await sql(
    `begin;set local role anon;select public.require_portal_access();rollback;`,
  );
  await sql(
    `begin;set local role service_role;select public.require_portal_access();rollback;`,
  );
  const org = randomUUID(),
    template = randomUUID(),
    run = randomUUID(),
    job = randomUUID(),
    claim = randomUUID();
  await sql(`insert into public.organisations(id,name) values('${org}','Fictional Academy');
    insert into public.client_organisation_memberships(user_id,organisation_id) values('${company}','${org}');
    insert into public.course_templates(id,title) values('${template}','Completed course');
    insert into public.course_runs(id,template_id,organisation_id,published) values('${run}','${template}','${org}',false);
    insert into public.course_sessions(course_run_id,starts_at,ends_at) values('${run}',now()-interval '2 day',now()-interval '1 day');
    insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,time_zone,status,amount,currency,rate_unit,total_amount,terms) values('${job}','${run}','Fictional assignment','Fictional Academy','online','Europe/Berlin','filled',100,'EUR','fixed_total',100,'Fictional terms');
    insert into public.job_sessions(job_id,starts_at,ends_at) values('${job}',now()-interval '2 day',now()-interval '1 day');
    insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version) values('${claim}','${job}','${lecturer}','${randomUUID()}',100,'EUR','fixed_total',100,'Fictional terms',1);`);
  assert.equal(
    JSON.parse(await actor(company, "select public.reviewable_courses()"))
      .length,
    1,
  );
  const room = randomUUID();
  await sql(`insert into public.chat_rooms(id,job_id,kind,title) values('${room}','${job}','lecturer_course','Course team') on conflict(job_id) do update set title=excluded.title;
    insert into public.chat_members(room_id,user_id) select id,'${lecturer}' from public.chat_rooms where job_id='${job}' on conflict(room_id,user_id) do update set removed_at=null;`);
  const destinations = JSON.parse(
    await actor(
      lecturer,
      `select public.course_operation_destinations('${run}')`,
    ),
  );
  assert.equal(destinations.organisation.name, "Fictional Academy");
  assert.equal(destinations.lecturers.length, 1);
  assert.equal(destinations.jobs[0].id, job);
  assert.equal(destinations.rooms.length, 1);
  await sql(
    `update public.chat_members set removed_at=now() where user_id='${lecturer}' and room_id in (select id from public.chat_rooms where job_id='${job}')`,
  );
  assert.equal(
    JSON.parse(
      await actor(
        lecturer,
        `select public.course_operation_destinations('${run}')`,
      ),
    ).rooms.length,
    0,
  );
  await assert.rejects(
    actor(participant, `select public.course_operation_destinations('${run}')`),
    /Active course account required/,
  );
  console.log(
    "PASS course destinations use current course, job and exact chat membership",
  );
  const review = await actor(
    company,
    `select public.submit_course_review('${run}','${lecturer}',5,'Helpful instruction',0)`,
  );
  assert.match(review, /^[a-f0-9-]{36}$/);
  await assert.rejects(
    actor(
      lecturer,
      `select public.submit_course_review('${run}','${lecturer}',5,'Self review',0)`,
    ),
    /Invalid review/,
  );
  await assert.rejects(
    actor(
      participant,
      `select public.submit_course_review('${run}','${lecturer}',5,'Participant',0)`,
    ),
    /Active login required/,
  );
  await sql(
    `update public.client_organisation_memberships set removed_at=now() where user_id='${company}'`,
  );
  assert.equal(
    JSON.parse(await actor(company, "select public.reviewable_courses()"))
      .length,
    0,
  );
  await assert.rejects(
    actor(
      company,
      `select public.submit_course_review('${run}','${lecturer}',4,'Stale company membership',1)`,
    ),
    /Company membership/,
  );
  console.log(
    "PASS completed-course company lecturer reviews and revoked-membership denial",
  );
  await sql(`delete from public.user_roles where user_id='${lecturer}'`);
  await assert.rejects(
    actor(lecturer, "select public.require_portal_access()"),
    /Portal access requires/,
  );
  assert.equal(
    await sql(
      `select count(*) from auth.users where id in ('${participant}','${lecturer}','${company}')`,
    ),
    "3",
  );
  console.log(
    "PASS participant/current-role REST guard, direct RLS, operational roles and account preservation",
  );
});
