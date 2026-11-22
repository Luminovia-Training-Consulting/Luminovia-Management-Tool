import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("customer_settlement", async ({ sql, actor }) => {
  const [finance, secondFinance, teacher, manager, customer, org] = Array.from(
    { length: 6 },
    randomUUID,
  );
  const accounts = [
    [finance, "admin"],
    [secondFinance, "admin"],
    [teacher, "lecturer"],
    [manager, "management"],
    [customer, "client"],
  ];
  await sql(`
    insert into auth.users(id,email) values ${accounts.map(([id]) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
    insert into public.user_roles(user_id,role) values ${accounts.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
    insert into public.organisations(id,name) values(${q(org)},'Fictional settlement customer');
    insert into public.client_organisation_memberships(user_id,organisation_id) values (${q(customer)},${q(org)});
  `);
  async function rpc(who, name, args = []) {
    return JSON.parse(
      await actor(who, `select public.${name}(${args.join(",")})`),
    );
  }
  async function pdf(owner, status = "clean", sameHash) {
    const document = randomUUID(),
      version = randomUUID(),
      key = randomUUID();
    const sha = sameHash ?? createHash("sha256").update(document).digest("hex");
    await sql(`
      insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
        values(${q(document)},${q(owner)},${q(owner)},'personal','material','Fictional evidence.pdf','application/pdf',100,${q(status)},${q(key)});
      insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status)
        values(${q(version)},${q(document)},${q(owner)},${q(key)},1,${q(owner + "/" + version)},'Fictional evidence.pdf','application/pdf',100,${q(sha)},${q(status)});
      update public.documents set current_version_id=${q(version)} where id=${q(document)};
    `);
    return { document, version, sha };
  }
  async function invoice(number, currency = "AUD") {
    const job = randomUUID(),
      claim = randomUUID(),
      evidence = await pdf(finance);
    await sql(`
      insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)
        values(${q(job)},'Fictional contract','Fictional settlement customer','online','filled',50.00,50.00,${q(currency)},'fixed_total','Confirmed fictional terms');
      insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version)
        values(${q(claim)},${q(job)},${q(teacher)},${q(randomUUID())},50.00,50.00,${q(currency)},'fixed_total','Confirmed fictional terms',1);
      insert into private.claim_revenue_ledger(claim_id,job_id,organisation_id,lecturer_id,gross_amount,gross_total_amount,platform_percent,
        platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency)
        values(${q(claim)},${q(job)},${q(org)},${q(teacher)},100.00,100.00,50,50.00,50.00,50.00,${q(currency)});
    `);
    const receipt = await rpc(finance, "register_customer_invoice", [
      q(
        JSON.stringify({
          claim_ids: [claim],
          number,
          issued_on: "2020-02-01",
          due_on: "2020-03-01",
          currency,
          total_amount: "100.00",
          document_version_id: evidence.version,
          difference_reason: "",
        }),
      ),
      q(randomUUID()),
    ]);
    return { ...receipt, evidence, claim };
  }
  const original = await invoice("Fictional INV-A");
  const cancelled = await invoice("Fictional INV-B", "EUR");
  const foreignCustomer = randomUUID();
  await sql(`
    insert into auth.users(id,email) values(${q(foreignCustomer)},'foreign-'||${q(foreignCustomer)}||'@example.invalid');
    insert into public.user_roles(user_id,role) values(${q(foreignCustomer)},'client');
  `);
  const rpcWithId = (who, name, invoiceId, args = []) =>
    rpc(who, name, [q(invoiceId), ...args]);
  const read = (who = finance, invoiceId = original.id) =>
    rpcWithId(who, "accounting_customer_settlement", invoiceId);
  const note = async (
    reference,
    amount,
    invoiceId = original.id,
    currency = "AUD",
  ) => {
    const evidence = await pdf(finance);
    return await rpcWithId(
      finance,
      "register_customer_credit_note",
      invoiceId,
      [
        q(
          JSON.stringify({
            reference,
            amount,
            issued_on: "2020-02-05",
            currency,
            document_version_id: evidence.version,
            issued_and_reviewed: true,
            reason: "Fictional external credit",
          }),
        ),
        q(randomUUID()),
      ],
    );
  };
  const apply = (
    who,
    noteId,
    key = randomUUID(),
    invoiceId = original.id,
    reason = "Fictional reviewed credit",
  ) =>
    rpcWithId(who, "apply_customer_invoice_credit_note", invoiceId, [
      q(noteId),
      q(reason),
      q(key),
    ]);
  const reverseCredit = (applicationId, invoiceId = original.id) =>
    rpcWithId(finance, "reverse_customer_invoice_credit_note", invoiceId, [
      q(applicationId),
      q("Fictional credit allocation correction"),
      q(randomUUID()),
    ]);
  const payment = (
    amount,
    reference,
    invoiceId = original.id,
    key = randomUUID(),
  ) =>
    rpcWithId(finance, "record_customer_invoice_payment", invoiceId, [
      q(amount),
      q("2020-02-08T11:00:00Z"),
      q(reference),
      q(key),
    ]);
  const reversePayment = (paymentId) =>
    rpcWithId(finance, "reverse_customer_invoice_payment", original.id, [
      q(paymentId),
      q("Fictional payment booking correction"),
      q(randomUUID()),
    ]);
  const refund = (
    who,
    amount,
    reference,
    key = randomUUID(),
    invoiceId = original.id,
    at = "2020-02-09T23:30:00Z",
  ) =>
    rpcWithId(who, "record_customer_invoice_refund", invoiceId, [
      q(amount),
      q(at),
      q(reference),
      q(key),
    ]);
  const reverseRefund = (
    refundId,
    key = randomUUID(),
    invoiceId = original.id,
  ) =>
    rpcWithId(finance, "reverse_customer_invoice_refund", invoiceId, [
      q(refundId),
      q("Fictional refund journal correction"),
      q(key),
    ]);
  const exportInvoice = () =>
    rpc(finance, "create_accounting_export", [
      q("customer"),
      `array[${q(original.id)}]::uuid[]`,
      q(randomUUID()),
    ]);

  for (const denied of [teacher, manager, foreignCustomer])
    await assert.rejects(read(denied), /42501/);
  const masked = await read(customer);
  assert.equal(masked.can_manage, false);
  assert.equal(masked.credit_applications, null);
  assert.equal(masked.refunds, null);
  assert.equal(masked.outstanding_total, "100.00");
  assert.equal(masked.status, "open");
  const credit = await note("Fictional CR-01", "20.01");
  assert.equal((await read()).credit_total, "0.00");
  await assert.rejects(apply(customer, credit.id), /42501/);
  await assert.rejects(
    refund(customer, "1.00", "Fictional leaked reference"),
    /42501/,
  );
  await assert.rejects(
    apply(finance, credit.id, randomUUID(), cancelled.id),
    /42501/,
  );
  await assert.rejects(
    actor(customer, "select * from private.accounting_customer_refunds"),
    /permission denied/,
  );
  console.log(
    "PASS explicitly applied scoped credits and restricted audit disclosures",
  );

  const firstPayment = await payment("30.00", "Fictional first deposit");
  const earlyExport = await exportInvoice();
  const applications = await Promise.allSettled(
    [finance, secondFinance].map((who) => {
      const key = randomUUID();
      return apply(who, credit.id, key).then((receipt) => ({
        who,
        key,
        receipt,
      }));
    }),
  );
  assert.equal(applications.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(
    applications.find((r) => r.status === "rejected").reason.message,
    /PT409/,
  );
  const {
    who,
    key,
    receipt: application,
  } = applications.find((r) => r.status === "fulfilled").value;
  assert.deepEqual(await apply(who, credit.id, key), application);
  await assert.rejects(
    apply(
      who,
      credit.id,
      key,
      original.id,
      "Fictional different approval reason",
    ),
    /request key conflict/,
  );
  const partial = await read();
  assert.deepEqual(
    [
      partial.status,
      partial.credit_total,
      partial.net_total,
      partial.received_total,
      partial.outstanding_total,
    ],
    ["partially_paid", "20.01", "79.99", "30.00", "49.99"],
  );
  assert.deepEqual(await exportInvoice(), earlyExport);
  console.log(
    "PASS concurrent exact credit application, partial net amount and stable accounting/1 export",
  );

  const paidKey = randomUUID();
  const lastPayment = await payment(
    "70.00",
    "Fictional actual late transfer",
    original.id,
    paidKey,
  );
  assert.deepEqual(
    await payment(
      "70.00",
      "Fictional actual late transfer",
      original.id,
      paidKey,
    ),
    lastPayment,
  );
  await assert.rejects(
    payment("0.01", "Fictional excess receipt"),
    /exceeds the recorded invoice total/,
  );
  const paidExport = await exportInvoice();
  const overpaid = await read();
  assert.deepEqual(
    [
      overpaid.status,
      overpaid.received_total,
      overpaid.refund_due_total,
      overpaid.outstanding_total,
    ],
    ["refund_due", "100.00", "20.01", "0.00"],
  );
  assert.equal(paidExport.invoices[0].paid_total, "100.00");
  assert.equal(paidExport.invoices[0].outstanding_total, "0.00");
  assert.equal(paidExport.invoices[0].credit_note_reference, null);
  console.log(
    "PASS actual late cash receipts create a refundable surplus after a credit",
  );

  await assert.rejects(
    refund(finance, "0.00", "Fictional zero refund"),
    /22023/,
  );
  await assert.rejects(
    refund(
      finance,
      "0.01",
      "Fictional future refund",
      randomUUID(),
      original.id,
      "2999-01-01T00:00:00Z",
    ),
    /22023/,
  );
  await assert.rejects(
    refund(finance, "20.02", "Fictional refund too large"),
    /PT409/,
  );
  const attemptedRefunds = await Promise.allSettled(
    [finance, secondFinance].map((who, index) => {
      const key = randomUUID(),
        ref = "Fictional bank refund " + index;
      return refund(who, "12.00", ref, key).then((receipt) => ({
        who,
        key,
        ref,
        receipt,
      }));
    }),
  );
  assert.equal(
    attemptedRefunds.filter((r) => r.status === "fulfilled").length,
    1,
  );
  assert.match(
    attemptedRefunds.find((r) => r.status === "rejected").reason.message,
    /PT409/,
  );
  const made = attemptedRefunds.find((r) => r.status === "fulfilled").value;
  assert.deepEqual(
    await refund(made.who, "12.00", made.ref, made.key),
    made.receipt,
  );
  await assert.rejects(
    refund(finance, "0.01", made.ref.toUpperCase()),
    /already recorded/,
  );
  await assert.rejects(
    reverseCredit(application.id),
    /invalidate a recorded refund/,
  );
  await assert.rejects(
    reversePayment(firstPayment.id),
    /invalidate a recorded refund/,
  );
  const final = await refund(finance, "8.01", "Fictional final refund");
  const closed = await read();
  assert.deepEqual(
    [
      closed.status,
      closed.refunded_total,
      closed.retained_total,
      closed.refund_due_total,
    ],
    ["refunded", "20.01", "79.99", "0.00"],
  );
  const customerClosed = await read(customer);
  assert.equal(customerClosed.refunded_total, "20.01");
  assert.equal(customerClosed.credit_applications, null);
  assert.equal(customerClosed.refunds, null);
  assert.deepEqual(await exportInvoice(), paidExport);
  console.log(
    "PASS concurrent refunds stay within actual surplus and block incompatible reversals",
  );

  const correctionKey = randomUUID();
  const correction = await reverseRefund(final.id, correctionKey);
  assert.deepEqual(await reverseRefund(final.id, correctionKey), correction);
  await assert.rejects(reverseRefund(final.id), /already reversed/);
  await assert.rejects(
    reverseRefund(made.receipt.id, randomUUID(), cancelled.id),
    /42501/,
  );
  assert.equal((await read()).refund_due_total, "8.01");
  const corrected = await refund(finance, "8.01", "Fictional final refund");
  await reverseRefund(corrected.id);
  await reverseRefund(made.receipt.id);
  const reversedApplication = await reverseCredit(application.id);
  assert.equal((await read()).credit_total, "0.00");
  await reversePayment(firstPayment.id);
  assert.equal((await read()).outstanding_total, "30.00");
  await assert.rejects(
    sql(
      `update private.accounting_customer_credit_applications set reason='mutated' where id=${q(reversedApplication.id)}`,
    ),
    /immutable/,
  );
  await assert.rejects(
    sql(
      `delete from private.accounting_customer_refunds where id=${q(final.id)}`,
    ),
    /immutable/,
  );
  assert.equal(
    await sql(
      `select count(*) from public.audit_events where action='accounting.customer_refund_recorded' and resource_id=${q(made.receipt.id)}`,
    ),
    "1",
  );
  console.log(
    "PASS append-only exact refund and credit corrections restore the applicable net balance",
  );

  const full = await note(
    "Fictional full cancellation",
    "100.00",
    cancelled.id,
    "EUR",
  );
  await apply(finance, full.id, randomUUID(), cancelled.id);
  const creditClosed = await read(finance, cancelled.id);
  assert.deepEqual(
    [
      creditClosed.status,
      creditClosed.net_total,
      creditClosed.received_total,
      creditClosed.outstanding_total,
      creditClosed.refund_due_total,
    ],
    ["fully_credited", "0.00", "0.00", "0.00", "0.00"],
  );
  await assert.rejects(
    refund(
      finance,
      "0.01",
      "Fictional unpaid cancellation",
      randomUUID(),
      cancelled.id,
    ),
    /refundable overpayment/,
  );
  await payment(
    "100.00",
    "Fictional full payment sent before credit acknowledgement",
    cancelled.id,
  );
  const fullRefund = await refund(
    finance,
    "100.00",
    "Fictional full refund",
    randomUUID(),
    cancelled.id,
  );
  assert.equal((await read(finance, cancelled.id)).status, "refunded");
  await sql(
    `delete from public.client_organisation_memberships where user_id=${q(customer)} and organisation_id=${q(org)}`,
  );
  await assert.rejects(read(customer), /42501/);
  console.log(
    "PASS full credit closes an unpaid invoice, allows a later full refund after real cash and revokes customer visibility",
  );
  const journal = (who, from, to = from) =>
    rpc(who, "accounting_settlement_journal", [q(from), q(to)]);
  const recorded = await journal(finance, "2020-02-09");
  assert.equal(recorded.schema_version, "luminovia.settlement-journal/1");
  assert.deepEqual(recorded.scopes, ["customer", "lecturer"]);
  assert.deepEqual(recorded.totals, [
    {
      kind: "customer_refund",
      currency: "AUD",
      recorded: "28.02",
      reversed: "0.00",
      net: "28.02",
    },
    {
      kind: "customer_refund",
      currency: "EUR",
      recorded: "100.00",
      reversed: "0.00",
      net: "100.00",
    },
  ]);
  assert.equal(recorded.items.length, 4);
  assert.ok(
    recorded.items.every(
      ({ effective_on, reverses_id }) =>
        effective_on === "2020-02-09" && reverses_id === null,
    ),
  );
  assert.ok(
    recorded.items.some(
      ({ id, subject_id }) =>
        id === fullRefund.id && subject_id === cancelled.id,
    ),
  );
  assert.deepEqual((await journal(finance, "2020-02-10")).items, []);
  const fromOtherZone = JSON.parse(
    await actor(
      finance,
      `
    set local timezone='Australia/Brisbane';
    select public.accounting_settlement_journal('2020-02-09', '2020-02-09')
  `,
    ),
  );
  assert.deepEqual(fromOtherZone.items, recorded.items);
  assert.deepEqual((await journal(manager, "2020-02-09")).scopes, ["lecturer"]);
  assert.deepEqual((await journal(manager, "2020-02-09")).items, []);
  for (const account of [customer, teacher, foreignCustomer])
    await assert.rejects(journal(account, "2020-02-09"), /42501/);
  await assert.rejects(
    sql(
      "begin; set local role anon; select public.accounting_settlement_journal('2020-02-09','2020-02-09')",
    ),
    /42501/,
  );
  await assert.rejects(journal(finance, "2020-02-10", "2020-02-09"), /22023/);
  await assert.rejects(journal(finance, "2020-02-09", "2021-02-09"), /22023/);
  await assert.rejects(journal(finance, "infinity"), /22023/);
  assert.deepEqual(
    (await journal(finance, "2019-01-01", "2020-01-01")).items,
    [],
  );

  const postingPeriod = JSON.parse(
    await sql(`
    select jsonb_build_array(min(posted), max(posted))
    from (
      select (created_at at time zone 'UTC')::date as posted
      from private.accounting_customer_credit_applications
      union all
      select (created_at at time zone 'UTC')::date
      from private.accounting_customer_refunds
      where reverses_id is not null
    ) dates
  `),
  );
  const posted = await journal(finance, ...postingPeriod);
  assert.deepEqual(posted.totals, [
    {
      kind: "customer_credit",
      currency: "AUD",
      recorded: "20.01",
      reversed: "20.01",
      net: "0.00",
    },
    {
      kind: "customer_refund",
      currency: "AUD",
      recorded: "0.00",
      reversed: "28.02",
      net: "-28.02",
    },
    {
      kind: "customer_credit",
      currency: "EUR",
      recorded: "100.00",
      reversed: "0.00",
      net: "100.00",
    },
  ]);
  assert.equal(
    posted.items.find(({ id }) => id === correction.id).reference,
    "Fictional final refund",
  );
  assert.equal(
    posted.items.find(({ id }) => id === reversedApplication.id).reverses_id,
    application.id,
  );
  assert.ok(
    posted.items.every(
      (item) => !("reason" in item) && !("recorded_by" in item),
    ),
  );
  const unchanged = await rpc(finance, "accounting_export", [q(paidExport.id)]);
  assert.deepEqual(unchanged, paidExport);

  // Saturate an independent fixture date to verify the cap without silently discarding rows.
  await sql(`
    insert into private.accounting_customer_credit_applications(invoice_id,credit_note_id,reason,recorded_by,created_at)
    select ${q(original.id)},${q(credit.id)},'Fictional report-cap fixture',${q(finance)},'2020-02-12T00:00:00Z'
    from generate_series(1,5001)
  `);
  await assert.rejects(journal(finance, "2020-02-12"), /PT413/);
  await sql(
    `update public.profiles set active=false where id=${q(secondFinance)}`,
  );
  await assert.rejects(journal(secondFinance, "2020-02-09"), /42501/);
  console.log(
    "PASS original-currency report, UTC boundaries, later reversals, retained exports, scope, deactivation and complete-result limit",
  );
});
