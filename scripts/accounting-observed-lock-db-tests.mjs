/** Automatically discovered real SQL authority/snapshot regressions. All data
 * belongs to an owned UUID database replaying this checkout's real migrations.
 * Fictional SQL Auth/clean metadata do not establish native Auth or scanned bytes. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";

await withTestDatabase(
  "accounting_observed",
  async ({ sql, actor, container, database }) => {
    for (const signature of [
      "public.register_customer_invoice(jsonb,uuid)",
      "public.record_customer_invoice_payment(uuid,text,timestamptz,text,uuid)",
      "public.create_accounting_export(text,uuid[],uuid)",
      "public.record_invoice_payment(uuid,numeric,timestamptz,text,uuid)",
      "public.void_invoice_payment(uuid,text)",
      "public.manage_client_organisation(uuid,uuid,boolean)",
      "public.set_account_roles(uuid,text[])",
    ])
      assert.equal(
        await sql(`select to_regprocedure(${q(signature)}) is not null`),
        "t",
        "Actual accounting/public authority prerequisite missing: " + signature,
      );
    const [owner, admin, teacher, client, manager, org] = Array.from(
      { length: 6 },
      randomUUID,
    );
    await sql(
      `insert into auth.users(id,email)values${[owner, admin, teacher, client, manager].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};insert into public.user_roles(user_id,role)values(${q(owner)},'owner'),(${q(admin)},'admin'),(${q(teacher)},'lecturer'),(${q(client)},'client'),(${q(manager)},'management');insert into public.organisations(id,name)values(${q(org)},'Fictional review customer');insert into public.client_organisation_memberships(user_id,organisation_id)values(${q(client)},${q(org)});`,
    );
    const [claim, job] = Array.from({ length: 2 }, randomUUID);
    await sql(
      `insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)values(${q(job)},'Fictional reviewed assignment','Fictional review customer','online','filled',100.01,100.01,'AUD','fixed_total','Fictional accepted source');insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version)values(${q(claim)},${q(job)},${q(teacher)},${q(randomUUID())},100.01,100.01,'AUD','fixed_total','Fictional accepted source',1);insert into private.claim_revenue_ledger(claim_id,job_id,organisation_id,lecturer_id,gross_amount,gross_total_amount,platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency)values(${q(claim)},${q(job)},${q(org)},${q(teacher)},200.03,200.03,50,100.02,100.01,100.01,'AUD');`,
    );
    /** Clean SQL metadata isolates current file authority/hash retention. Actual
     * bytes and scan decisions remain the separate native API fixture's task. */
    async function pdf(owner, kind = "material") {
      const [id, version, key] = Array.from({ length: 3 }, randomUUID);
      await sql(
        `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)values(${q(id)},${q(owner)},${q(owner)},'personal',${q(kind)},'Fictional reviewed.pdf','application/pdf',100,'clean',${q(key)});insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)values(${q(version)},${q(id)},${q(owner)},${q(key)},1,${q(owner + "/" + version)},'Fictional reviewed.pdf','application/pdf',100,'clean',repeat('e',64));update public.documents set current_version_id=${q(version)}where id=${q(id)};`,
      );
      return { id, version };
    }
    const customerPdf = await pdf(admin),
      lecturerPdf = await pdf(teacher, "invoice");
    const registrationKey = randomUUID(),
      registrationPayload = {
        claim_ids: [claim],
        number: "FICTIONAL-REVIEW-001",
        issued_on: "2001-01-01",
        due_on: "2001-02-01",
        currency: "AUD",
        total_amount: "200.03",
        document_version_id: customerPdf.version,
        difference_reason: "",
      };
    const customer = JSON.parse(
      await actor(
        admin,
        `select public.register_customer_invoice(${q(JSON.stringify(registrationPayload))}::jsonb,${q(registrationKey)})`,
        "aal2",
      ),
    ).id;
    const lecturer = randomUUID();
    await sql(
      `insert into public.invoices(id,user_id,number,issued_on,due_on,currency,total_amount,document_version_id,client_id,status)values(${q(lecturer)},${q(teacher)},'FICTIONAL-REVIEW-LECTURER','2001-01-01','2001-02-01','AUD',100.01,${q(lecturerPdf.version)},${q(randomUUID())},'approved');insert into public.invoice_items(invoice_id,claim_id)values(${q(lecturer)},${q(claim)});`,
    );
    const evidence = await sql(
      `select jsonb_build_object('claim',(select to_jsonb(c)from public.job_claims c where id=${q(claim)}),'ledger',(select to_jsonb(l)from private.claim_revenue_ledger l where claim_id=${q(claim)}),'pdf',(select to_jsonb(v)from public.document_versions v where id=${q(customerPdf.version)}))::text`,
    );
    const exportSql = (source, id, key = randomUUID()) =>
      `select public.create_accounting_export(${q(source)},array[${q(id)}]::uuid[],${q(key)})`;
    /** Hold an actual public RPC transaction at a positive output marker.
     * Explicit commit/rollback and bounded server timeouts retain UUID cleanup
     * even when a lock assertion or the queued application operation fails. */
    async function held(who, text) {
      const tag = "accounting_review_" + randomUUID(),
        marker = "held_" + randomUUID();
      const child = spawn("docker", [
        "exec",
        "-i",
        container,
        "psql",
        "-U",
        "postgres",
        "-d",
        database,
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
      ]);
      let output = "",
        error = "",
        ready,
        closed = false,
        finishing = false;
      const complete = new Promise((resolve) => {
        child.on("error", (cause) => (error += cause.message));
        child.on("close", (code) => {
          closed = true;
          ready?.();
          resolve({ code, output, error });
        });
      });
      child.stdout.on("data", (data) => {
        output += data;
        ready?.();
      });
      child.stderr.on("data", (data) => (error += data));
      const wait = new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Hold timeout " + error)),
          7000,
        );
        ready = () => {
          if (output.includes(marker)) {
            clearTimeout(timeout);
            resolve();
          } else if (closed) {
            clearTimeout(timeout);
            reject(new Error(error || output));
          }
        };
      });
      child.stdin.write(
        `begin;set local application_name=${q(tag)};set local statement_timeout='7s';set local idle_in_transaction_session_timeout='10s';set local role authenticated;set local request.jwt.claims=${q(JSON.stringify({ sub: who, aal: "aal2", role: "authenticated" }))};${text};\n\\echo ${marker}\n`,
      );
      const finish = async (commit = false) => {
        if (!closed && !finishing) {
          finishing = true;
          child.stdin.end((commit ? "commit;" : "rollback;") + "\n\\q\n");
        }
        const result = await complete;
        assert.equal(result.code, 0, result.error);
      };
      try {
        await wait;
      } catch (error) {
        await finish();
        throw error;
      }
      return { tag, finish };
    }
    /** PostgreSQL can queue a later row locker behind the first tuple waiter.
     * Trace the actual blocking chain instead of assuming a direct edge/sleep. */
    async function blocked(tag, holder) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (
          (await sql(
            `with recursive blockers(pid)as(select unnest(pg_blocking_pids(w.pid))from pg_stat_activity w where w.datname=${q(database)}and w.application_name=${q(tag)}and w.wait_event_type='Lock'and w.wait_event in('transactionid','tuple')union select unnest(pg_blocking_pids(b.pid))from blockers b)select exists(select 1 from blockers b join pg_stat_activity h on h.pid=b.pid where h.application_name=${q(holder)})`,
          )) === "t"
        )
          return;
        await delay(20);
      }
      throw new Error(
        "Actual source/profile row lock overlap was not observed",
      );
    }
    const result = (p) =>
      p.then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    /** Start a real authenticated export behind an already executed mutation,
     * then release it only after the invoice-row wait has been observed. */
    async function race(who, source, id, hold, whileHeld = async () => {}) {
      const tag = "accounting_export_" + randomUUID();
      const pending = result(
        actor(
          who,
          `set local application_name=${q(tag)};set local statement_timeout='7s';${exportSql(source, id)}`,
        ),
      );
      try {
        await blocked(tag, hold.tag);
        await whileHeld();
        await hold.finish(true);
        return await pending;
      } finally {
        await hold.finish();
        await pending;
      }
    }
    // Revoke via the actual subordinate membership-management API while a client
    // export is provably queued behind an uncommitted customer payment.
    const paymentKey = randomUUID();
    let hold = await held(
      admin,
      `select public.record_customer_invoice_payment(${q(customer)},'33.34','2001-01-02T12:00Z','Fictional observed payment',${q(paymentKey)})`,
    );
    const denied = await race(client, "customer", customer, hold, () =>
      actor(
        admin,
        `select public.manage_client_organisation(${q(client)},${q(org)},true)`,
        "aal2",
      ),
    );
    assert.match(denied.error?.message ?? "", /42501/);
    assert.equal(
      await sql(
        `select count(*)from private.accounting_exports where actor_id=${q(client)}`,
      ),
      "0",
    );
    console.log(
      "PASS Observed queued export rechecks actual revoked customer membership and mints no snapshot",
    );
    await actor(
      admin,
      `select public.manage_client_organisation(${q(client)},${q(org)},false)`,
      "aal2",
    );
    const prior = JSON.parse(
      await actor(client, exportSql("customer", customer)),
    );
    hold = await held(
      admin,
      `select public.record_customer_invoice_payment(${q(customer)},'33.34','2001-01-03T12:00Z','Fictional second payment',${q(randomUUID())})`,
    );
    const current = JSON.parse(
      (await race(client, "customer", customer, hold)).value,
    );
    assert.equal(current.invoices[0].paid_total, "66.68");
    assert.equal(current.invoices[0].outstanding_total, "133.35");
    assert.equal(current.invoices[0].payments.length, 2);
    assert.equal(current.invoices[0].accepted_charge_total, null);
    assert.equal(
      JSON.parse(
        await actor(client, `select public.accounting_export(${q(prior.id)})`),
      ).invoices[0].paid_total,
      "33.34",
    );
    console.log(
      "PASS Observed customer payment/export lock gives coherent exact-decimal snapshots while preserving old evidence",
    );
    hold = await held(
      admin,
      `select public.record_invoice_payment(${q(lecturer)},33.34,'2001-01-02T12:00Z','Fictional lecturer payment',${q(randomUUID())})`,
    );
    const paid = JSON.parse((await race(teacher, "own", lecturer, hold)).value);
    assert.equal(paid.invoices[0].paid_total, "33.34");
    assert.equal(paid.invoices[0].outstanding_total, "66.67");
    const payment = paid.invoices[0].payments[0].id;
    hold = await held(
      admin,
      `select public.void_invoice_payment(${q(payment)},'Fictional reviewed correction')`,
    );
    const corrected = JSON.parse(
      (await race(teacher, "own", lecturer, hold)).value,
    );
    assert.equal(corrected.invoices[0].paid_total, "0.00");
    assert.equal(corrected.invoices[0].outstanding_total, "100.01");
    assert.ok(corrected.invoices[0].payments[0].voided_at);
    assert.equal(
      JSON.parse(
        await actor(teacher, `select public.accounting_export(${q(paid.id)})`),
      ).invoices[0].paid_total,
      "33.34",
    );
    console.log(
      "PASS Observed lecturer payment and reversal/export locks preserve both source states without mixed totals",
    );

    // The privileged owner changes a subordinate's real roles while retaining
    // the profile lock. Fresh writes AND prior successful request keys must all
    // wait there, then evaluate the committed roles rather than cached authority.
    const freshClaim = randomUUID(),
      freshJob = randomUUID(),
      freshPdf = await pdf(admin);
    await sql(
      `insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)values(${q(freshJob)},'Fictional queued registration','Fictional review customer','online','filled',100.01,100.01,'AUD','fixed_total','Fictional fresh accepted source');insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version)values(${q(freshClaim)},${q(freshJob)},${q(teacher)},${q(randomUUID())},100.01,100.01,'AUD','fixed_total','Fictional fresh accepted source',1);insert into private.claim_revenue_ledger(claim_id,job_id,organisation_id,lecturer_id,gross_amount,gross_total_amount,platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency)values(${q(freshClaim)},${q(freshJob)},${q(org)},${q(teacher)},200.03,200.03,50,100.02,100.01,100.01,'AUD');`,
    );
    const freshPayload = {
      ...registrationPayload,
      claim_ids: [freshClaim],
      number: "FICTIONAL-QUEUED-REGISTRATION",
      document_version_id: freshPdf.version,
    };
    const grossKey = randomUUID(),
      gross = JSON.parse(
        await actor(admin, exportSql("customer", customer, grossKey), "aal2"),
      );
    const operationCount = await sql(
      `select count(*)from private.accounting_operations where actor_id=${q(admin)}`,
    );
    const auditCount = await sql(
      `select count(*)from public.audit_events where actor_id=${q(admin)}and action like 'accounting.%'`,
    );
    // Peer elevation/demotion is deliberately denied by the portal RPC. The
    // owned SQL fixture models a trusted role revocation under its profile lock.
    hold = await held(
      owner,
      `reset role;select 1 from public.profiles where id=${q(admin)} for update;delete from public.user_roles where user_id=${q(admin)};insert into public.user_roles(user_id,role) values(${q(admin)},'guest')`,
    );
    const queued = [];
    try {
      const requests = [
        `select public.register_customer_invoice(${q(JSON.stringify(freshPayload))}::jsonb,${q(randomUUID())})`,
        `select public.register_customer_invoice(${q(JSON.stringify(registrationPayload))}::jsonb,${q(registrationKey)})`,
        `select public.record_customer_invoice_payment(${q(customer)},'1.00','2001-01-04T12:00Z','Fictional fresh queued payment',${q(randomUUID())})`,
        `select public.record_customer_invoice_payment(${q(customer)},'33.34','2001-01-02T12:00Z','Fictional observed payment',${q(paymentKey)})`,
        exportSql("lecturer_all", lecturer),
        exportSql("customer", customer, grossKey),
      ];
      for (const text of requests) {
        const tag = "accounting_authority_" + randomUUID();
        queued.push(
          result(
            actor(
              admin,
              `set local application_name=${q(tag)};set local statement_timeout='7s';${text}`,
              "aal2",
            ),
          ),
        );
        await blocked(tag, hold.tag);
      }
      await hold.finish(true);
      const outcomes = await Promise.all(queued);
      assert.equal(outcomes.length, 6);
      for (const outcome of outcomes)
        assert.match(outcome.error?.message ?? "", /42501/);
    } finally {
      await hold.finish();
      await Promise.all(queued);
    }
    assert.equal(
      await actor(
        admin,
        "select private.has_permission('finance.gross.read')or private.has_permission('finance.manage')",
        "aal2",
      ),
      "f",
    );
    assert.equal(
      await sql(
        `select count(*)from private.accounting_operations where actor_id=${q(admin)}`,
      ),
      operationCount,
    );
    assert.equal(
      await sql(
        `select count(*)from public.audit_events where actor_id=${q(admin)}and action like 'accounting.%'`,
      ),
      auditCount,
    );
    assert.equal(
      await sql(`select kind from public.documents where id=${q(freshPdf.id)}`),
      "material",
    );
    assert.equal(
      await sql(
        `select count(*)from private.accounting_customer_items where claim_id=${q(freshClaim)}`,
      ),
      "0",
    );
    await assert.rejects(
      actor(admin, `select public.accounting_export(${q(gross.id)})`, "aal2"),
      /42501/,
    );
    console.log(
      "PASS Committed role loss precedes six queued fresh/retry paths, denies old gross snapshots and writes no accounting receipt",
    );

    assert.equal(
      await sql(
        `select jsonb_build_object('claim',(select to_jsonb(c)from public.job_claims c where id=${q(claim)}),'ledger',(select to_jsonb(l)from private.claim_revenue_ledger l where claim_id=${q(claim)}),'pdf',(select to_jsonb(v)from public.document_versions v where id=${q(customerPdf.version)}))::text`,
      ),
      evidence,
    );
    for (const who of [teacher, manager, admin]) {
      assert.equal(
        await actor(
          who,
          `select private.can_access_document(${q(customerPdf.id)})`,
          "aal2",
        ),
        "f",
      );
      assert.equal(
        await actor(
          who,
          `select count(*)from public.document_versions where id=${q(customerPdf.version)}`,
          "aal2",
        ),
        "0",
      );
    }
    assert.equal(
      await actor(
        client,
        `select private.can_access_document(${q(customerPdf.id)})`,
      ),
      "t",
    );
    console.log(
      "PASS Accepted source/PDF stay unchanged; lecturer, net finance and revoked uploader have no customer PDF bypass while assigned customers retain access",
    );
    console.log(
      "\n5 accounting observed-lock PostgreSQL groups passed; native Auth/scanning remain separate gates.",
    );
  },
);
