/** Exercise exceptional final invoices on isolated PostgreSQL with fictional contracts. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("invoice_exception", async ({ sql, actor }) => {
  const lecturer = randomUUID(),
    other = randomUUID(),
    finance = randomUUID();
  const contract = randomUUID(),
    alternate = randomUUID();
  const cancelled = randomUUID(),
    partial = randomUUID();
  const cancelledJob = randomUUID(),
    partialJob = randomUUID();
  const partialReleased = randomUUID();
  await sql(`
      insert into auth.users(id,email) values
        ('${lecturer}','lecturer@example.invalid'), ('${other}','other@example.invalid'),
        ('${finance}','finance@example.invalid');
      insert into public.user_roles(user_id,role) values
        ('${lecturer}','lecturer'), ('${other}','lecturer'), ('${finance}','management');
      insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)
      values ('${cancelledJob}','Cancelled fixture','Fictional Academy','online','draft',200,200,'EUR','fixed_total','Accepted terms'),
             ('${partialJob}','Partial fixture','Fictional Academy','online','filled',400,400,'AUD','fixed_total','Accepted terms');
    `);

  const addPdf = async (owner, kind, status = "clean") => {
    const document = randomUUID(),
      version = randomUUID(),
      request = randomUUID();
    await sql(`
          insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
          values ('${document}','${owner}','${owner}','personal','${kind}','Fictional PDF.pdf','application/pdf',100,'${status}','${request}');
          insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status)
          values ('${version}','${document}','${owner}','${request}',1,'${owner}/${document}/${version}',
            'Fictional PDF.pdf','application/pdf',100,'${"a".repeat(64)}','${status}');
          update public.documents set current_version_id='${version}' where id='${document}';
        `);
    return version;
  };
  const contractFile = await addPdf(lecturer, "contract");
  const alternateFile = await addPdf(lecturer, "contract");
  const invoicePdf = await addPdf(lecturer, "invoice");
  const replacementPdf = await addPdf(lecturer, "invoice");
  const foreignPdf = await addPdf(other, "invoice");
  const blockedPdf = await addPdf(lecturer, "invoice", "quarantined");
  await sql(`
      insert into public.contracts(id,user_id,status,effective_from,version,document_version_id,document_sha256)
      values ('${contract}','${lecturer}','active',now()-interval '1 year',1,'${contractFile}','${"a".repeat(64)}'),
             ('${alternate}','${lecturer}','active',now()-interval '6 months',2,'${alternateFile}','${"a".repeat(64)}');
      insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,status,amount,currency,rate_unit,total_amount,terms,terms_version,contract_id)
      values ('${cancelled}','${cancelledJob}','${lecturer}',gen_random_uuid(),'cancelled',200,'EUR','fixed_total',200,'Accepted terms',1,'${contract}'),
             ('${partial}','${partialJob}','${lecturer}',gen_random_uuid(),'confirmed',400,'AUD','fixed_total',400,'Accepted terms',1,null);
      insert into public.job_sessions(job_id,starts_at,ends_at)
      values ('${partialJob}',now()-interval '5 days',now()-interval '5 days'+interval '1 hour'),
             ('${partialJob}',now()-interval '4 days',now()-interval '4 days'+interval '1 hour');
      insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at,released_at)
      values (gen_random_uuid(),'${partial}','${lecturer}',now()-interval '5 days',now()-interval '5 days'+interval '1 hour',null),
             ('${partialReleased}','${partial}','${lecturer}',now()-interval '4 days',now()-interval '4 days'+interval '1 hour',now());
    `);

  const rpc = (who, name, args = []) =>
    actor(
      who,
      `select to_jsonb(public.${name}(${args
        .map((value) => (typeof value === "number" ? String(value) : q(value)))
        .join(",")}))`,
    ).then((raw) => (raw ? JSON.parse(raw) : null));
  const cancellationReview = await rpc(lecturer, "request_invoice_review", [
    cancelled,
    randomUUID(),
  ]);
  const partialReview = await rpc(lecturer, "request_invoice_review", [
    partial,
    randomUUID(),
  ]);
  const payDue = "2026-10-22",
    issue = "2026-11-22";
  const note =
    "Fictional finance team reviewed the delivered units and the deadline.";
  const approve = (request, agreement, amount = 90.25) =>
    rpc(finance, "approve_invoice_exception", [
      request,
      agreement,
      amount,
      payDue,
      note,
    ]);

  await assert.rejects(
    rpc(lecturer, "invoice_exception_options", [cancellationReview]),
    /42501/,
  );
  await assert.rejects(
    rpc(lecturer, "approve_invoice_exception", [
      cancellationReview,
      contract,
      1,
      payDue,
      note,
    ]),
    /42501/,
  );
  await assert.rejects(
    sql(
      "begin; set local role anon; select public.my_invoice_exceptions(); commit;",
    ),
    /42501/,
  );
  assert.deepEqual(await rpc(lecturer, "my_invoice_exceptions"), []);
  const options = await rpc(finance, "invoice_exception_options", [
    cancellationReview,
  ]);
  assert.deepEqual(
    options.contracts.map(({ id, version }) => ({ id, version })),
    [{ id: contract, version: 1 }],
  );
  assert.equal(options.can_approve, true);
  assert.equal(options.maximum_amount, 200);
  await assert.rejects(approve(cancellationReview, alternate), /22023/);
  await assert.rejects(approve(cancellationReview, contract, 200.01), /22023/);
  await assert.rejects(approve(cancellationReview, contract, 0), /22023/);

  const approvals = await Promise.all([
    approve(cancellationReview, contract),
    approve(cancellationReview, contract),
  ]);
  assert.equal(approvals[0], approvals[1]);
  const [cancelApproval] = approvals;
  await assert.rejects(
    rpc(lecturer, "finance_pending_invoice_exceptions"),
    /42501/,
  );
  const waiting = () => rpc(finance, "finance_pending_invoice_exceptions");
  assert.deepEqual(
    (await waiting()).map(({ request_id, title }) => ({ request_id, title })),
    [{ request_id: cancellationReview, title: "Cancelled fixture" }],
  );

  assert.equal(await sql("select count(*) from public.invoices"), "0");
  assert.equal(await sql("select count(*) from public.payment_records"), "0");
  const available = await rpc(lecturer, "my_invoice_exceptions");
  assert.equal(available.length, 1);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(available[0]).filter(([key]) => key !== "approved_at"),
    ),
    {
      id: cancelApproval,
      claim_id: cancelled,
      title: "Cancelled fixture",
      contract_version: 1,
      amount: 90.25,
      currency: "EUR",
      due_on: payDue,
    },
  );
  assert.deepEqual(await rpc(other, "my_invoice_exceptions"), []);
  await assert.rejects(
    rpc(other, "submit_exception_invoice", [
      cancelApproval,
      "OTHER-1",
      foreignPdf,
      issue,
      randomUUID(),
    ]),
    /42501/,
  );
  await assert.rejects(
    rpc(lecturer, "submit_exception_invoice", [
      cancelApproval,
      "FOREIGN-PDF",
      foreignPdf,
      issue,
      randomUUID(),
    ]),
    /42501/,
  );
  await assert.rejects(
    rpc(lecturer, "submit_exception_invoice", [
      cancelApproval,
      "UNSCANNED-PDF",
      blockedPdf,
      issue,
      randomUUID(),
    ]),
    /42501/,
  );

  const submit = [
    cancelApproval,
    "EXCEPTION-1",
    invoicePdf,
    issue,
    randomUUID(),
  ];
  const created = await Promise.all([
    rpc(lecturer, "submit_exception_invoice", submit),
    rpc(lecturer, "submit_exception_invoice", submit),
  ]);
  const [invoice] = created;
  assert.equal(invoice, created[1]);
  await assert.rejects(
    rpc(lecturer, "submit_exception_invoice", [
      cancelApproval,
      "EXCEPTION-2",
      invoicePdf,
      issue,
      randomUUID(),
    ]),
    /PT409/,
  );
  await assert.rejects(
    rpc(lecturer, "submit_exception_invoice", [
      cancelApproval,
      "IDEMPOTENCY-CONFLICT",
      invoicePdf,
      issue,
      submit[4],
    ]),
    /22023/,
  );
  assert.deepEqual(await waiting(), []);
  await assert.rejects(
    rpc(finance, "revoke_invoice_exception", [
      cancelApproval,
      "An invoice blocks a revocation.",
    ]),
    /PT409/,
  );
  assert.equal(
    await sql(
      `select total_amount||'|'||currency||'|'||due_on from public.invoices where id='${invoice}'`,
    ),
    "90.25|EUR|2026-10-22",
  );
  assert.equal(
    await sql(
      `select total_amount from public.job_claims where id='${cancelled}'`,
    ),
    "200.00",
  );
  assert.deepEqual(await rpc(lecturer, "my_invoice_exceptions"), []);
  await rpc(finance, "review_invoice", [
    invoice,
    "approved",
    "Reviewed the exceptional PDF.",
  ]);
  await rpc(finance, "record_invoice_payment", [
    invoice,
    20,
    new Date().toISOString(),
    "",
    randomUUID(),
  ]);
  assert.equal(
    Number(await sql(`select private.claim_paid_amount('${cancelled}')`)),
    20,
  );
  assert.equal(
    await actor(
      lecturer,
      `select total_amount||'|'||stage from public.finance_earnings(false) where claim_id='${cancelled}'`,
    ),
    "90.25|invoiced",
  );
  console.log(
    "PASS cancelled settlement, executed contract scope, scanned PDF, concurrent retries and exact due date, partial payment",
  );

  const partialOptions = await rpc(finance, "invoice_exception_options", [
    partialReview,
  ]);
  assert.deepEqual(
    partialOptions.contracts.map(({ id }) => id),
    [alternate, contract],
  );
  const staleApproval = await approve(partialReview, alternate, 140);
  await sql(
    `update public.assignment_sessions set released_at=released_at+interval '1 minute' where id='${partialReleased}'`,
  );
  assert.deepEqual(await rpc(lecturer, "my_invoice_exceptions"), []);
  await assert.rejects(
    rpc(lecturer, "submit_exception_invoice", [
      staleApproval,
      "STALE-1",
      replacementPdf,
      issue,
      randomUUID(),
    ]),
    /PT409/,
  );
  await rpc(finance, "revoke_invoice_exception", [
    staleApproval,
    "Updated assignment evidence has to be reviewed.",
  ]);
  assert.deepEqual(await waiting(), []);
  const partialApproval = await approve(partialReview, alternate, 160.5);
  const first = await rpc(lecturer, "submit_exception_invoice", [
    partialApproval,
    "PARTIAL-1",
    replacementPdf,
    issue,
    randomUUID(),
  ]);
  await rpc(finance, "review_invoice", [
    first,
    "rejected",
    "A corrected PDF is required.",
  ]);
  const corrected = await rpc(lecturer, "submit_exception_invoice", [
    partialApproval,
    "PARTIAL-2",
    replacementPdf,
    issue,
    randomUUID(),
  ]);
  assert.notEqual(first, corrected);
  assert.equal(
    await sql(
      `select total_amount||'|'||currency from public.invoices where id='${corrected}'`,
    ),
    "160.50|AUD",
  );
  await rpc(finance, "review_invoice", [
    corrected,
    "rejected",
    "Approval must be reconsidered.",
  ]);
  await rpc(finance, "revoke_invoice_exception", [
    partialApproval,
    "The underlying terms must be checked again.",
  ]);
  await assert.rejects(
    rpc(finance, "review_invoice", [
      first,
      "approved",
      "Cannot reactivate revoked approval.",
    ]),
    /PT409/,
  );
  assert.equal(
    await sql(
      `select count(*) from private.invoice_exception_approvals where claim_id='${partial}'`,
    ),
    "2",
  );
  assert.equal(
    await sql(
      `select count(*) from public.invoice_items where claim_id='${partial}' and active`,
    ),
    "0",
  );
  assert.equal(
    await sql(
      "select count(*) from public.audit_events where action='invoice.exception_approved'",
    ),
    "3",
  );
  console.log(
    "PASS partial settlement, changed-source block, finance correction and retained history after revocation",
  );
});
