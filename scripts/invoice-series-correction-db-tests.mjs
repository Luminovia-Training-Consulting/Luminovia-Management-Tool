/** Exercise the bounded overpayment correction without changing retained invoice/payment history. */
import assert from "node:assert/strict";
import { randomUUID as id } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("invoice_series_correction", async ({ sql, actor }) => {
  const lecturer = id(),
    manager = id(),
    outsider = id(),
    contract = id(),
    claim = id(),
    job = id();
  const doc = id(),
    version = id(),
    upload = id(),
    contractDoc = id(),
    contractVersion = id(),
    contractUpload = id(),
    past = id(),
    future = id();
  const note =
    "Fictional independent review confirms the agreement and prior payments.";
  const dispute = "Fictional lecturer disputes the recorded eligible delivery.";
  const date = "2024-01-07";
  await sql(`
    insert into auth.users(id,email) values
      ('${lecturer}','correction-lecturer@example.invalid'),
      ('${manager}','correction-finance@example.invalid'),
      ('${outsider}','correction-other@example.invalid');
    insert into public.user_roles(user_id,role) values ('${lecturer}','lecturer'),('${manager}','management'),('${outsider}','lecturer');
    insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
      values ('${doc}','${lecturer}','${lecturer}','personal','invoice','Fixture.pdf','application/pdf',100,'clean','${upload}'),
             ('${contractDoc}','${lecturer}','${lecturer}','personal','contract','Agreement.pdf','application/pdf',110,'clean','${contractUpload}');
    insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status)
      values ('${version}','${doc}','${lecturer}','${upload}',1,'${lecturer}/${doc}/${version}',
      'Fixture.pdf','application/pdf',100,'${"c".repeat(64)}','clean'),
      ('${contractVersion}','${contractDoc}','${lecturer}','${contractUpload}',1,'${lecturer}/${contractDoc}/${contractVersion}',
      'Agreement.pdf','application/pdf',110,'${"b".repeat(64)}','clean');
    update public.documents set current_version_id='${version}' where id='${doc}';
    update public.documents set current_version_id='${contractVersion}' where id='${contractDoc}';
    insert into public.contracts(id,user_id,status,effective_from,version,document_version_id,document_sha256)
      values ('${contract}','${lecturer}','active',now()-interval '1 year',1,'${contractVersion}','${"b".repeat(64)}');
    insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)
      values ('${job}','Fictional cancellation','Fictional Academy','online','filled',300,300,'AUD','fixed_total','Fictional terms');
    insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,status,amount,currency,rate_unit,total_amount,terms,terms_version,contract_id)
      values ('${claim}','${job}','${lecturer}',gen_random_uuid(),'confirmed',300,'AUD','fixed_total',300,'Fictional terms',1,'${contract}');
    insert into public.job_sessions(job_id,starts_at,ends_at)
      values ('${job}',now()-interval '5 days',now()-interval '5 days'+interval '1 hour'),
             ('${job}',now()+interval '5 days',now()+interval '5 days 1 hour');
    insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at)
      values ('${past}','${claim}','${lecturer}',now()-interval '5 days',now()-interval '5 days'+interval '1 hour'),
             ('${future}','${claim}','${lecturer}',now()+interval '5 days',now()+interval '5 days 1 hour');
  `);
  const rpc = (who, name, args = []) =>
    actor(
      who,
      `select to_jsonb(public.${name}(${args
        .map((value) =>
          value === null
            ? "null"
            : typeof value === "number" || typeof value === "boolean"
              ? String(value)
              : q(value),
        )
        .join(",")}))`,
    ).then((result) => (result ? JSON.parse(result) : null));
  const list = (who = lecturer) =>
    rpc(who, "invoice_series_corrections", [null, false]);
  const options = (who = manager) =>
    rpc(who, "invoice_series_corrections", [claim, true]);
  const propose = (amount, who = manager, key = id(), agreement = contract) =>
    rpc(who, "propose_invoice_series_correction", [
      claim,
      agreement,
      amount,
      date,
      note,
      key,
    ]);
  const record = (
    correction,
    amount,
    key = id(),
    who = manager,
    when = date,
    reference = "Fictional receipt " + key,
  ) =>
    rpc(who, "record_invoice_series_repayment", [
      correction,
      amount,
      when,
      reference,
      key,
    ]);
  const acknowledge = (correction, who = lecturer) =>
    rpc(who, "acknowledge_invoice_series_correction", [correction]);
  const withdraw = (correction, who = manager) =>
    rpc(who, "withdraw_invoice_series_correction", [correction, note]);
  const voidRepayment = (receipt) =>
    rpc(manager, "void_invoice_series_repayment", [receipt, note]);
  const entry = async (id) =>
    (await list()).entries.find((value) => value.id === id);

  assert.equal((await options()).options.can_propose, false);
  await assert.rejects(propose(20), /PT409/);
  await assert.rejects(options(lecturer), /42501/);
  await assert.rejects(
    rpc(manager, "invoice_series_corrections", [null, true]),
    /22023/,
  );
  const interim = await rpc(manager, "approve_invoice_series_entry", [
    claim,
    contract,
    "interim",
    125,
    date,
    note,
    id(),
  ]);
  const invoice = await rpc(lecturer, "submit_invoice_series_entry", [
    interim,
    "AUD-INTERIM",
    version,
    date,
    id(),
  ]);
  await rpc(manager, "review_invoice", [invoice, "approved", note]);
  const p1 = await rpc(manager, "record_invoice_payment", [
    invoice,
    85,
    date,
    "Fictional bank reference",
    id(),
  ]);
  const p2 = await rpc(manager, "record_invoice_payment", [
    invoice,
    40,
    date,
    "Fictional bank reference",
    id(),
  ]);
  const snapshot = await sql(`select jsonb_build_object(
    'invoice', (select to_jsonb(i) from public.invoices i where i.id='${invoice}'),
    'payments', (select jsonb_agg(to_jsonb(p) order by p.id) from public.payment_records p where p.invoice_id='${invoice}')
  )`);
  assert.equal((await options()).options.can_propose, false);
  await sql(`
    update public.job_sessions set starts_at=now()-interval '2 days',ends_at=now()-interval '2 days'+interval '1 hour'
      where job_id='${job}' and starts_at>now();
    update public.assignment_sessions set starts_at=now()-interval '2 days',ends_at=now()-interval '2 days'+interval '1 hour'
      where id='${future}';
  `);
  assert.equal((await options()).options.can_propose, true);
  assert.equal((await options()).options.credited, 125);
  await assert.rejects(propose(125), /22023/);
  await assert.rejects(propose(-1), /22023/);
  await assert.rejects(propose(70, manager, id(), id()), /22023/);
  await assert.rejects(propose(75, outsider), /42501/);
  await sql(
    `insert into public.user_roles(user_id,role) values ('${lecturer}','management')`,
  );
  assert.equal((await options(lecturer)).options.can_propose, false);
  await assert.rejects(propose(80, lecturer), /42501/);

  const firstKey = id();
  const [first, original] = await Promise.all([
    propose(80, manager, firstKey),
    propose(80, manager, firstKey),
  ]);
  assert.equal(first, original);
  await assert.rejects(propose(90, manager, firstKey), /22023/);
  const firstEntry = await entry(first);
  assert.deepEqual(
    [
      firstEntry.balance,
      firstEntry.credited,
      firstEntry.outstanding,
      firstEntry.currency,
      firstEntry.state,
    ],
    [-45, 125, 45, "AUD", "proposed"],
  );
  assert.deepEqual(
    firstEntry.credits.map(({ payment_id }) => payment_id).sort(),
    [p1, p2].sort(),
  );
  assert.deepEqual(await list(outsider), { options: null, entries: [] });
  await assert.rejects(acknowledge(first, outsider), /42501/);
  await assert.rejects(record(first, 1), /PT409/);
  await assert.rejects(
    rpc(manager, "approve_invoice_series_entry", [
      claim,
      contract,
      "final",
      200,
      date,
      note,
      id(),
    ]),
    /PT409/,
  );
  await assert.rejects(
    rpc(manager, "void_invoice_payment", [p1, note]),
    /PT409/,
  );
  await assert.rejects(
    actor(outsider, "select count(*) from private.invoice_series_corrections"),
    /42501/,
  );
  console.log(
    "PASS original receipt IDs, reviewed contract and negative AUD balance, independent finance and cross-role denial",
  );

  await rpc(lecturer, "dispute_invoice_series_correction", [first, dispute]);
  await rpc(lecturer, "dispute_invoice_series_correction", [first, dispute]);
  assert.equal((await entry(first)).state, "disputed");
  await assert.rejects(acknowledge(first), /PT409/);
  await assert.rejects(record(first, 1), /PT409/);
  await withdraw(first);
  await withdraw(first);
  assert.equal((await entry(first)).state, "withdrawn");
  assert.equal((await entry(first)).dispute_note, dispute);
  const stale = await propose(50);
  await sql(
    `update public.assignment_sessions set ends_at=ends_at+interval '5 minutes' where id='${future}'`,
  );
  assert.equal((await entry(stale)).state, "stale");
  await assert.rejects(acknowledge(stale), /PT409/);
  await withdraw(stale);
  console.log(
    "PASS dispute and stale evidence block confirmation and receipts; review history survives withdrawal",
  );

  const current = await propose(80);
  await acknowledge(current);
  await acknowledge(current);
  assert.equal((await entry(current)).state, "acknowledged");
  await assert.rejects(record(current, 1, id(), lecturer), /42501/);
  await assert.rejects(
    record(current, 1, id(), manager, "2099-01-01"),
    /22023/,
  );
  const receiptKey = id();
  const [partial, replay] = await Promise.all([
    record(current, 20.25, receiptKey),
    record(current, 20.25, receiptKey),
  ]);
  assert.equal(partial, replay);
  await assert.rejects(
    record(current, 7, id(), manager, date, "Fictional receipt " + receiptKey),
    /PT409.*Duplicate active repayment reference/,
  );
  await assert.rejects(record(current, 20, receiptKey), /22023/);
  await assert.rejects(withdraw(current), /PT409/);
  const race = await Promise.allSettled([
    record(current, 24.75),
    record(current, 24.75),
  ]);
  assert.equal(race.filter(({ status }) => status === "fulfilled").length, 1);
  assert.match(
    race.find(({ status }) => status === "rejected").reason.message,
    /PT409/,
  );
  assert.deepEqual(
    [
      (await entry(current)).state,
      (await entry(current)).repaid,
      (await entry(current)).outstanding,
    ],
    ["settled", 45, 0],
  );
  await voidRepayment(partial);
  await voidRepayment(partial);
  const afterVoid = await entry(current);
  assert.equal(afterVoid.state, "acknowledged");
  assert.equal(afterVoid.outstanding, 20.25);
  assert.ok(afterVoid.repayments.find(({ id }) => id === partial).voided_at);
  assert.equal(
    afterVoid.repayments.find(({ id }) => id === partial).amount,
    20.25,
  );
  await assert.rejects(withdraw(current), /PT409/);
  await record(
    current,
    20.25,
    id(),
    manager,
    date,
    "Fictional receipt " + receiptKey,
  );
  const restored = await entry(current);
  assert.equal(restored.state, "settled");
  assert.equal(restored.repayments.length, 3);
  assert.equal(
    Number(await sql(`select private.claim_paid_amount('${claim}')`)),
    125,
  );
  assert.equal(
    await sql(`select jsonb_build_object(
    'invoice', (select to_jsonb(i) from public.invoices i where i.id='${invoice}'),
    'payments', (select jsonb_agg(to_jsonb(p) order by p.id) from public.payment_records p where p.invoice_id='${invoice}')
  )`),
    snapshot,
  );
  console.log(
    "PASS explicit acknowledge, partial and concurrent repayment cap, additive void/re-entry and byte-identical historic invoice and payments",
  );
});
