/** Correction inbox events use current, independent staff and the assigned lecturer. */
import assert from "node:assert/strict";
import { randomUUID as id } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("invoice_correction_inbox", async ({ sql, actor }) => {
  const lecturer = id(),
    finance = id(),
    secondFinance = id(),
    peer = id(),
    inactive = id();
  const claim = id(),
    job = id(),
    contract = id(),
    session = id();
  const document = id(),
    version = id(),
    clientId = id(),
    earning = id(),
    invoice = id();
  const note = "Fictional confidential adjudication and reference text.";
  const due = "2027-01-07",
    received = "2024-01-07";

  await sql(`
    insert into auth.users(id,email) values
      ('${lecturer}','correction-inbox-lecturer@example.invalid'),
      ('${finance}','correction-inbox-finance@example.invalid'),
      ('${secondFinance}','correction-inbox-other-finance@example.invalid'),
      ('${peer}','correction-inbox-peer@example.invalid'),
      ('${inactive}','correction-inbox-disabled@example.invalid');
    insert into public.user_roles(user_id,role) values
      ('${lecturer}','lecturer'),('${lecturer}','management'),('${finance}','management'),
      ('${secondFinance}','admin'),('${secondFinance}','management'),
      ('${inactive}','admin'),('${peer}','lecturer');
    update public.profiles set active=false where id='${inactive}';
    insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
      values ('${document}','${lecturer}','${lecturer}','personal','contract','Fictional.pdf','application/pdf',100,'clean','${clientId}');
    insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status)
      values ('${version}','${document}','${lecturer}','${clientId}',1,'${lecturer}/${document}/${version}',
      'Fictional.pdf','application/pdf',100,'${"c".repeat(64)}','clean');
    update public.documents set current_version_id='${version}' where id='${document}';
    insert into public.contracts(id,user_id,status,effective_from,version,document_version_id,document_sha256)
      values ('${contract}','${lecturer}','active',now()-interval '1 year',1,'${version}','${"c".repeat(64)}');
    insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)
      values ('${job}','Fictional private case','Fictional private customer','online','filled',125,125,'EUR','fixed_total','Fictional terms');
    insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,status,amount,currency,rate_unit,total_amount,terms,terms_version,contract_id)
      values ('${claim}','${job}','${lecturer}',gen_random_uuid(),'confirmed',125,'EUR','fixed_total',125,'Fictional terms',1,'${contract}');
    insert into public.job_sessions(job_id,starts_at,ends_at)
      values ('${job}',now()-interval '4 days',now()-interval '4 days'+interval '1 hour');
    insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at)
      values ('${session}','${claim}','${lecturer}',now()-interval '4 days',now()-interval '4 days'+interval '1 hour');
    insert into private.invoice_series_approvals(id,claim_id,contract_id,contract_version,kind,currency,gross_amount,credit_amount,due_on,basis,note,approved_by,client_id)
      values ('${earning}','${claim}','${contract}',1,'interim','EUR',80,0,'${due}',
        private.invoice_exception_basis('${claim}'),'${note}','${finance}',gen_random_uuid());
    insert into public.invoices(id,user_id,number,issued_on,due_on,currency,total_amount,document_version_id,client_id,series_approval_id,status)
      values ('${invoice}','${lecturer}','Fictional private invoice','${received}','${due}','EUR',80,'${version}',gen_random_uuid(),'${earning}','paid');
    insert into public.invoice_items(invoice_id,claim_id,interim) values ('${invoice}','${claim}',true);
    insert into public.payment_records(invoice_id,amount,currency,paid_at,reference,recorded_by,client_id)
      values ('${invoice}',80,'EUR','${received}','Fictional private payment','${finance}',gen_random_uuid());
    update private.delivery_preferences set email_enabled=true where user_id in ('${lecturer}','${finance}','${secondFinance}');
  `);

  const rpc = (who, name, args = []) =>
    actor(
      who,
      `select to_jsonb(public.${name}(${args.map((value) => (typeof value === "number" ? String(value) : q(value))).join(",")}))`,
    ).then((result) => (result ? JSON.parse(result) : null));
  const inbox = async (who, action) =>
    (await rpc(who, "notification_inbox")).items.filter(
      (item) => item.kind === "invoice_correction_" + action,
    );
  const ownHref = (correction) => "/finance#correction-" + correction;
  const financeHref = "/finance?series=" + claim;
  const rawCount = (who, action) =>
    actor(
      who,
      `select count(*) from public.notifications where kind = 'invoice_correction_${action}'`,
    ).then(Number);
  const propose = (key = id()) =>
    rpc(finance, "propose_invoice_series_correction", [
      claim,
      contract,
      30.25,
      due,
      note,
      key,
    ]);
  const withdraw = (correction) =>
    rpc(finance, "withdraw_invoice_series_correction", [correction, note]);
  const record = (correction, amount, ref, key = id()) =>
    rpc(finance, "record_invoice_series_repayment", [
      correction,
      amount,
      received,
      ref,
      key,
    ]);
  const validateNotice = (item, href) => {
    assert.equal(item.href, href);
    assert.equal(item.title, "");
    assert.deepEqual(Object.keys(item).sort(), [
      "created_at",
      "href",
      "id",
      "kind",
      "read_at",
      "title",
    ]);
    assert.ok(!JSON.stringify(item).includes("Fictional"));
  };

  const firstKey = id();
  const [disputed, retry] = await Promise.all([
    propose(firstKey),
    propose(firstKey),
  ]);
  assert.equal(disputed, retry);
  assert.equal((await inbox(lecturer, "proposed")).length, 1);
  validateNotice((await inbox(lecturer, "proposed"))[0], ownHref(disputed));
  for (const other of [finance, secondFinance, peer]) {
    assert.deepEqual(await inbox(other, "proposed"), []);
    assert.equal(await rawCount(other, "proposed"), 0);
  }
  await rpc(lecturer, "dispute_invoice_series_correction", [disputed, note]);
  await rpc(lecturer, "dispute_invoice_series_correction", [disputed, note]);
  assert.deepEqual(await inbox(lecturer, "proposed"), []);
  assert.equal(await rawCount(lecturer, "proposed"), 0);
  for (const recipient of [finance, secondFinance]) {
    const rows = await inbox(recipient, "disputed");
    assert.equal(rows.length, 1);
    validateNotice(rows[0], financeHref);
  }
  assert.equal(await rawCount(lecturer, "disputed"), 0);
  assert.equal(await rawCount(peer, "disputed"), 0);
  assert.equal(
    await sql(
      `select count(*) from public.notifications where kind='invoice_correction_disputed' and user_id='${inactive}'`,
    ),
    "0",
  );
  await withdraw(disputed);
  await withdraw(disputed);
  assert.deepEqual(await inbox(finance, "disputed"), []);
  assert.equal(await rawCount(secondFinance, "disputed"), 0);
  assert.equal((await inbox(lecturer, "withdrawn")).length, 1);
  validateNotice((await inbox(lecturer, "withdrawn"))[0], ownHref(disputed));
  console.log(
    "PASS proposal, independent finance dispute, withdrawal, exact recipients, private links, and transactional retry",
  );

  const stale = await propose();
  await sql(
    `update public.assignment_sessions set ends_at=ends_at+interval '10 minutes' where id='${session}'`,
  );
  assert.equal(await rawCount(lecturer, "proposed"), 0);
  assert.deepEqual(await inbox(lecturer, "proposed"), []);
  await withdraw(stale);
  const acknowledged = await propose();
  await rpc(lecturer, "acknowledge_invoice_series_correction", [acknowledged]);
  await rpc(lecturer, "acknowledge_invoice_series_correction", [acknowledged]);
  assert.equal((await inbox(finance, "acknowledged")).length, 1);
  validateNotice((await inbox(finance, "acknowledged"))[0], financeHref);
  assert.equal((await inbox(secondFinance, "acknowledged")).length, 1);
  assert.deepEqual(await inbox(lecturer, "acknowledged"), []);
  await sql(
    `delete from public.user_roles where user_id='${secondFinance}'; insert into public.user_roles(user_id,role) values ('${secondFinance}','lecturer')`,
  );
  assert.equal(await rawCount(secondFinance, "acknowledged"), 0);
  assert.deepEqual(await inbox(secondFinance, "acknowledged"), []);
  console.log(
    "PASS stale proposals, completed confirmations, and current finance role hide obsolete inbox and Realtime rows",
  );

  const receiptKey = id();
  const firstReceipt = await record(
    acknowledged,
    19.75,
    "Hidden reference A",
    receiptKey,
  );
  assert.equal(
    await record(acknowledged, 19.75, "Hidden reference A", receiptKey),
    firstReceipt,
  );
  await record(acknowledged, 30, "Hidden reference B");
  const receipts = await inbox(lecturer, "repayment_recorded");
  assert.equal(receipts.length, 2);
  receipts.forEach((item) => validateNotice(item, ownHref(acknowledged)));
  assert.deepEqual(await inbox(peer, "repayment_recorded"), []);
  assert.deepEqual(await inbox(finance, "repayment_recorded"), []);
  await rpc(finance, "void_invoice_series_repayment", [firstReceipt, note]);
  await rpc(finance, "void_invoice_series_repayment", [firstReceipt, note]);
  assert.equal(await rawCount(lecturer, "repayment_recorded"), 1);
  const voided = await inbox(lecturer, "repayment_voided");
  assert.equal(voided.length, 1);
  validateNotice(voided[0], ownHref(acknowledged));
  assert.deepEqual(await inbox(finance, "repayment_voided"), []);
  assert.equal(
    await sql(`
    select count(*) from public.notifications n where left(n.kind,19)='invoice_correction_'
      and (exists (select from private.notification_email_outbox e where e.notification_id=n.id)
      or exists (select from private.notification_push_outbox p where p.notification_id=n.id))
  `),
    "0",
  );
  await sql(
    `delete from public.user_roles where user_id='${lecturer}' and role='lecturer'`,
  );
  assert.equal(await rawCount(lecturer, "repayment_recorded"), 0);
  assert.deepEqual(await inbox(lecturer, "repayment_voided"), []);
  console.log(
    "PASS recorded and voided repayments produce individual opaque in-app receipts and obey role revocation",
  );
});
