/** Company-only customer journal feeds and the existing signed HTTP transport. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";
import { verifyWebhookDeliveryHttp } from "./testing/company-course-webhook-http.mjs";

await withTestDatabase("company_acct_webhooks", async ({ actor, sql }) => {
  const [admin, author, staff, lecturer, customer, company, other, template] =
    Array.from({ length: 8 }, randomUUID);
  const accounts = [
    [admin, "admin"],
    [author, "owner"],
    [staff, "management"],
    [lecturer, "lecturer"],
    [customer, "client"],
  ];
  await sql(`
    insert into auth.users(id,email) values ${accounts.map(([id]) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
    insert into public.user_roles(user_id,role) values ${accounts.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
    insert into public.organisations(id,name) values (${q(company)},'Fictional customer'),(${q(other)},'Other fictional customer');
    insert into public.client_organisation_memberships(user_id,organisation_id) values (${q(customer)},${q(company)});
    insert into public.course_templates(id,title) values (${q(template)},'Fictional course');
  `);
  const rpc = (who, name, ...args) =>
    actor(who, `select public.${name}(${args.map(q).join(",")})`);
  const issueKey = async (organisation) =>
    JSON.parse(
      await actor(
        admin,
        `select public.issue_company_integration_key(${q(organisation)},'Fictional key',now()+interval '7 days',null,null)`,
      ),
    );
  const key = await issueKey(company);
  const foreignKey = await issueKey(other);
  const subscribe = (who, organisation, integration, alias) =>
    rpc(
      who,
      "company_accounting_webhook_subscribe",
      organisation,
      integration,
      alias,
    );
  const listing = async () =>
    JSON.parse(await rpc(admin, "company_course_webhook_list", company));
  const accounting = JSON.parse(
    await subscribe(author, company, key.id, "accounts"),
  );
  const course = JSON.parse(
    await rpc(
      admin,
      "company_course_webhook_subscribe",
      company,
      key.id,
      "courses",
    ),
  );
  const foreign = JSON.parse(
    await subscribe(admin, other, foreignKey.id, "accounts"),
  );
  for (const who of [staff, lecturer, customer]) {
    await assert.rejects(subscribe(who, company, key.id, "denied"), /42501/);
  }
  await assert.rejects(subscribe(admin, other, key.id, "denied"), /42501/);
  await assert.rejects(subscribe(admin, company, key.id, "accounts"), /23505/);
  await assert.rejects(
    subscribe(admin, company, key.id, "https://bad.example"),
    /22023/,
  );
  await assert.rejects(
    sql(
      `set role anon; select public.company_accounting_webhook_subscribe(${q(company)},${q(key.id)},'denied')`,
    ),
    /42501/,
  );
  await assert.rejects(
    sql(
      "set role service_role; select invoice_id from private.company_course_webhook_deliveries",
    ),
    /42501/,
  );
  await sql(
    "delete from public.role_permissions where role='admin' and permission='finance.gross.read'",
  );
  await assert.rejects(subscribe(admin, company, key.id, "denied"), /42501/);
  await assert.rejects(
    rpc(admin, "company_course_webhook_revoke", company, accounting.id),
    /42501/,
  );
  assert.deepEqual(
    (await listing()).map(({ id }) => id),
    [course.id],
  );
  await sql(
    "insert into public.role_permissions(role,permission) values ('admin','finance.gross.read')",
  );

  async function pdf() {
    const [document, version, clientId] = Array.from({ length: 3 }, randomUUID);
    const digest = createHash("sha256").update(document).digest("hex");
    await sql(`
      insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
        values(${q(document)},${q(admin)},${q(admin)},'personal','material','Private fictional evidence.pdf','application/pdf',100,'clean',${q(clientId)});
      insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status)
        values(${q(version)},${q(document)},${q(admin)},${q(clientId)},1,${q(admin + "/" + version)},'Private fictional evidence.pdf','application/pdf',100,${q(digest)},'clean');
      update public.documents set current_version_id=${q(version)} where id=${q(document)};
    `);
    return version;
  }

  async function prepareInvoice(organisation) {
    const [job, claim] = Array.from({ length: 2 }, randomUUID);
    const version = await pdf();
    await sql(`
      insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)
        values(${q(job)},'Fictional contract','Fictional customer','online','filled',50,50,'AUD','fixed_total','Private lecturer terms');
      insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version)
        values(${q(claim)},${q(job)},${q(lecturer)},${q(randomUUID())},50,50,'AUD','fixed_total','Private lecturer terms',1);
      insert into private.claim_revenue_ledger(claim_id,job_id,organisation_id,lecturer_id,gross_amount,gross_total_amount,platform_percent,
        platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency)
        values(${q(claim)},${q(job)},${q(organisation)},${q(lecturer)},100,100,50,50,50,50,'AUD');
    `);
    const payload = {
      claim_ids: [claim],
      number: "Fictional " + claim,
      issued_on: "2020-02-01",
      due_on: "2020-03-01",
      currency: "AUD",
      total_amount: "100.00",
      document_version_id: version,
      difference_reason: "",
    };
    const requestId = randomUUID();
    return async () =>
      JSON.parse(
        await rpc(
          admin,
          "register_customer_invoice",
          JSON.stringify(payload),
          requestId,
        ),
      );
  }

  const register = await prepareInvoice(company);
  const invoice = (await register()).id;
  assert.equal((await register()).id, invoice);
  const registerForeign = await prepareInvoice(other);
  const foreignInvoice = (await registerForeign()).id;
  await sql(`
    insert into public.course_runs(template_id,organisation_id,published)
    values (${q(template)},${q(company)},true)
  `);
  const list = await listing();
  const accountingListing = list.find(({ id }) => id === accounting.id);
  assert.equal(accountingListing.accounting_events, true);
  assert.equal(accountingListing.deliveries.length, 1);
  assert.equal(
    accountingListing.deliveries[0].event_type,
    "invoice.registered",
  );
  const courseListing = list.find(({ id }) => id === course.id);
  assert.equal("accounting_events" in courseListing, false);
  assert.deepEqual(
    courseListing.deliveries.map(({ event_type }) => event_type),
    ["course.published"],
  );
  assert.doesNotMatch(JSON.stringify(list), /signing_secret|invoice_id/);
  assert.equal(
    await sql(
      `select invoice_id from private.company_course_webhook_deliveries where subscription_id=${q(foreign.id)}`,
    ),
    foreignInvoice,
  );

  const ledger =
    (invoiceId) =>
    async (name, ...args) =>
      JSON.parse(await rpc(admin, name, invoiceId, ...args));
  const paymentDate = "2020-02-08T11:00:00Z";

  async function settleAndReverse(invoiceId) {
    const record = ledger(invoiceId);
    const repeat = async (name, ...inputs) => {
      const args = [...inputs, randomUUID()];
      const result = await record(name, ...args);
      assert.deepEqual(await record(name, ...args), result);
      return result;
    };
    await repeat(
      "record_customer_invoice_payment",
      "100.00",
      paymentDate,
      "Private bank reference",
    );
    const note = await repeat(
      "register_customer_credit_note",
      JSON.stringify({
        reference: "Private credit reference " + invoiceId,
        issued_on: "2020-02-05",
        currency: "AUD",
        amount: "10.00",
        document_version_id: await pdf(),
        issued_and_reviewed: true,
        reason: "Private credit note reason",
      }),
    );
    const application = await repeat(
      "apply_customer_invoice_credit_note",
      note.id,
      "Private credit application",
    );
    const refund = await repeat(
      "record_customer_invoice_refund",
      "10.00",
      paymentDate,
      "Private refund reference",
    );
    const reverseCredit = [
      application.id,
      "Private credit correction",
      randomUUID(),
    ];
    await assert.rejects(
      record("reverse_customer_invoice_credit_note", ...reverseCredit),
      /PT409/,
    );
    await repeat(
      "reverse_customer_invoice_refund",
      refund.id,
      "Private refund reversal",
    );
    const correction = await record(
      "reverse_customer_invoice_credit_note",
      ...reverseCredit,
    );
    assert.deepEqual(
      await record("reverse_customer_invoice_credit_note", ...reverseCredit),
      correction,
    );
  }

  const record = ledger(invoice);
  const paymentArgs = [
    "80.00",
    paymentDate,
    "Private bank reference",
    randomUUID(),
  ];
  const payment = await record(
    "record_customer_invoice_payment",
    ...paymentArgs,
  );
  assert.deepEqual(
    await record("record_customer_invoice_payment", ...paymentArgs),
    payment,
  );
  await record(
    "reverse_customer_invoice_payment",
    payment.id,
    "Private reversal reason",
    randomUUID(),
  );
  await settleAndReverse(invoice);
  await assert.rejects(
    record(
      "record_customer_invoice_payment",
      "1.00",
      paymentDate,
      "Private overpayment",
      randomUUID(),
    ),
    /22023/,
  );
  const extraInvoice = (await (await prepareInvoice(company))()).id;
  await actor(
    admin,
    `
    select public.record_customer_invoice_payment(${q(extraInvoice)},'10.00',${q(paymentDate)},'Private first payment',${q(randomUUID())});
    select public.record_customer_invoice_payment(${q(extraInvoice)},'15.00',${q(paymentDate)},'Private second payment',${q(randomUUID())});
  `,
  );
  assert.equal(
    await sql(`
    select count(distinct event_id) = 2 and count(distinct source_transaction) = 1
    from private.company_course_webhook_deliveries
    where subscription_id = ${q(accounting.id)} and invoice_id = ${q(extraInvoice)} and event_type = 'payment.recorded'
  `),
    "t",
  );

  const service = (statement) => sql("set role service_role; " + statement);
  const lease = async () =>
    JSON.parse(
      await service(
        `select coalesce(public.lease_company_course_webhook(array[${q(company + "/accounts")}]),'null')`,
      ),
    );
  const prepare = async ({ id, token }) =>
    JSON.parse(
      await service(
        `select coalesce(public.prepare_company_course_webhook(${q(id)},${q(token)}),'null')`,
      ),
    );
  const events = [];
  for (let delivery = await lease(); delivery; delivery = await lease()) {
    const prepared = await prepare(delivery);
    assert.equal(prepared.signing_secret, accounting.signing_secret);
    const { event } = prepared;
    assert.deepEqual(Object.keys(event).sort(), [
      "id",
      "invoice_id",
      "occurred_at",
      "type",
      "version",
    ]);
    assert.ok([invoice, extraInvoice].includes(event.invoice_id));
    assert.equal(event.version, 1);
    events.push(event);
    await service(
      `select public.finish_company_course_webhook(${q(delivery.id)},${q(delivery.token)},'delivered')`,
    );
  }
  assert.equal(new Set(events.map(({ id }) => id)).size, events.length);
  assert.deepEqual(
    events
      .filter((event) => event.invoice_id === invoice)
      .map(({ type }) => type)
      .sort(),
    [
      "credit_note.applied",
      "credit_note.reversed",
      "invoice.registered",
      "payment.recorded",
      "payment.recorded",
      "payment.reversed",
      "refund.recorded",
      "refund.reversed",
    ],
  );

  const nextInvoice = await prepareInvoice(company);
  await nextInvoice();
  const suspended = await lease();
  await sql(`update public.profiles set active=false where id=${q(author)}`);
  assert.equal(await prepare(suspended), null);
  assert.equal(
    (await listing()).find(({ id }) => id === accounting.id).active,
    false,
  );
  await rpc(admin, "company_course_webhook_revoke", company, accounting.id);

  const receiver = JSON.parse(
    await subscribe(admin, company, key.id, "signed-accounting"),
  );
  const registerForHttp = await prepareInvoice(company);
  const queueNext = await prepareInvoice(company);
  const httpInvoice = (await registerForHttp()).id;
  await verifyWebhookDeliveryHttp({
    sql,
    destination: company + "/signed-accounting",
    subscription: receiver,
    invoice: httpInvoice,
    eventType: "invoice.registered",
    publishFollowups: async () => {
      await settleAndReverse(httpInvoice);
      return [
        "payment.recorded",
        "credit_note.applied",
        "refund.recorded",
        "refund.reversed",
        "credit_note.reversed",
      ];
    },
    publishNext: queueNext,
    revoke: () =>
      rpc(admin, "company_course_webhook_revoke", company, receiver.id),
    enforcePortalGate: true,
  });
  const rotated = JSON.parse(
    await subscribe(admin, company, key.id, "key-rotation"),
  );
  await (
    await prepareInvoice(company)
  )();
  const pending = JSON.parse(
    await service(
      `select public.lease_company_course_webhook(array[${q(company + "/key-rotation")}])`,
    ),
  );
  await actor(
    admin,
    `
    select public.issue_company_integration_key(${q(company)},'Fictional rotation',now()+interval '7 days',${q(key.id)},${key.version})
  `,
  );
  assert.equal(await prepare(pending), null);
  assert.equal(
    (await listing()).find(({ id }) => id === rotated.id).active,
    false,
  );
  console.log(
    "PASS customer accounting webhook scope, exact ledger retries, signed credit application, refund, both reversals and live revocation",
  );
});
