import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("company_decision", async ({sql, actor}) => {
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
    await sql(`insert into auth.users(id, email)
               values ('${manager}', 'manager@example.invalid'),
                      ('${company}', 'company@example.invalid'),
                      ('${other}', 'other@example.invalid'),
                      ('${teacher}', 'teacher@example.invalid'),
                      ('${teacher2}', 'teacher2@example.invalid'),
                      ('${teacher3}', 'teacher3@example.invalid'),
                      ('${teacher4}', 'teacher4@example.invalid');
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
        await actor(manager, "select public.company_invoice_reviews()", "aal1"),
    );
    assert.equal(queue.length, 1);
    assert.equal(queue[0].claim_id, replacement.claim_id);
    assert.equal(queue[0].invoices[0].number, "FICT-1");
    console.log(
        "Invoiced rejection remains pending in the password-only finance list; invoice, allocation and claim preserved, audit is idempotent.",
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
   update public.job_sessions set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour'
     where job_id='${job}';
   update public.assignment_sessions set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour'
     where claim_id='${raceClaim.claim_id}';`);
    // Hold the same actor lock the company decision uses before its claim row lock.
    // The invoice must wait there and cannot hold that row first.
    const deciding = assert.rejects(actor(company, `
        select pg_advisory_xact_lock(hashtextextended('${teacher4}',0));
        select pg_sleep(0.7);
        select public.decide_company_lecturer('${raceClaim.claim_id}','rejected');
    `), /Started work cannot be released/);
    let paused = false;
    for (let n = 0; n < 30 && !paused; n++) {
        paused = (await sql(
            `select exists(select 1 from pg_stat_activity where datname=current_database()
                and pid<>pg_backend_pid() and wait_event='PgSleep')`,
        )) === "t";
        if (!paused) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(paused, true);
    const submitted = actor(teacher4,
        `select public.submit_invoice('FICT-RACE',array['${raceClaim.claim_id}'::uuid],
          '${raceVersion}',current_date,current_date+7,'${randomUUID()}')`);
    const [, raceInvoice] = await Promise.all([deciding, submitted]);
    assert.match(raceInvoice, /^[0-9a-f-]{36}$/);
    assert.equal(await sql(
        `select status from public.job_claims where id='${raceClaim.claim_id}'`,
    ), "confirmed");
    assert.equal(await sql(
        `select count(*) from private.company_lecturer_decisions where claim_id='${raceClaim.claim_id}'`,
    ), "0");
    assert.equal(await sql(
        `select count(*) from public.invoice_items where claim_id='${raceClaim.claim_id}' and invoice_id='${raceInvoice}'`,
    ), "1");
    console.log("Concurrent company refusal cannot release an ended block while its eligible invoice commits.");
    // The company request can only be completed after explicit invoice review.
    await assert.rejects(
        actor(
            company,
            `select public.resolve_company_invoice_rejection('${replacement.claim_id}','Review documented')`,
        ),
        /Finance management/,
    );
    await assert.rejects(
        actor(
            manager,
            `select public.resolve_company_invoice_rejection('${replacement.claim_id}','Review documented')`,
            "aal1",
        ),
        /Reject or cancel every invoice/,
    );
    await actor(
        manager,
        `select public.review_invoice('${invoice}','rejected','Fictional correction reviewed')`,
        "aal1",
    );
    const historicalPayment = randomUUID();
    await sql(
        `insert into public.payment_records(id,invoice_id,amount,currency,paid_at,recorded_by,client_id) values('${historicalPayment}','${invoice}',10,'EUR',now(),'${manager}',gen_random_uuid())`,
    );
    await assert.rejects(
        actor(
            manager,
            `select public.resolve_company_invoice_rejection('${replacement.claim_id}','Review documented')`,
            "aal1",
        ),
        /resolve active payments first/,
    );
    await sql(
        `update public.payment_records set voided_at=now(),voided_by='${manager}',void_reason='Fictional correction' where id='${historicalPayment}'`,
    );
    const rejectedInvoice = await sql(
        `select to_jsonb(i)::text from public.invoices i where id='${invoice}'`,
    );
    await assert.rejects(
        actor(
            manager,
            `select public.resolve_company_invoice_rejection('${replacement.claim_id}','short')`,
            "aal1",
        ),
        /Review note required/,
    );
    await sql(`update public.jobs set status='archived' where id='${job}'`);
    await actor(
        manager,
        `select public.resolve_company_invoice_rejection('${replacement.claim_id}','Correction verified with lecturer')`,
        "aal1",
    );
    await actor(
        manager,
        `select public.resolve_company_invoice_rejection('${replacement.claim_id}','Correction verified with lecturer')`,
        "aal1",
    );
    assert.equal(
        await sql(
            `select status from public.job_claims where id='${replacement.claim_id}'`,
        ),
        "cancelled",
    );
    assert.equal(
        await sql(
            `select count(*) from public.assignment_sessions where claim_id='${replacement.claim_id}' and released_at is null`,
        ),
        "0",
    );
    assert.equal(
        await sql(
            `select to_jsonb(i)::text from public.invoices i where id='${invoice}'`,
        ),
        rejectedInvoice,
    );
    await assert.rejects(
        actor(
            manager,
            `select public.review_invoice('${invoice}','approved','must not reactivate')`,
            "aal1",
        ),
        /Only confirmed assignments/,
    );
    assert.equal(
        await sql(
            `select count(*) from public.audit_events where resource_id='${replacement.claim_id}' and action='company.rejection_finance_resolved'`,
        ),
        "1",
    );
    assert.equal(
        JSON.parse(
            await actor(manager, "select public.company_invoice_reviews()", "aal1"),
        ).some((x) => x.claim_id === replacement.claim_id),
        false,
    );
    console.log(
        "Financial review resolves only after explicit invoice correction; history retained, retries idempotent and reactivation denied.",
    );
    assert.equal(await sql(`select status from public.jobs where id='${job}'`), "archived");
    for (const status of ["draft", "archived"]) {
        const inactiveJob = randomUUID(),
            inactiveClaim = randomUUID();
        await sql(`insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,capacity,capacity_basis,amount,currency,rate_unit,total_amount,terms) values('${inactiveJob}','${run}','Inactive fictional offer','Fictional firm','online','${status}',1,'per_position',100,'EUR','fixed_total',100,'Example terms');
      insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version) values('${inactiveClaim}','${inactiveJob}','${teacher}',gen_random_uuid(),100,'EUR','fixed_total',100,'Example terms',1);
      insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at) values('${inactiveClaim}','${teacher}',now()+interval '20 days',now()+interval '20 days 1 hour');`);
        await actor(
            company,
            `select public.decide_company_lecturer('${inactiveClaim}','rejected')`,
        );
        assert.equal(
            await sql(
                `select status from public.job_claims where id='${inactiveClaim}'`,
            ),
            "cancelled",
        );
        assert.equal(
            await sql(`select status from public.jobs where id='${inactiveJob}'`),
            status,
        );
    }
    console.log(
        "Company releases future draft and archived assignments without publishing the offer.",
    );
    console.log(
        "Company decision: organisation isolation, effective timeout, explicit acceptance/rejection, idempotency, multi-slot release, immutable amount start boundary and concurrent accept/reject pass.",
    );
});

await withTestDatabase(
    "company_fingerprint",
    async ({sql}) => {
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
    {migrationsThrough: "20261117120000"},
);