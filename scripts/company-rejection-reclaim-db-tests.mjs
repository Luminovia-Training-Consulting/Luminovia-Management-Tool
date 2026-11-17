import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("company_reclaim", async ({ sql, actor }) => {
  const [
    company,
    outsider,
    teacher,
    other,
    org,
    foreign,
    template,
    run,
    job,
    key,
  ] = Array.from({ length: 10 }, randomUUID);
  await sql(`insert into auth.users(id,email) values ${[company, outsider, teacher, other].map((id) => `('${id}','${id}@example.invalid')`).join(",")};
 insert into public.user_roles(user_id,role) values('${company}','client'),('${outsider}','client'),('${teacher}','lecturer'),('${other}','lecturer');
 insert into public.organisations(id,name) values('${org}','Fictional company'),('${foreign}','Fictional other company');
 insert into public.client_organisation_memberships(user_id,organisation_id) values('${company}','${org}'),('${outsider}','${foreign}');
 insert into public.course_templates(id,title) values('${template}','Fictional course');
 insert into public.course_runs(id,template_id,organisation_id) values('${run}','${template}','${org}');
 insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,capacity,capacity_basis,amount,currency,rate_unit,total_amount,terms) values('${job}','${run}','Fictional offer','Fictional company','online','published',1,'per_position',100,'EUR','fixed_total',100,'Fictional terms');
 insert into public.job_sessions(job_id,starts_at,ends_at) values('${job}',now()+interval '10 days',now()+interval '10 days 1 hour');`);
  const call = async (user, requestKey) =>
    JSON.parse(
      await actor(user, `select public.claim_job('${job}','${requestKey}',1)`),
    );
  const first = await call(teacher, key);
  assert.equal(first.status, "confirmed");
  await assert.rejects(
    actor(
      outsider,
      `select public.decide_company_lecturer('${first.claim_id}','rejected')`,
    ),
    /Organisation access required/,
  );
  await actor(
    company,
    `select public.decide_company_lecturer('${first.claim_id}','rejected')`,
  );
  const receipt = await call(teacher, key);
  assert.deepEqual(receipt, { status: "cancelled", claim_id: first.claim_id });
  assert.equal((await call(teacher, randomUUID())).status, "not_eligible");
  assert.equal(
    await sql(
      `select private.assignment_replacement_eligibility('${job}','${teacher}',null)`,
    ),
    "not_eligible",
  );
  assert.equal(
    await sql(
      `select private.assignment_replacement_eligibility('${job}','${other}',null)`,
    ),
    "eligible",
  );
  await assert.rejects(
    actor(
      teacher,
      `select private.claim_job_before_company_rejection_guard('${job}','${randomUUID()}',1)`,
    ),
    /permission denied/,
  );
  await assert.rejects(
    sql(
      `insert into public.job_claims(job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version) values('${job}','${teacher}','${randomUUID()}',100,'EUR','fixed_total',100,'Fictional terms',1)`,
    ),
    /Lecturer is not eligible/,
  );
  const second = await call(other, randomUUID());
  assert.equal(second.status, "confirmed");
  await assert.rejects(
    actor(
      other,
      `select public.propose_job_substitution('${second.claim_id}','${teacher}','Fictional transfer','${randomUUID()}')`,
    ),
    /Target must be a qualified available lecturer/,
  );
  const offer = await actor(
    other,
    `select public.request_replacement('${second.claim_id}','Fictional replacement request','open',array[]::uuid[],false,'${randomUUID()}')`,
  );
  assert.equal(
    await sql(`select private.replacement_eligible('${offer}','${teacher}')`),
    "f",
  );
  assert.equal(
    await sql(`select private.replacement_eligible('${offer}','${other}')`),
    "f",
  );
  assert.equal(
    (
      await actor(
        teacher,
        `select public.claim_replacement('${offer}',1,1,'${randomUUID()}')`,
      )
    ).includes("not_eligible"),
    true,
  );
  const results = await Promise.all([
    actor(
      company,
      `select public.decide_company_lecturer('${second.claim_id}','rejected')`,
    ),
    call(other, randomUUID()),
  ]);
  assert.ok(
    ["already_assigned", "filled", "not_eligible"].includes(results[1].status),
  );
  assert.equal((await call(other, randomUUID())).status, "not_eligible");
  assert.equal(
    await sql(
      `select count(*) from public.job_claims where job_id='${job}' and status='confirmed'`,
    ),
    "0",
  );
  assert.equal(
    JSON.parse(
      await actor(
        company,
        `select public.company_rejected_lecturers('${job}')`,
      ),
    ).length,
    2,
  );
  await assert.rejects(
    actor(
      outsider,
      `select public.release_company_rejection('${first.claim_id}')`,
    ),
    /Organisation access required/,
  );
  await actor(
    company,
    `select public.release_company_rejection('${first.claim_id}')`,
  );
  await actor(
    company,
    `select public.release_company_rejection('${first.claim_id}')`,
  );
  assert.equal(
    await sql(
      `select count(*) from public.audit_events where action='company.lecturer_rejection_released' and resource_id='${first.claim_id}'`,
    ),
    "1",
  );
  assert.equal(
    JSON.parse(
      await actor(
        company,
        `select public.company_rejected_lecturers('${job}')`,
      ),
    ).length,
    1,
  );
  assert.equal((await call(teacher, key)).status, "cancelled");
  assert.equal((await call(teacher, randomUUID())).status, "confirmed");
  assert.equal((await call(other, randomUUID())).status, "not_eligible");
  console.log(
    "PASS rejection guards claim, substitution eligibility, direct insert, receipt retry, cross-company access and concurrent claim",
  );
});
