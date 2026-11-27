/** Compare course rows, workspaces and the marketplace before and after a real claim. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("scoped_course_catalogue", async ({ actor, sql }) => {
  const [
    admin,
    winner,
    peer,
    companyA,
    companyB,
    learner,
    orgA,
    orgB,
    template,
    assigned,
    completed,
    privateA,
    privateB,
    offer,
    offerSession,
  ] = Array.from({ length: 15 }, randomUUID);
  const roles = [
    [admin, "admin"],
    [winner, "lecturer"],
    [peer, "lecturer"],
    [companyA, "client"],
    [companyB, "client"],
    [learner, "participant"],
  ];
  const runIds = [assigned, completed, privateA, privateB];
  await sql(`
    insert into auth.users(id,email,email_confirmed_at) values
      ${roles.map(([id]) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
    insert into public.user_roles(user_id,role) values
      ${roles.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
    insert into public.organisations(id,name) values
      (${q(orgA)},'Fictional company A'),(${q(orgB)},'Fictional company B');
    insert into public.client_organisation_memberships(user_id,organisation_id) values
      (${q(companyA)},${q(orgA)}),(${q(companyB)},${q(orgB)});
    insert into public.course_templates(id,title) values(${q(template)},'Fictional training');
    insert into public.course_runs(id,template_id,organisation_id,published) values
      ${runIds.map((id) => `(${q(id)},${q(template)},${q(id === privateB ? orgB : orgA)},${id === privateA})`).join(",")};
    insert into public.course_sessions(id,course_run_id,starts_at,ends_at)
      values(${q(offerSession)},${q(assigned)},'2061-04-10T08:00Z','2061-04-10T10:00Z'),
            (${q(randomUUID())},${q(completed)},'2026-01-10T08:00Z','2026-01-10T10:00Z'),
            (${q(randomUUID())},${q(privateA)},'2061-04-11T08:00Z','2061-04-11T10:00Z'),
            (${q(randomUUID())},${q(privateB)},'2061-04-12T08:00Z','2061-04-12T10:00Z');
    insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms,requires_contract)
      values(${q(offer)},${q(assigned)},'Fictional open course offer','Fictional company A','online','draft',100,'EUR','fixed_total',100,'Fictional accepted terms',false);
    insert into public.job_sessions(job_id,course_session_id,starts_at,ends_at)
      values(${q(offer)},${q(offerSession)},'2061-04-10T08:00Z','2061-04-10T10:00Z');`);

  const rpc = (who, operation) =>
    actor(who, `select to_jsonb(public.${operation})`).then((result) =>
      result ? JSON.parse(result) : null,
    );
  const raw = (who, table, column) =>
    actor(
      who,
      `
    select coalesce(jsonb_agg(distinct ${column}),'[]'::jsonb) from public.${table}
  `,
    ).then((json) => JSON.parse(json).sort());
  const runs = (who) => raw(who, "course_runs", "id");
  const sessions = (who) => raw(who, "course_sessions", "course_run_id");
  const hub = async (who) =>
    (await rpc(who, "my_course_workspaces()")).map(({ id }) => id).sort();
  const detail = (who, run) => rpc(who, `course_workspace(${q(run)})`);
  const listOffers = async (who) =>
    (await rpc(who, "job_offers()")).map(({ id }) => id);

  const setOfferStatus = async (status) => {
    const version = await sql(
      `select lifecycle_version from public.jobs where id=${q(offer)}`,
    );
    await rpc(
      admin,
      `manage_job_offer(${q(offer)},${q(status)},${version},${q(randomUUID())},'{}'::jsonb)`,
    );
  };
  assert.deepEqual(
    await runs(peer),
    [],
    "Neither an offer draft nor the legacy published flag grants a preview",
  );
  const inCompanyPicker = () =>
    sql(`
    select count(*) from private.company_participant_upcoming_courses(${q(orgA)}, array[${q(assigned)}]::uuid[], now())
  `);
  assert.equal(await inCompanyPicker(), "0");
  await setOfferStatus("published");
  assert.equal(await inCompanyPicker(), "1");
  assert.deepEqual(await listOffers(peer), [offer]);
  assert.deepEqual(await runs(peer), []);
  await setOfferStatus("draft");
  assert.equal(await inCompanyPicker(), "0");
  assert.deepEqual(await listOffers(peer), []);
  assert.deepEqual(await runs(peer), []);
  await setOfferStatus("published");
  assert.deepEqual(await runs(winner), []);
  assert.deepEqual(await runs(peer), []);
  assert.deepEqual(await hub(peer), []);
  assert.deepEqual(await listOffers(peer), [offer]);
  assert.deepEqual(
    await runs(companyA),
    [assigned, completed, privateA].sort(),
  );
  assert.deepEqual(await sessions(companyB), [privateB]);
  await assert.rejects(detail(companyA, privateB), /42501/);
  await assert.rejects(detail(companyB, assigned), /42501/);

  const quote = await rpc(winner, `job_detail(${q(offer)})`);
  const accepted = await rpc(
    winner,
    `claim_job(${q(offer)},${q(randomUUID())},${quote.terms_version})`,
  );
  assert.equal(accepted.status, "confirmed");
  assert.deepEqual(await runs(winner), []);
  assert.deepEqual(await sessions(winner), [assigned]);
  assert.deepEqual(await hub(winner), [assigned]);
  await rpc(
    admin,
    "save_assignment_customer_settings('on_confirmation',168,0)",
  );
  assert.deepEqual(await runs(winner), [assigned]);
  assert.deepEqual(await sessions(winner), [assigned]);
  assert.deepEqual(await hub(winner), [assigned]);
  assert.deepEqual(await runs(peer), []);
  assert.deepEqual(await sessions(peer), []);
  assert.deepEqual(await hub(peer), []);
  assert.deepEqual(await listOffers(peer), []);
  await assert.rejects(rpc(peer, `job_detail(${q(offer)})`), /42501/);
  await assert.rejects(detail(peer, assigned), /42501/);

  // A cancelled old allocation cannot provide access to the fully assigned offer.
  await sql(`insert into public.job_claims(job_id,lecturer_id,idempotency_key,status,amount,currency,rate_unit,total_amount,terms,terms_version)
    values(${q(offer)},${q(peer)},${q(randomUUID())},'cancelled',100,'EUR','fixed_total',100,'Fictional historical allocation',1);`);
  await assert.rejects(rpc(peer, `job_detail(${q(offer)})`), /42501/);

  await rpc(admin, `set_company_premium(${q(orgA)},true,0,${q(randomUUID())})`);
  const learnerCode = await sql(
    `select luminovia_user_id from public.profiles where id=${q(learner)}`,
  );
  await rpc(
    admin,
    `request_company_participant_link(${q(orgA)},${q(learnerCode)},${q(randomUUID())})`,
  );
  await rpc(
    learner,
    `accept_company_participant_invitation(${q(orgA)},1,${q(randomUUID())})`,
  );
  await rpc(
    admin,
    `manage_course_enrolment(${q(assigned)},${q(learner)},'enrolled')`,
  );
  await rpc(
    admin,
    `manage_course_enrolment(${q(completed)},${q(learner)},'enrolled')`,
  );
  await rpc(
    admin,
    `manage_course_enrolment(${q(completed)},${q(learner)},'completed')`,
  );
  assert.deepEqual(await hub(learner), [assigned, completed].sort());
  assert.equal((await detail(learner, completed)).access.learner, true);
  await assert.rejects(detail(learner, privateA), /42501/);
  await assert.rejects(detail(learner, privateB), /42501/);
  assert.deepEqual(await hub(companyB), [privateB]);

  await sql(
    `update public.client_organisation_memberships set removed_at=now() where user_id=${q(companyA)}`,
  );
  assert.deepEqual(await runs(companyA), []);
  assert.deepEqual(await hub(companyA), []);
  console.log(
    "PASS Draft, live, withdrawn, claimed-course, cross-company and individually enrolled past/upcoming course visibility.",
  );
});
