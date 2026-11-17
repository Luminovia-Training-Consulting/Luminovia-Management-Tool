import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("company_decision", async ({ sql, actor }) => {
  const manager = randomUUID(),
    company = randomUUID(),
    other = randomUUID(),
    teacher = randomUUID(),
    teacher2 = randomUUID(),
    teacher3 = randomUUID(),
    teacher4 = randomUUID(),
    org = randomUUID(),
    foreign = randomUUID(),
    run = randomUUID(),
    template = randomUUID(),
    job = randomUUID(),
    claim = randomUUID(),
    claim2 = randomUUID();
  await sql(`insert into auth.users(id,email) values ('${manager}','manager@example.invalid'),('${company}','company@example.invalid'),('${other}','other@example.invalid'),('${teacher}','teacher@example.invalid'),('${teacher2}','teacher2@example.invalid'),('${teacher3}','teacher3@example.invalid'),('${teacher4}','teacher4@example.invalid');
 insert into public.user_roles(user_id,role) values ('${manager}','admin'),('${company}','client'),('${other}','client'),('${teacher}','lecturer'),('${teacher2}','lecturer'),('${teacher3}','lecturer'),('${teacher4}','lecturer');
 insert into public.organisations(id,name) values ('${org}','Fictional firm'),('${foreign}','Other firm');
 insert into public.client_organisation_memberships(user_id,organisation_id) values ('${company}','${org}'),('${other}','${foreign}');
 insert into public.course_templates(id,title) values ('${template}','Fictional');
 insert into public.course_runs(id,template_id,organisation_id) values ('${run}','${template}','${org}');
 insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,capacity,capacity_basis,amount,currency,rate_unit,total_amount,terms) values ('${job}','${run}','Course','Fictional firm','online','filled',2,'per_position',100,'EUR','fixed_total',100,'Example terms');
 update public.jobs set claim_deadline=now()-interval '1 day' where id='${job}';
 insert into public.job_sessions(job_id,starts_at,ends_at) values ('${job}',now()+interval '10 days',now()+interval '10 days 1 hour');
 insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version,created_at) values ('${claim}','${job}','${teacher}',gen_random_uuid(),100,'EUR','fixed_total',100,'Example terms',1,now()-interval '73 hours'),('${claim2}','${job}','${teacher2}',gen_random_uuid(),100,'EUR','fixed_total',100,'Example terms',1,now());
 insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at) values ('${claim}','${teacher}',now()+interval '10 days',now()+interval '10 days 1 hour'),('${claim2}','${teacher2}',now()+interval '10 days',now()+interval '10 days 1 hour');`);
  const read = async (who) =>
    JSON.parse(
      await actor(who, `select public.company_lecturer_decisions('${job}')`),
    );
  await assert.rejects(read(other), /Organisation access required/);
  assert.equal((await read(company)).length, 2);
  assert.equal(
    (await read(company)).find((x) => x.claim_id === claim2).status,
    "pending",
  );
  assert.equal(
    (await read(company)).find((x) => x.claim_id === claim).status,
    "auto_accepted",
  );
  await assert.rejects(
    actor(
      other,
      `select public.decide_company_lecturer('${claim}','rejected')`,
    ),
    /Organisation access required/,
  );
  await assert.rejects(
    actor(
      company,
      `select public.cancel_job_assignment('${claim}','Unauthorised direct cancellation','${randomUUID()}')`,
    ),
    /Assignment access denied/,
  );
  await actor(
    company,
    `select public.decide_company_lecturer('${claim}','accepted')`,
  );
  assert.equal(
    (await read(company)).find((x) => x.claim_id === claim).status,
    "accepted",
  );
  await sql(
    `create function private.test_fail_cancel() returns trigger language plpgsql as $$begin raise exception 'forced transactional failure';end;$$; create trigger test_fail_cancel before update of status on public.job_claims for each row when (new.status='cancelled') execute function private.test_fail_cancel();`,
  );
  await assert.rejects(
    actor(
      company,
      `select public.decide_company_lecturer('${claim}','rejected')`,
    ),
    /forced transactional failure/,
  );
  assert.equal(
    await sql(
      `select decision from private.company_lecturer_decisions where claim_id='${claim}'`,
    ),
    "accepted",
  );
  assert.equal(
    await sql(`select status from public.job_claims where id='${claim}'`),
    "confirmed",
  );
  await sql(
    "drop trigger test_fail_cancel on public.job_claims;drop function private.test_fail_cancel()",
  );
  await actor(
    company,
    `select public.decide_company_lecturer('${claim}','rejected')`,
  );
  await actor(
    company,
    `select public.decide_company_lecturer('${claim}','rejected')`,
  );
  assert.equal(
    await sql(`select status from public.job_claims where id='${claim}'`),
    "cancelled",
  );
  assert.equal(
    await sql(
      `select count(*) from public.assignment_sessions where claim_id='${claim}' and released_at is null`,
    ),
    "0",
  );
  assert.equal(
    await sql(`select status from public.jobs where id='${job}'`),
    "published",
  );
  assert.equal(
    await sql(`select status from public.job_claims where id='${claim2}'`),
    "confirmed",
  );
  assert.equal(
    await sql(
      `select count(*) from public.assignment_sessions where claim_id='${claim2}' and released_at is null`,
    ),
    "1",
  );
  assert.equal(
    await sql(`select total_amount from public.job_claims where id='${claim}'`),
    "100.00",
  );
  await sql(
    `update public.assignment_sessions set starts_at=now()-interval '1 hour',ends_at=now()+interval '1 hour' where claim_id='${claim2}'`,
  );
  await assert.rejects(
    actor(
      company,
      `select public.decide_company_lecturer('${claim2}','rejected')`,
    ),
    /Started work/,
  );
  await sql(
    `update public.assignment_sessions set starts_at=now()+interval '10 days',ends_at=now()+interval '10 days 1 hour' where claim_id='${claim2}'`,
  );
  const raced = await Promise.allSettled([
    actor(
      company,
      `select public.decide_company_lecturer('${claim2}','accepted')`,
    ),
    actor(
      company,
      `select public.decide_company_lecturer('${claim2}','rejected')`,
    ),
  ]);
  assert.equal(raced[1].status, "fulfilled");
  assert.equal(
    await sql(`select status from public.job_claims where id='${claim2}'`),
    "cancelled",
  );
  assert.equal(
    await sql(
      `select decision from private.company_lecturer_decisions where claim_id='${claim2}'`,
    ),
    "rejected",
  );
  assert.equal(
    await sql(
      `select claim_deadline is null from public.jobs where id='${job}'`,
    ),
    "t",
  );
  const version = await actor(
    teacher3,
    `select item->>'terms_version' from jsonb_array_elements(public.job_offers()) item where item->>'id'='${job}'`,
  );
  assert.match(version, /^[1-9][0-9]*$/);
  const replacement = JSON.parse(
    await actor(
      teacher3,
      `select public.claim_job('${job}','${randomUUID()}',${version})`,
    ),
  );
  assert.equal(replacement.status, "confirmed");
  const document = randomUUID(),
    versionId = randomUUID(),
    invoice = randomUUID(),
    fileKey = randomUUID();
  await sql(`insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id) values('${document}','${teacher3}','${teacher3}','personal','invoice','Fictional.pdf','application/pdf',100,'clean','${fileKey}');
   insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status) values('${versionId}','${document}','${teacher3}','${fileKey}',1,'${teacher3}/${document}/${versionId}','Fictional.pdf','application/pdf',100,'${"1".repeat(64)}','clean');
   update public.documents set current_version_id='${versionId}' where id='${document}';
   insert into public.invoices(id,user_id,number,issued_on,due_on,currency,total_amount,document_version_id,client_id) values('${invoice}','${teacher3}','FICT-1',current_date,current_date,'EUR',100,'${versionId}',gen_random_uuid());
   insert into public.invoice_items(invoice_id,claim_id) values('${invoice}','${replacement.claim_id}');`);
  const beforeInvoice = await sql(
    `select to_jsonb(i)::text from public.invoices i where id='${invoice}'`,
  );
  await actor(
    company,
    `select public.decide_company_lecturer('${replacement.claim_id}','rejected')`,
  );
  await actor(
    company,
    `select public.decide_company_lecturer('${replacement.claim_id}','rejected')`,
  );
  assert.equal(
    (await read(company)).find((x) => x.claim_id === replacement.claim_id)
      .status,
    "review_required",
  );
  assert.equal(
    await sql(
      `select status from public.job_claims where id='${replacement.claim_id}'`,
    ),
    "confirmed",
  );
  assert.equal(
    await sql(
      `select count(*) from public.assignment_sessions where claim_id='${replacement.claim_id}' and released_at is null`,
    ),
    "1",
  );
  assert.equal(
    await sql(
      `select to_jsonb(i)::text from public.invoices i where id='${invoice}'`,
    ),
    beforeInvoice,
  );
  assert.equal(
    await sql(
      `select count(*) from public.audit_events where resource_id='${replacement.claim_id}' and action='company.lecturer_rejection_finance_review'`,
    ),
    "1",
  );
  await assert.rejects(
    actor(
      company,
      `select public.decide_company_lecturer('${replacement.claim_id}','accepted')`,
    ),
    /Finance review is pending/,
  );
  await assert.rejects(
    actor(company, "select public.company_invoice_reviews()"),
    /Finance management/,
  );
  await assert.rejects(
    actor(manager, "select public.company_invoice_reviews()"),
    /Finance management/,
  );
  const accountSnapshot = JSON.parse(
    await sql(`select private.deletion_snapshot('account','${company}')`),
  );
  const assignmentSnapshot = JSON.parse(
    await sql(
      `select private.deletion_snapshot('assignment','${replacement.claim_id}')`,
    ),
  );
  assert.equal(
    accountSnapshot.blockers.some(
      (b) => b.kind === "private.company_lecturer_decisions",
    ),
    true,
  );
  assert.equal(
    assignmentSnapshot.blockers.some(
      (b) => b.kind === "private.company_lecturer_decisions",
    ),
    true,
  );
  const queue = JSON.parse(
    await actor(manager, "select public.company_invoice_reviews()", "aal2"),
  );
  assert.equal(queue.length, 1);
  assert.equal(queue[0].claim_id, replacement.claim_id);
  assert.equal(queue[0].invoices[0].number, "FICT-1");
  console.log(
    "Invoiced rejection remains pending in MFA-protected finance list; invoice, allocation and claim preserved, audit is idempotent.",
  );
  const token4 = await actor(
    teacher4,
    `select item->>'terms_version' from jsonb_array_elements(public.job_offers()) item where item->>'id'='${job}'`,
  );
  const raceClaim = JSON.parse(
    await actor(
      teacher4,
      `select public.claim_job('${job}','${randomUUID()}',${token4})`,
    ),
  );
  assert.equal(raceClaim.status, "confirmed");
  const raceDocument = randomUUID(),
    raceVersion = randomUUID(),
    raceKey = randomUUID();
  await sql(`insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id) values('${raceDocument}','${teacher4}','${teacher4}','personal','invoice','Fictional.pdf','application/pdf',100,'clean','${raceKey}');
   insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status) values('${raceVersion}','${raceDocument}','${teacher4}','${raceKey}',1,'${teacher4}/${raceDocument}/${raceVersion}','Fictional.pdf','application/pdf',100,'${"2".repeat(64)}','clean');
   update public.documents set current_version_id='${raceVersion}' where id='${raceDocument}';
   create function public.test_company_invoice_barrier() returns trigger language plpgsql as $$begin perform pg_sleep(2);return new;end$$;
   create trigger test_company_invoice_barrier before insert on public.invoices for each row execute function public.test_company_invoice_barrier();`);
  const submitting = actor(
    teacher4,
    `select public.submit_invoice('FICT-RACE',array['${raceClaim.claim_id}'::uuid],'${raceVersion}',current_date,current_date+7,'${randomUUID()}')`,
  );
  let paused = false;
  for (let n = 0; n < 60; n++) {
    if (
      (await sql(
        `select exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event='PgSleep')`,
      )) === "t"
    ) {
      paused = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(paused, true);
  const deciding = actor(
    company,
    `select public.decide_company_lecturer('${raceClaim.claim_id}','rejected')`,
  );
  const results = await Promise.allSettled([submitting, deciding]);
  assert.deepEqual(
    results.map((x) => x.status),
    ["fulfilled", "fulfilled"],
  );
  assert.equal(
    await sql(
      `select status from public.job_claims where id='${raceClaim.claim_id}'`,
    ),
    "confirmed",
  );
  assert.equal(
    await sql(
      `select decision from private.company_lecturer_decisions where claim_id='${raceClaim.claim_id}'`,
    ),
    "review_required",
  );
  await sql(
    "drop trigger test_company_invoice_barrier on public.invoices;drop function public.test_company_invoice_barrier()",
  );
  console.log(
    "Invoice submission and company rejection serialize; committed invoice causes review without cancellation.",
  );
  console.log(
    "Company decision: organisation isolation, effective timeout, explicit acceptance/rejection, idempotency, multi-slot release, immutable amount start boundary and concurrent accept/reject pass.",
  );
});

await withTestDatabase(
  "company_fingerprint",
  async ({ sql }) => {
    await sql(
      `do $do$ declare f text; begin select pg_get_functiondef('private.cancel_job_assignment_before_chat_origins(uuid,text,uuid)'::regprocedure) into f; execute replace(f, 'Assignment access denied', 'changed cancellation implementation'); end; $do$;`,
    );
    const migration = await readFile(
      new URL(
        "../supabase/migrations/20261117130000_company_lecturer_decisions.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await assert.rejects(
      sql(migration),
      /Unexpected assignment cancellation implementation/,
    );
    assert.equal(
      await sql(
        "select to_regclass('private.company_lecturer_decisions') is null",
      ),
      "t",
    );
    console.log(
      "Cancellation helper fingerprint fails closed on unexpected implementation; migration rolled back.",
    );
  },
  { migrationsThrough: "20261117120000" },
);
