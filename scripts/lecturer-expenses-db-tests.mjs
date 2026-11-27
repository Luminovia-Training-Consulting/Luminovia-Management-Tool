/** Exercise the migrated expense workflow and role boundaries in an owned test database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql, withTestDatabase } from "./testing/database.mjs";

assert.equal(process.env.PORTAL_TEST_MODE, "1");
assert.match(process.env.PORTAL_DB_CONTAINER ?? "", /^supabase_db_luminovia-portal-test-[a-f0-9]+$/);
const code = (value) => new RegExp("ERROR:\\s+" + value + ":");
const q = quoteSql;
const id = () => q(randomUUID());
const json = (value) => value === "" ? null : JSON.parse(value);

await withTestDatabase("lecturer_expenses", async ({ sql, actor }) => {
  const lecturer = randomUUID(), finance = randomUUID(), other = randomUUID(), customer = randomUUID();
  const job = id(), claim = id(), session = id();
  const roles = [[lecturer, "lecturer"], [finance, "management"], [other, "lecturer"], [customer, "client"]];
  await sql(
    "insert into auth.users(id,email,email_confirmed_at) values " +
    roles.map(([who]) => "(" + q(who) + "," + q(who + "@example.invalid") + ",now())").join(",") +
    "; insert into public.user_roles(user_id,role) values " +
    roles.map(([who, role]) => "(" + q(who) + "," + q(role) + ")").join(",") + " on conflict do nothing;" +
    " insert into public.jobs(id,title,customer_name,delivery_type,amount,currency,rate_unit,total_amount,terms) values (" +
    job + ",'Fictional model course','Fictional customer','online',350.00,'EUR','fixed_total',350.00,'Fictional scope');" +
    " insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version) values (" +
    claim + "," + job + "," + q(lecturer) + "," + id() + ",350.00,'EUR','fixed_total',350.00,'Fictional scope',1);" +
    " insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at) values (" +
    session + "," + claim + "," + q(lecturer) + ",current_date - interval '2 days', current_date - interval '2 days' + interval '1 hour');"
  );
  const date = await sql("select current_date::text");
  const report = (who, staff = false) =>
    actor(who, "select public.lecturer_expense_report(" + staff + ", current_date-7,current_date)").then(json);
  const reserve = (who, hash, key = id()) =>
    actor(who, "select public.reserve_expense_receipt('Fictional receipt.pdf','application/pdf',200," + key + "," + q(hash) + ")").then(json);
  const download = (who, expense, version) =>
    actor(who, "select public.expense_receipt_download(" + q(expense) + "," + q(version) + ")").then(json);
  const action = (who, args) =>
    actor(who, "select public.lecturer_expense_action(" + [
      q(args.action), args.expense ? q(args.expense) : "null", args.revision ?? 0,
      q(JSON.stringify(args.payload)), args.key ?? id(),
    ].join(",") + ")").then(json);
  const service = (statement) => sql("begin; set local role service_role; " + statement + "; commit;");
  async function promote(reservation, digest) {
    const document = q(reservation.document_id), version = q(reservation.version_id);
    const lease = q(await service("select public.deletion_upload_begin(" + document + "," + version + ")"));
    await service("update public.document_versions set status='scanning' where id=" + version +
      "; update public.documents set status='scanning' where id=" + document);
    await assert.rejects(service("select public.complete_document_upload(" + document + "," + version + "," +
      lease + "," + q("f".repeat(64)) + ",'ClamAV Fictional scanner')"), code("22023"));
    await service("select public.complete_document_upload(" + document + "," + version + "," +
      lease + "," + q(digest) + ",'ClamAV Fictional scanner')");
    await service("select public.deletion_upload_end(" + lease + ")");
  }

  const digest = "a".repeat(64), uploadKey = id(), reservation = await reserve(lecturer, digest, uploadKey);
  assert.deepEqual(await reserve(lecturer, digest, uploadKey), reservation);
  await assert.rejects(reserve(lecturer, "b".repeat(64), uploadKey), code("PT409"));
  await assert.rejects(reserve(customer, digest), code("42501"));
  await assert.rejects(actor(lecturer,
    "select public.reserve_document('receipt.pdf','application/pdf',200,'personal','expense_receipt',null,null," + id() + ")"),
    code("42501"));
  assert.equal(await actor(lecturer, "select count(*) from public.documents where id=" + q(reservation.document_id)), "0");
  const submission = {
    action: "submit", key: id(), payload: {
      claim_id: claim.slice(1, -1), session_id: session.slice(1, -1),
      receipt_version_id: reservation.version_id, category: "travel", spent_on: date,
      description: "Fictional public transport", currency: "EUR", amount: "130.50",
    },
  };
  await assert.rejects(action(lecturer, submission), code("42501"));
  await promote(reservation, digest);
  await assert.rejects(action(other, submission), code("42501"));
  await assert.rejects(action(lecturer, {
    ...submission, key: id(),
    payload: { ...submission.payload, session_id: randomUUID() },
  }), code("42501"));
  const [first, replay] = await Promise.all([action(lecturer, submission), action(lecturer, submission)]);
  assert.deepEqual(first, replay);
  assert.equal(first.state, "submitted");
  assert.equal(first.revision, 1);
  assert.match((await download(finance, first.id, reservation.version_id)).sha256, /^a{64}$/);
  assert.equal(await download(other, first.id, reservation.version_id), null);
  await assert.rejects(report(customer, true), code("42501"));
  assert.deepEqual(await report(other), { items: [], totals: [] });

  const duplicateReceipt = await reserve(lecturer, digest);
  await promote(duplicateReceipt, digest);
  await assert.rejects(action(lecturer, {
    ...submission, key: id(), payload: { ...submission.payload, receipt_version_id: duplicateReceipt.version_id },
  }), code("23505"));
  await action(finance, { action: "correction", expense: first.id, revision: 1, payload: { note: "Fictional correction" } });
  await assert.rejects(action(finance, { action: "approve", expense: first.id, revision: 1, payload: { amount: "42.12" } }), code("PT409"));
  await action(lecturer, {
    action: "resubmit", expense: first.id, revision: 2,
    payload: { ...submission.payload, amount: "120.50" },
  });
  await assert.rejects(action(finance, { action: "approve", expense: first.id, revision: 3, payload: { amount: "42.12" } }), code("22023"));
  const approval = await action(finance, {
    action: "approve", expense: first.id, revision: 3, payload: { amount: "42.12", note: "Fictional partial amount" },
  });
  assert.equal(approval.state, "approved");
  assert.deepEqual((await report(finance, true)).totals, [
    { currency: "EUR", submitted: "120.50", approved: "42.12", paid: "0", outstanding: "42.12" },
  ]);
  const reimbursable = {
    action: "reimburse", expense: first.id, revision: 4, key: id(),
    payload: { paid_on: date, reference: "Fictional bank record" },
  };
  const paid = await action(finance, reimbursable);
  assert.equal(paid.state, "reimbursed");
  assert.deepEqual(await action(finance, reimbursable), paid);
  await assert.rejects(action(finance, { ...reimbursable, key: id(), revision: 5 }), code("22023"));
  assert.deepEqual((await report(lecturer)).totals, [
    { currency: "EUR", submitted: "120.50", approved: "42.12", paid: "42.12", outstanding: "0" },
  ]);
  const journal = (name) => actor(finance, "select public." + name + "(current_date-1,current_date)").then(json);
  assert.deepEqual((await journal("accounting_settlement_journal")).items, []);
  const posted = await journal("accounting_settlement_with_expenses");
  assert.equal(posted.items[0].kind, "expense_reimbursement");
  assert.equal(posted.items[0].amount, "42.12");
  assert.equal(posted.items[0].subject_id, claim.slice(1, -1));
  assert.equal(posted.totals[0].net, "42.12");
  assert.equal(await sql("select total_amount::text from public.job_claims where id=" + claim), "350.00");
  await sql("delete from public.user_roles where user_id=" + q(finance));
  assert.equal(await download(finance, first.id, reservation.version_id), null);
  console.log("PASS scan binding, isolation, correction, partial approval, reimbursement and settlement reconciliation");
});
