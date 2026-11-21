/** Migrated PostgreSQL regression for reviewed interim payments and closing credits. */
import assert from "node:assert/strict";
import { randomUUID as id } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("invoice_series", async ({ sql, actor }) => {
  const lecturer = id(),
    stranger = id(),
    finance = id(),
    contract = id();
  const note = "Fictional finance review of the agreement and receipts.";
  const issued = "2026-11-22",
    due = "2026-10-21";
  await sql(`
    insert into auth.users(id,email) values
      ('${lecturer}','lecturer-series@example.invalid'), ('${stranger}','stranger-series@example.invalid'),
      ('${finance}','finance-series@example.invalid');
    insert into public.user_roles(user_id,role) values
      ('${lecturer}','lecturer'), ('${stranger}','lecturer'), ('${finance}','management');
  `);
  async function addPdf(owner, kind = "invoice", status = "clean") {
    const document = id(),
      version = id(),
      key = id();
    await sql(`
      insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
      values ('${document}','${owner}','${owner}','personal','${kind}','Fictional PDF.pdf','application/pdf',100,'${status}','${key}');
      insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status)
      values ('${version}','${document}','${owner}','${key}',1,'${owner}/${document}/${version}',
        'Fictional PDF.pdf','application/pdf',100,'${"c".repeat(64)}','${status}');
      update public.documents set current_version_id='${version}' where id='${document}';
    `);
    return version;
  }
  const contractPdf = await addPdf(lecturer, "contract");
  const invoicePdf = await addPdf(lecturer);
  const nextPdf = await addPdf(lecturer);
  const finalPdf = await addPdf(lecturer);
  const foreignPdf = await addPdf(stranger);
  const blockedPdf = await addPdf(lecturer, "invoice", "quarantined");
  await sql(`
    insert into public.contracts(id,user_id,status,effective_from,version,document_version_id,document_sha256)
    values ('${contract}','${lecturer}','active',now()-interval '1 year',1,'${contractPdf}','${"c".repeat(64)}');
  `);
  async function addClaim(currency, days) {
    const job = id(),
      claim = id(),
      first = id(),
      next = id();
    await sql(`
      insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)
      values ('${job}','Fictional ${currency} series','Fictional Academy','online','filled',300,300,'${currency}','fixed_total','Fictional terms');
      insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,status,amount,currency,rate_unit,total_amount,terms,terms_version,contract_id)
      values ('${claim}','${job}','${lecturer}',gen_random_uuid(),'confirmed',300,'${currency}','fixed_total',300,'Fictional terms',1,'${contract}');
      insert into public.job_sessions(job_id,starts_at,ends_at)
      values ('${job}',now()-make_interval(days=>${days}),now()-make_interval(days=>${days})+interval '1 hour'),
             ('${job}',now()+make_interval(days=>${days}),now()+make_interval(days=>${days},hours=>1));
      insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at)
      values ('${first}','${claim}','${lecturer}',now()-make_interval(days=>${days}),now()-make_interval(days=>${days})+interval '1 hour'),
             ('${next}','${claim}','${lecturer}',now()+make_interval(days=>${days}),now()+make_interval(days=>${days},hours=>1));
    `);
    return { job, claim, next };
  }
  const finish = ({ job, next }, days) =>
    sql(`
    update public.job_sessions set starts_at=now()-make_interval(days=>${days}),ends_at=now()-make_interval(days=>${days})+interval '1 hour'
    where job_id='${job}' and starts_at>now();
    update public.assignment_sessions set starts_at=now()-make_interval(days=>${days}),ends_at=now()-make_interval(days=>${days})+interval '1 hour'
    where id='${next}';
  `);
  const rpc = (who, name, args = []) =>
    actor(
      who,
      `select to_jsonb(public.${name}(${args
        .map((value) =>
          typeof value === "number" || typeof value === "boolean"
            ? String(value)
            : q(value),
        )
        .join(",")}))`,
    ).then((result) => (result ? JSON.parse(result) : null));
  const approve = (claim, kind, amount, key = id(), version = contract) =>
    rpc(finance, "approve_invoice_series_entry", [
      claim,
      version,
      kind,
      amount,
      due,
      note,
      key,
    ]);
  const submit = (entry, number, file, key = id()) =>
    rpc(lecturer, "submit_invoice_series_entry", [
      entry,
      number,
      file,
      issued,
      key,
    ]);
  const review = (invoice, status = "approved") =>
    rpc(finance, "review_invoice", [invoice, status, note]);
  const pay = (invoice, amount) =>
    rpc(finance, "record_invoice_payment", [
      invoice,
      amount,
      "2024-01-07T00:00:00Z",
      "Fictional receipt",
      id(),
    ]);
  const revoke = (approval) =>
    rpc(finance, "revoke_invoice_series_entry", [approval, note]);
  const voidPayment = (payment) =>
    rpc(finance, "void_invoice_payment", [payment, note]);
  const access = (claim) => rpc(finance, "invoice_series_options", [claim]);
  const own = () => rpc(lecturer, "invoice_series_records", [false]);
  const inbox = async (who, kind) =>
    (await rpc(who, "notification_inbox")).items.filter(
      (item) => item.kind === kind,
    );
  const readStatement = async () =>
    JSON.parse(
      await actor(
        lecturer,
        "select public.finance_statement(current_date - 25, current_date + 1, false)",
      ),
    ).data;
  const paid = (claim) =>
    sql(`select private.claim_paid_amount('${claim}')`).then(Number);

  const eur = await addClaim("EUR", 14);
  assert.deepEqual(await rpc(stranger, "invoice_series_records", [false]), []);
  await assert.rejects(
    rpc(lecturer, "invoice_series_records", [true]),
    /42501/,
  );
  await assert.rejects(
    rpc(lecturer, "invoice_series_options", [eur.claim]),
    /42501/,
  );
  assert.equal((await access(eur.claim)).can_interim, true);
  await assert.rejects(approve(eur.claim, "final", 150), /PT409/);
  await assert.rejects(approve(eur.claim, "interim", 301), /22023/);
  await assert.rejects(approve(eur.claim, "interim", 50, id(), id()), /22023/);

  const approvalKey = id();
  const [firstApproval, replayApproval] = await Promise.all([
    approve(eur.claim, "interim", 50.25, approvalKey),
    approve(eur.claim, "interim", 50.25, approvalKey),
  ]);
  assert.equal(firstApproval, replayApproval);
  const notices = await inbox(lecturer, "invoice_series_available");
  assert.equal(notices.length, 1);
  assert.equal(notices[0].href, "/finance");
  assert.deepEqual(await inbox(stranger, "invoice_series_available"), []);
  assert.deepEqual(await inbox(finance, "invoice_series_available"), []);
  await assert.rejects(approve(eur.claim, "interim", 51, approvalKey), /22023/);
  await assert.rejects(approve(eur.claim, "interim", 30), /PT409/);
  await assert.rejects(
    rpc(stranger, "submit_invoice_series_entry", [
      firstApproval,
      "FOREIGN",
      foreignPdf,
      issued,
      id(),
    ]),
    /42501/,
  );
  await assert.rejects(submit(firstApproval, "SERIES-1", foreignPdf), /42501/);
  await assert.rejects(submit(firstApproval, "SERIES-1", blockedPdf), /42501/);
  assert.equal((await own())[0].state, "ready");
  const submitKey = id();
  const [firstInvoice, replayInvoice] = await Promise.all([
    submit(firstApproval, "SERIES-1", invoicePdf, submitKey),
    submit(firstApproval, "SERIES-1", invoicePdf, submitKey),
  ]);
  assert.equal(firstInvoice, replayInvoice);
  assert.deepEqual(await inbox(lecturer, "invoice_series_available"), []);
  await assert.rejects(
    submit(firstApproval, "SERIES-WRONG", invoicePdf, submitKey),
    /22023/,
  );
  await assert.rejects(revoke(firstApproval), /PT409/);
  await review(firstInvoice);
  const firstReceipt = await pay(firstInvoice, 20);
  assert.equal(await paid(eur.claim), 20);
  await assert.rejects(approve(eur.claim, "interim", 30), /PT409/);
  await assert.rejects(pay(firstInvoice, 31), /22023/);
  const secondReceipt = await pay(firstInvoice, 30.25);
  assert.equal((await access(eur.claim)).credited, 50.25);
  await assert.rejects(approve(eur.claim, "interim", 250), /22023/);
  const secondInvoice = await submit(
    await approve(eur.claim, "interim", 59.75),
    "SERIES-2",
    nextPdf,
  );
  await review(secondInvoice);
  const thirdReceipt = await pay(secondInvoice, 59.75);
  assert.equal(await paid(eur.claim), 110);
  const interimStatement = await readStatement();
  assert.equal(
    interimStatement.totals.find(({ currency }) => currency === "EUR").invoiced,
    110,
  );
  assert.equal(
    await actor(
      lecturer,
      `select count(*) from public.finance_earnings(false) where claim_id='${eur.claim}'`,
    ),
    "1",
  );
  console.log(
    "PASS exact retries, scanned ownership, contract limits, partial payments and two interim invoices",
  );

  await finish(eur, 2);
  assert.equal((await access(eur.claim)).can_final, true);
  assert.equal((await access(eur.claim)).can_interim, false);
  await assert.rejects(approve(eur.claim, "final", 109), /22023/);
  await assert.rejects(approve(eur.claim, "final", 301), /22023/);
  const finalApproval = await approve(eur.claim, "final", 230);
  const closing = (await own()).find(({ id }) => id === finalApproval);
  assert.deepEqual(
    [closing.gross_amount, closing.credit_amount, closing.amount],
    [230, 110, 120],
  );
  assert.deepEqual(
    closing.credits.map(({ payment_id }) => payment_id).sort(),
    [firstReceipt, secondReceipt, thirdReceipt].sort(),
  );
  const finalInvoice = await submit(finalApproval, "SERIES-CLOSING", finalPdf);
  const final = JSON.parse(
    await sql(
      `select to_jsonb(i) from public.invoices i where id='${finalInvoice}'`,
    ),
  );
  assert.deepEqual(
    [final.total_amount, final.due_on, final.currency],
    [120, due, "EUR"],
  );
  assert.equal(await paid(eur.claim), 110);
  await assert.rejects(voidPayment(firstReceipt), /PT409/);
  await review(finalInvoice);
  await pay(finalInvoice, 46);
  assert.equal(await paid(eur.claim), 156);
  await pay(finalInvoice, 74);
  assert.equal(await paid(eur.claim), 230);
  assert.equal(
    await sql(
      `select total_amount from public.job_claims where id='${eur.claim}'`,
    ),
    "300.00",
  );
  assert.equal(
    await actor(
      lecturer,
      `select total_amount from public.finance_earnings(false) where claim_id='${eur.claim}'`,
    ),
    "230.00",
  );
  const statement = await readStatement();
  assert.equal(
    statement.totals.find(({ currency }) => currency === "EUR").invoiced,
    230,
  );
  const statementEntry = statement.claims.find(
    ({ claim_id }) => claim_id === eur.claim,
  );
  assert.equal(statementEntry.total_amount, 230);
  assert.equal(statementEntry.paid_amount, 230);
  assert.equal(statementEntry.invoice_id, finalInvoice);
  assert.equal(
    statement.claims.filter(({ claim_id }) => claim_id === eur.claim).length,
    1,
  );
  await assert.rejects(approve(eur.claim, "final", 230), /PT409/);
  console.log(
    "PASS final applies exact payment IDs once and statements show the correct cash and final reference",
  );

  const aud = await addClaim("AUD", 16);
  const audInvoice = await submit(
    await approve(aud.claim, "interim", 80),
    "SERIES-AUD-I",
    invoicePdf,
  );
  await review(audInvoice);
  const audReceipt = await pay(audInvoice, 80);
  await finish(aud, 4);
  await sql(
    `update public.job_claims set status='cancelled' where id='${aud.claim}'`,
  );
  const zeroApproval = await approve(aud.claim, "final", 80);
  const zeroInvoice = await submit(zeroApproval, "SERIES-AUD-F", finalPdf);
  await review(zeroInvoice);
  await review(zeroInvoice);
  assert.equal(
    await sql(`select status from public.invoices where id='${zeroInvoice}'`),
    "paid",
  );
  assert.equal(
    await sql(
      `select count(*) from public.payment_records where invoice_id='${zeroInvoice}'`,
    ),
    "0",
  );
  assert.equal(await paid(aud.claim), 80);
  assert.equal(
    await sql(`select count(*) from public.notifications where user_id='${lecturer}'
    and resource_id='${zeroInvoice}' and kind='invoice_fully_credited'`),
    "1",
  );
  assert.equal(
    await sql(`select count(*) from public.notifications where resource_id='${zeroInvoice}'
    and kind='invoice_paid'`),
    "0",
  );
  await assert.rejects(pay(zeroInvoice, 0.01), /22023/);
  await assert.rejects(voidPayment(audReceipt), /PT409/);
  await review(zeroInvoice, "cancelled");
  await revoke(zeroApproval);
  await voidPayment(audReceipt);
  assert.equal(await paid(aud.claim), 0);
  assert.equal(
    await sql(
      `select count(*) from private.invoice_series_credits where invoice_id='${zeroInvoice}'`,
    ),
    "1",
  );
  await assert.rejects(review(zeroInvoice), /PT409/);
  console.log(
    "PASS cancelled assignment with a zero-balance PDF and audited correction of credited payments",
  );

  const stale = await addClaim("EUR", 18);
  const outdated = await approve(stale.claim, "interim", 40);
  await sql(
    `update public.assignment_sessions set ends_at=ends_at+interval '5 minutes' where id='${stale.next}'`,
  );
  assert.equal((await own()).find(({ id }) => id === outdated).state, "stale");
  await assert.rejects(submit(outdated, "SERIES-STALE", invoicePdf), /PT409/);
  await revoke(outdated);
  await revoke(outdated);
  assert.notEqual(await approve(stale.claim, "interim", 45), outdated);
  assert.equal(
    await sql(`select count(*) from public.audit_events where resource_id='${outdated}'
    and action in ('invoice.series_approved','invoice.series_revoked')`),
    "2",
  );
  await assert.rejects(
    sql(
      "begin; set local role anon; select public.invoice_series_records(false); commit;",
    ),
    /42501/,
  );
  console.log(
    "PASS changed schedules need a new decision; revocation can be retried without losing the audit",
  );
});
