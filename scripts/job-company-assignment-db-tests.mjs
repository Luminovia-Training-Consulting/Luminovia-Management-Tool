/** Native company ownership through staff offers, lecturer eligibility and customer submissions. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql, withTestDatabase } from "./testing/database.mjs";

const json = (payload) => quoteSql(JSON.stringify(payload)) + "::jsonb";

await withTestDatabase("job_company", async ({ actor, sql }) => {
  const [
    manager,
    admin,
    companyA,
    companyB,
    lecturer,
    blocked,
    companyOne,
    companyTwo,
    archived,
  ] = Array.from({ length: 9 }, randomUUID);
  const users = [
    [manager, "management"],
    [admin, "admin"],
    [companyA, "client"],
    [companyB, "client"],
    [lecturer, "lecturer"],
    [blocked, "lecturer"],
  ];
  await sql(`
    insert into auth.users(id, email) values
      ${users.map(([id]) => `('${id}', '${id}@example.invalid')`).join(",")};
    insert into public.user_roles(user_id, role) values
      ${users.map(([id, role]) => `('${id}', '${role}')`).join(",")};
    insert into public.organisations(id, name, archived_at) values
      ('${companyOne}', 'Fictional operator one', null),
      ('${companyTwo}', 'Fictional operator two', null),
      ('${archived}', 'Fictional retired operator', now());
    insert into public.client_organisation_memberships(user_id, organisation_id) values
      ('${companyA}', '${companyOne}'), ('${companyB}', '${companyTwo}');
    insert into private.company_lecturer_blocks(organisation_id, lecturer_id, blocked, version) values
      ('${companyTwo}', '${blocked}', true, 1);
  `);
  const payload = {
    customer_name: "Browser-supplied name",
    title: "Fictional scheduled offer",
    delivery_type: "online",
    time_zone: "Europe/Berlin",
    status: "published",
    currency: "EUR",
    rate_unit: "fixed_total",
    terms: "Fictional teaching terms",
    amount: 95,
    total_amount: 95,
    sessions: [
      { starts_at: "2042-02-04T11:00:00Z", ends_at: "2042-02-04T13:00:00Z" },
      { starts_at: "2042-02-05T08:30:00Z", ends_at: "2042-02-05T12:00:00Z" },
    ],
  };
  const create = (company, key, actorId = manager) =>
    actor(
      actorId,
      `select public.create_capacity_job(${json(payload)},1,'${key}','${company}')`,
    );
  const version = (job) =>
    sql(`select lifecycle_version from public.jobs where id='${job}'`);
  const manage = (
    job,
    company,
    revision,
    key,
    requestActor = manager,
    action = "edit",
  ) =>
    actor(
      requestActor,
      `select public.manage_job_offer('${job}','${action}',${revision},'${key}',${json({ organisation_id: company })})`,
    );
  const owner = (job) =>
    sql(
      `select r.organisation_id::text||'|'||j.customer_name from public.jobs j join public.course_runs r on r.id=j.course_run_id where j.id='${job}'`,
    );
  const lifecycle = async (job, user = manager) =>
    JSON.parse(await actor(user, `select public.job_lifecycle('${job}')`));
  const jobs = (user) =>
    actor(
      user,
      "select id from public.company_jobs_for_deletion() order by id",
    );

  const createKey = randomUUID();
  const job = await create(companyOne, createKey);
  assert.equal(await create(companyOne, createKey), job);
  await assert.rejects(create(companyTwo, createKey), /idempotency conflict/i);
  await assert.rejects(
    create(archived, randomUUID()),
    /22023.*Organisation unavailable/s,
  );
  await assert.rejects(create(companyOne, randomUUID(), companyA), /42501/);
  assert.equal(await owner(job), companyOne + "|Fictional operator one");
  assert.equal(await sql("select count(*) from public.organisations"), "3");
  assert.equal(
    await sql("select count(*) from private.job_commission_offers"),
    "0",
  );
  assert.equal((await lifecycle(job)).can_reassign_company, true);
  assert.equal((await lifecycle(job)).organisation_id, companyOne);
  const publicState = await lifecycle(job, lecturer);
  assert.equal(publicState.organisation_id, null);
  assert.equal(publicState.can_reassign_company, false);
  assert.equal(await jobs(companyA), job);
  assert.equal(await jobs(companyB), "");
  console.log(
    "PASS management binds an existing active company without requiring or creating a gross offer",
  );

  const before = await version(job);
  const oldTerms = await sql(
    `select terms_version from public.jobs where id='${job}'`,
  );
  const moveKey = randomUUID();
  await assert.rejects(
    manage(job, companyTwo, before, randomUUID(), companyA),
    /42501/,
  );
  await assert.rejects(
    manage(job, companyTwo, before, randomUUID(), manager, "published"),
    /22023/,
  );
  await assert.rejects(
    manage(job, archived, before, randomUUID()),
    /22023.*Organisation unavailable/s,
  );
  assert.equal(await owner(job), companyOne + "|Fictional operator one");
  assert.equal(await manage(job, companyTwo, before, moveKey), job);
  assert.equal(await manage(job, companyTwo, before, moveKey), job);
  await assert.rejects(manage(job, companyOne, before, randomUUID()), /40001/);
  assert.equal(await owner(job), companyTwo + "|Fictional operator two");
  assert.equal(await jobs(companyA), "");
  assert.equal(await jobs(companyB), job);
  assert.equal(
    await sql(
      `select count(*) from public.audit_events where resource_id='${job}' and action='job.company_assigned'`,
    ),
    "1",
  );
  assert.equal(
    await sql(`select terms_version from public.jobs where id='${job}'`),
    String(Number(oldTerms) + 1),
  );
  assert.equal(
    await actor(blocked, `select count(*) from public.jobs where id='${job}'`),
    "0",
  );
  const staleClaim = JSON.parse(
    await actor(
      lecturer,
      `select public.claim_job('${job}','${randomUUID()}',${oldTerms})`,
    ),
  );
  assert.equal(staleClaim.status, "terms_changed");
  console.log(
    "PASS reassignment moves company scope and block enforcement and invalidates stale lecturer consent",
  );

  const currentTerms = await sql(
    `select terms_version from public.jobs where id='${job}'`,
  );
  const claim = JSON.parse(
    await actor(
      lecturer,
      `select public.claim_job('${job}','${randomUUID()}',${currentTerms})`,
    ),
  );
  assert.equal(claim.status, "confirmed");
  assert.equal((await lifecycle(job)).can_reassign_company, false);
  await assert.rejects(
    manage(job, companyOne, await version(job), randomUUID()),
    /22023/,
  );
  assert.equal(await owner(job), companyTwo + "|Fictional operator two");
  console.log("PASS confirmed offers cannot be reassigned");

  const dispatchJob = await create(companyOne, randomUUID());
  const classDirectory = JSON.parse(
    await actor(
      companyA,
      `select public.save_company_dispatch_class('${companyOne}',null,'Fictional class','https://meet.example.invalid/class')`,
    ),
  );
  const classId = classDirectory.classes[0].id;
  const renamed = JSON.parse(
    await actor(
      companyA,
      `select public.save_company_dispatch_class('${companyOne}','${classId}','Fictional renamed class','https://meet.example.invalid/class')`,
    ),
  );
  assert.equal(renamed.classes[0].name, "Fictional renamed class");
  await actor(
    companyA,
    `select public.save_company_dispatch_settings('${companyOne}',null,${json({
      name: "Fictional coordinator",
      email: "desk@example.invalid",
      phone: "",
    })})`,
  );
  await assert.rejects(
    actor(companyB, `select public.company_class_directory('${companyOne}')`),
    /42501/,
  );
  await assert.rejects(
    actor(
      companyA,
      `select public.save_company_dispatch_class('${companyOne}',null,'Bad link','javascript:alert(1)')`,
    ),
    /22023/,
  );
  const companyOffer = JSON.parse(
    await actor(companyA, `select public.job_detail('${dispatchJob}')`),
  );
  assert.equal(companyOffer.amount, null);
  assert.equal(companyOffer.terms, "");
  assert.equal((await lifecycle(dispatchJob, companyA)).max_net_budget, null);
  const dispatchVersion = await version(dispatchJob);
  await assert.rejects(
    actor(
      companyB,
      `select public.save_job_dispatch('${dispatchJob}','${classId}',${dispatchVersion})`,
    ),
    /42501/,
  );
  assert.equal(
    await actor(
      companyA,
      `select public.save_job_dispatch('${dispatchJob}','${classId}',${dispatchVersion})`,
    ),
    dispatchJob,
  );
  assert.equal((await lifecycle(dispatchJob, companyA)).class_id, classId);
  assert.equal(
    (await lifecycle(dispatchJob, companyA)).meeting_url,
    "https://meet.example.invalid/class",
  );
  assert.equal(
    (await lifecycle(dispatchJob, manager)).dispatch_contact.name,
    "Fictional coordinator",
  );
  assert.equal((await lifecycle(dispatchJob, lecturer)).meeting_url, null);
  assert.equal((await lifecycle(dispatchJob, lecturer)).dispatch_contact, null);
  await assert.rejects(
    actor(
      companyA,
      `select public.save_job_dispatch('${dispatchJob}',null,${dispatchVersion})`,
    ),
    /PT409/,
  );
  const moveVersion = await version(dispatchJob);
  await assert.rejects(
    actor(
      manager,
      `select public.manage_job_offer('${dispatchJob}','edit',${moveVersion},'${randomUUID()}',${json(
        {
          organisation_id: companyTwo,
          class_id: classId,
        },
      )})`,
    ),
    /42501/,
  );
  assert.equal(
    await owner(dispatchJob),
    companyOne + "|Fictional operator one",
  );
  await manage(dispatchJob, companyTwo, moveVersion, randomUUID());
  assert.equal((await lifecycle(dispatchJob, companyB)).class_id, null);
  assert.equal((await lifecycle(dispatchJob, companyB)).dispatch_contact, null);
  console.log(
    "PASS classes without Premium, own company editing, meeting/contact snapshots and atomic company moves",
  );

  const legacy = await create(companyOne, randomUUID(), admin);
  const run = await sql(
    `select course_run_id from public.jobs where id='${legacy}'`,
  );
  // Model a job seeded directly before the staff creator wrote its audit marker.
  await sql(`delete from public.audit_events where resource_id='${legacy}'
    and action in ('job.created.draft','job.created.published')`);
  assert.equal((await lifecycle(legacy)).can_reassign_company, true);
  const detail = (user) => actor(user, `select public.job_detail('${legacy}')`);
  const workspace = (user) =>
    actor(user, `select public.course_workspace('${run}')`);
  const ownRuns = (user) =>
    actor(user, `select count(*) from public.course_runs where id='${run}'`);
  assert.equal(JSON.parse(await detail(companyA)).dispatch_only, true);
  assert.equal(JSON.parse(await workspace(companyA)).id, run);
  await assert.rejects(detail(companyB), /42501/);
  await assert.rejects(lifecycle(legacy, companyB), /42501/);
  await assert.rejects(workspace(companyB), /42501/);
  assert.equal(await ownRuns(companyB), "0");
  assert.equal(
    await actor(
      companyB,
      `select count(*) from public.jobs where id='${legacy}'`,
    ),
    "0",
  );
  await assert.rejects(
    actor(companyA, "select public.job_discovery()"),
    /42501/,
  );
  await manage(legacy, companyTwo, await version(legacy), randomUUID());
  await assert.rejects(detail(companyA), /42501/);
  await assert.rejects(workspace(companyA), /42501/);
  assert.equal(await ownRuns(companyA), "0");
  assert.equal(JSON.parse(await detail(companyB)).dispatch_only, true);
  assert.equal(JSON.parse(await workspace(companyB)).id, run);
  assert.equal(await ownRuns(companyB), "1");
  assert(!(await jobs(companyA)).includes(legacy));
  assert((await jobs(companyB)).includes(legacy));
  console.log(
    "PASS legacy offers can move and former companies lose listing, detail and workspace access",
  );

  const shared = await create(companyOne, randomUUID(), admin);
  await sql(`insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
    select course_run_id,'${lecturer}','enrolled','${admin}' from public.jobs where id='${shared}'`);
  assert.equal((await lifecycle(shared)).can_reassign_company, false);
  await assert.rejects(
    manage(shared, companyTwo, await version(shared), randomUUID()),
    /22023/,
  );
  console.log("PASS protected course participants keep their original company");

  const companyRequest = {
    title: payload.title,
    delivery_type: payload.delivery_type,
    time_zone: payload.time_zone,
    currency: payload.currency,
    rate_unit: payload.rate_unit,
    sessions: payload.sessions,
    gross_amount: payload.amount,
    gross_total_amount: payload.total_amount,
  };
  const brief = json({ teaching_units: 5, unit_minutes: 60 });
  await assert.rejects(
    actor(
      companyA,
      `select public.create_client_request_with_brief('${companyTwo}',${json(companyRequest)},'${randomUUID()}',${brief})`,
    ),
    /42501/,
  );
  const request = await actor(
    companyA,
    `select public.create_client_request_with_brief('${companyOne}',${json(companyRequest)},'${randomUUID()}',${brief})`,
  );
  await actor(admin, "select public.configure_compensation_policy(35,55,0)");
  const customerJob = await actor(
    admin,
    `select public.publish_client_request('${request}',null,'${payload.terms}',false,null)`,
  );
  assert.equal(
    await owner(customerJob),
    companyOne + "|Fictional operator one",
  );
  assert.equal((await lifecycle(customerJob)).can_reassign_company, false);
  await assert.rejects(
    manage(
      customerJob,
      companyTwo,
      await version(customerJob),
      randomUUID(),
      admin,
    ),
    /22023/,
  );
  console.log(
    "PASS a company request remains bound to its authorised submitting organisation after publication",
  );
});
