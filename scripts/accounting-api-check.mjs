/** Canonical real Auth/REST/Storage acceptance for accounting. Fictional
 * invoice PDFs pass the scanner; current permissions gate bytes and snapshots. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { withApiFixture } from "./testing/api.mjs";
import { quoteSql as q } from "./testing/database.mjs";
import { accountingTestPdf } from "./testing/accounting-pdf.mjs";
import { documentedRpc } from "./testing/openapi-contract.mjs";
import { accountingPaths } from "../src/features/developer-api/accounting-contract.ts";

await withApiFixture(async ({ actor, checked, sql, defer, service, url }) => {
  const teacher = await actor("accounting-teacher", "lecturer"),
    peer = await actor("accounting-peer", "lecturer"),
    owner = await actor("accounting-owner", "admin"),
    manager = await actor("accounting-manager", "management"),
    customer = await actor("accounting-customer", "client"),
    outsider = await actor("accounting-outsider", "client");
  const users = [
      teacher.id,
      peer.id,
      owner.id,
      manager.id,
      customer.id,
      outsider.id,
    ]
      .map(q)
      .join(","),
    [org, foreignOrg, job, claim, session] = Array.from(
      { length: 5 },
      randomUUID,
    );
  defer(async () => {
    const docs = await checked(
      service
        .from("documents")
        .select("id")
        .in("owner_id", [teacher.id, owner.id]),
    );
    const docIds = docs.map((d) => d.id);
    if (docIds.length) {
      const versions = await checked(
        service
          .from("document_versions")
          .select("object_path")
          .in("document_id", docIds),
      );
      for (const bucket of ["portal-clean", "portal-quarantine"])
        if (versions.length)
          await checked(
            service.storage
              .from(bucket)
              .remove(versions.map((v) => v.object_path)),
          );
    }
    // Guarded canonical disposable fixture only: remove exact immutable UUIDs
    // transactionally without changing trigger definitions or product grants.
    await sql(`begin;set local session_replication_role=replica;
   delete from private.company_course_webhook_deliveries where subscription_id in (
     select subscription.id from private.company_course_webhooks subscription
     join private.company_integration_keys key on key.id=subscription.integration_id
     where key.organisation_id in (${q(org)},${q(foreignOrg)})
   );
   delete from private.company_course_webhooks where integration_id in (
     select id from private.company_integration_keys where organisation_id in (${q(org)},${q(foreignOrg)})
   );
   delete from private.company_integration_keys where organisation_id in (${q(org)},${q(foreignOrg)});
   delete from private.accounting_operations where actor_id in(${users});delete from private.accounting_exports where actor_id in(${users});
   delete from private.accounting_customer_refunds where invoice_id in(select id from private.accounting_customer_invoices where registered_by in(${users}));
   delete from private.accounting_customer_credit_applications where invoice_id in(select id from private.accounting_customer_invoices where registered_by in(${users}));
   delete from private.accounting_customer_credit_notes where invoice_id in(select id from private.accounting_customer_invoices where registered_by in(${users}));
   delete from private.accounting_customer_payments where invoice_id in(select id from private.accounting_customer_invoices where registered_by in(${users}));
   delete from private.accounting_customer_items where invoice_id in(select id from private.accounting_customer_invoices where registered_by in(${users}));
   delete from private.accounting_customer_invoices where registered_by in(${users});
   delete from public.payment_records where invoice_id in(select id from public.invoices where user_id in(${users}));delete from public.invoice_items where invoice_id in(select id from public.invoices where user_id in(${users}));delete from public.invoices where user_id in(${users});
   delete from public.assignment_sessions where claim_id=${q(claim)};delete from public.job_sessions where id=${q(session)};delete from private.claim_revenue_ledger where claim_id=${q(claim)};delete from public.job_claims where id=${q(claim)};delete from public.jobs where id=${q(job)};
   delete from public.client_organisation_memberships where user_id in(${users});delete from public.organisations where id in(${q(org)},${q(foreignOrg)});
   delete from public.document_versions where document_id in(select id from public.documents where owner_id in(${users}));delete from public.documents where owner_id in(${users});delete from public.notifications where user_id in(${users});commit;`);
  });
  await sql(`insert into public.organisations(id,name) values(${q(org)},'Fictional accounting API customer'),(${q(foreignOrg)},'Fictional isolated API customer');insert into public.client_organisation_memberships(user_id,organisation_id) values(${q(customer.id)},${q(org)}),(${q(outsider.id)},${q(foreignOrg)});
  insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms) values(${q(job)},'Fictional accounting API course','Fictional accounting API customer','online','filled',100.01,100.01,'AUD','fixed_total','Fictional immutable agreement');
  insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version) values(${q(claim)},${q(job)},${q(teacher.id)},${q(randomUUID())},100.01,100.01,'AUD','fixed_total','Fictional immutable agreement',1);
  insert into public.job_sessions(id,job_id,starts_at,ends_at) values(${q(session)},${q(job)},'2001-01-01T09:00:00Z','2001-01-01T11:00:00Z');
  insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at) values(${q(session)},${q(claim)},${q(teacher.id)},'2001-01-01T09:00:00Z','2001-01-01T11:00:00Z');
  insert into private.claim_revenue_ledger(claim_id,job_id,organisation_id,lecturer_id,gross_amount,gross_total_amount,platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency) values(${q(claim)},${q(job)},${q(org)},${q(teacher.id)},200.03,200.03,50,100.02,100.01,100.01,'AUD');`);
  const origin = new URL(
    process.env.PORTAL_APP_ORIGIN ??
      process.env.E2E_BASE_URL ??
      "http://127.0.0.1:5173",
  ).origin;
  // Use actual current Auth sessions; tokens remain confined to request headers.
  const headers = async (who) => {
    const { session } = await checked(who.client.auth.getSession());
    return {
      Origin: origin,
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
    };
  };
  /** Assert both published wire shapes around a real authenticated RPC. */
  async function documented(who, name, args = {}) {
    const { post } = accountingPaths[`/rest/v1/rpc/${name}`];
    const json = "application/json";
    z.fromJSONSchema(post.requestBody.content[json].schema).parse(args);
    const { status, data, error } = await who.client.rpc(name, args);
    assert.equal(
      status,
      200,
      `Documented success for ${name}: ${error?.code ?? ""}`,
    );
    z.fromJSONSchema(post.responses["200"].content[json].schema).parse(data);
    return data;
  }
  const bytes = accountingTestPdf();
  /** Exercise the existing reservation/Storage/scanner gateway with real PDF
   * bytes. A clean metadata stub would not establish this integration. */
  async function upload(who, kind, pdf = bytes) {
    const form = new FormData();
    form.set(
      "file",
      new File([pdf], "Fictional accounting.pdf", {
        type: "application/pdf",
      }),
    );
    form.set("scope", "personal");
    form.set("kind", kind);
    form.set("client_id", randomUUID());
    const response = await fetch(`${url}/functions/v1/files`, {
      method: "POST",
      headers: await headers(who),
      body: form,
      signal: AbortSignal.timeout(90000),
    });
    if (response.status !== 200) {
      // Keep raw response bodies and private document identifiers out of CI logs.
      const body = await response.json().catch(() => null);
      const knownErrors = ["scanner_unavailable", "upload_failed", "deletion_unavailable"];
      const reason = knownErrors.includes(body?.error)
        ? body.error
        : "unrecognized gateway response";
      assert.equal(response.status, 200, `Accounting PDF upload: ${reason}`);
    }
    const body = await response.json();
    assert.equal(body.document.status, "clean");
    return body.document;
  }
  // Downloads recheck current document access instead of reusing signed URLs.
  const download = async (who, doc, retainedHeaders) =>
    fetch(`${url}/functions/v1/files`, {
      method: "POST",
      headers: {
        ...(retainedHeaders ?? (await headers(who))),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "download",
        id: doc.id,
        version_id: doc.current_version_id,
      }),
    });
  const lecturerDoc = await upload(teacher, "invoice");
  const lecturerInvoice = await checked(
    teacher.client.rpc("submit_invoice", {
      p_number: "=FICTIONAL-API",
      p_claim_ids: [claim],
      p_document_version_id: lecturerDoc.current_version_id,
      p_issued_on: "2001-01-01",
      p_due_on: "2001-02-01",
      p_client_id: randomUUID(),
    }),
  );
  const args = {
    p_source: "own",
    p_invoice_ids: [lecturerInvoice],
    p_request_id: randomUUID(),
  };
  const first = await documented(teacher, "create_accounting_export", args);
  assert.equal(first.invoices[0].recorded_total, "100.01");
  assert.equal(first.invoices[0].currency, "AUD");
  assert.equal(first.invoices[0].tax.vat_amount, null);
  assert.deepEqual(
    await checked(teacher.client.rpc("create_accounting_export", args)),
    first,
  );
  assert.deepEqual(
    await documented(teacher, "accounting_export", { p_id: first.id }),
    first,
  );
  assert.equal(
    (await peer.client.rpc("accounting_export", { p_id: first.id })).error
      ?.code,
    "42501",
  );
  const customerDoc = await upload(owner, "material");
  const personalDoc = await upload(owner, "material");
  const payload = {
    claim_ids: [claim],
    number: "FICTIONAL-CUSTOMER-API",
    issued_on: "2001-01-01",
    due_on: "2001-02-01",
    currency: "AUD",
    total_amount: "200.03",
    document_version_id: customerDoc.current_version_id,
    difference_reason: "",
  };
  const registrationArgs = {
    p_payload: payload,
    p_request_id: randomUUID(),
  };
  /** Compare complete owned accounting evidence around rejected requests,
   * including original claims and exact document/version metadata. Auth
   * state is deliberately separate; only the real RPCs decide authority. */
  const evidence = () =>
    sql(`select jsonb_build_object(
      'customer_invoices',(select jsonb_agg(to_jsonb(i)order by i.id)from private.accounting_customer_invoices i where registered_by in(${users})),
      'customer_items',(select jsonb_agg(to_jsonb(x)order by x.claim_id)from private.accounting_customer_items x join private.accounting_customer_invoices i on i.id=x.invoice_id where i.registered_by in(${users})),
      'customer_payments',(select jsonb_agg(to_jsonb(p)order by p.id)from private.accounting_customer_payments p join private.accounting_customer_invoices i on i.id=p.invoice_id where i.registered_by in(${users})),
      'exports',(select jsonb_agg(to_jsonb(e)order by e.id)from private.accounting_exports e where actor_id in(${users})),
      'operations',(select jsonb_agg(to_jsonb(o)order by o.actor_id,o.request_id)from private.accounting_operations o where actor_id in(${users})),
      'documents',(select jsonb_agg(to_jsonb(d)order by d.id)from public.documents d where owner_id in(${users})),
      'versions',(select jsonb_agg(to_jsonb(v)order by v.id)from public.document_versions v join public.documents d on d.id=v.document_id where d.owner_id in(${users})),
      'claim',(select to_jsonb(c)from public.job_claims c where id=${q(claim)}),
      'revenue',(select to_jsonb(l)from private.claim_revenue_ledger l where claim_id=${q(claim)}),
      'lecturer_invoice',(select to_jsonb(i)from public.invoices i where id=${q(lecturerInvoice)}),
      'audit',(select jsonb_agg(to_jsonb(a)order by a.id)from public.audit_events a where actor_id in(${users})and action like 'accounting.%'))`);

  // Live database roles, rather than Auth assurance metadata, distinguish
  // customer gross authority from ordinary finance and peer access.
  const beforeDenied = await evidence();
  assert.ok(
    (await documented(owner, "accounting_customer_claims")).some(
      (row) => row.claim_id === claim,
    ),
  );
  assert.equal(
    (await manager.client.rpc("accounting_customer_claims")).error?.code,
    "42501",
  );
  assert.equal(
    (await peer.client.rpc("accounting_invoices", { p_source: "lecturer_all" }))
      .error?.code,
    "42501",
  );
  assert.equal(
    (await peer.client.rpc("register_customer_invoice", registrationArgs)).error
      ?.code,
    "42501",
  );
  assert.equal(
    (
      await peer.client.rpc("create_accounting_export", {
        p_source: "lecturer_all",
        p_invoice_ids: [lecturerInvoice],
        p_request_id: randomUUID(),
      })
    ).error?.code,
    "42501",
  );
  assert.equal(await evidence(), beforeDenied);
  const transport = (who, name, body, status, code) =>
    documentedRpc(who.client, name, body, status, code);
  const issueKey = (company) =>
    checked(
      owner.client.rpc("issue_company_integration_key", {
        p_organisation_id: company,
        p_label: "Fictional accounting event key",
        p_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        p_rotate_id: null,
        p_expected_version: null,
      }),
      "Issue fictional webhook integration key",
    );
  const key = await issueKey(org);
  const foreignKey = await issueKey(foreignOrg);
  const webhook = {
    p_organisation: org,
    p_integration: key.id,
    p_destination: "fictional-accounting-events",
  };
  const subscribe = (who, args, status, code) =>
    transport(who, "company_accounting_webhook_subscribe", args, status, code);
  await subscribe(manager, webhook, 403, "42501");
  await subscribe(customer, webhook, 403, "42501");
  await subscribe(
    owner,
    { ...webhook, p_integration: foreignKey.id },
    403,
    "42501",
  );
  await subscribe(
    owner,
    { ...webhook, p_destination: "not an alias" },
    400,
    "22023",
  );
  const subscription = await subscribe(owner, webhook);
  await subscribe(owner, webhook, 409, "23505");
  const foreignSubscription = await subscribe(owner, {
    ...webhook,
    p_organisation: foreignOrg,
    p_integration: foreignKey.id,
  });
  const courseSubscription = await transport(
    owner,
    "company_course_webhook_subscribe",
    {
      ...webhook,
      p_destination: "fictional-course-events",
      p_premium_events: false,
    },
  );
  const personalBefore = await download(owner, personalDoc);
  assert.equal(personalBefore.status, 200);
  assert.deepEqual(Buffer.from(await personalBefore.arrayBuffer()), bytes);

  assert.equal((await download(manager, customerDoc)).status, 403);
  assert.equal(
    (
      await manager.client.rpc("register_customer_invoice", {
        p_payload: payload,
        p_request_id: randomUUID(),
      })
    ).error?.code,
    "42501",
  );
  const invoice = (
    await documented(owner, "register_customer_invoice", registrationArgs)
  ).id;
  assert.equal((await download(manager, customerDoc)).status, 403);
  const actual = await download(customer, customerDoc);
  assert.equal(actual.status, 200);
  assert.equal(
    createHash("sha256")
      .update(Buffer.from(await actual.arrayBuffer()))
      .digest("hex"),
    createHash("sha256").update(bytes).digest("hex"),
  );
  const paymentArgs = {
    p_invoice_id: invoice,
    p_amount: "33.34",
    p_paid_at: "2001-01-02T12:00:00Z",
    p_reference: "Fictional recorded payment",
    p_request_id: randomUUID(),
  };
  const paid = await documented(
    owner,
    "record_customer_invoice_payment",
    paymentArgs,
  );
  assert.deepEqual(
    await checked(
      owner.client.rpc("record_customer_invoice_payment", paymentArgs),
    ),
    paid,
  );
  const exported = await documented(customer, "create_accounting_export", {
    p_source: "customer",
    p_invoice_ids: [invoice],
    p_request_id: randomUUID(),
  });
  assert.equal(exported.invoices[0].paid_total, "33.34");
  assert.equal(exported.invoices[0].outstanding_total, "166.69");
  assert.equal(exported.invoices[0].accepted_charge_total, null);
  assert.equal(exported.invoices[0].assignments[0].claim_id, null);
  const reversalArgs = {
    p_invoice_id: invoice,
    p_payment_id: paid.id,
    p_reason: "Fictional duplicate receipt",
    p_request_id: randomUUID(),
  };
  const reversal = await documented(
    owner,
    "reverse_customer_invoice_payment",
    reversalArgs,
  );
  assert.notEqual(reversal.id, paid.id);
  assert.deepEqual(
    await documented(owner, "reverse_customer_invoice_payment", reversalArgs),
    reversal,
  );
  const customerPage = await documented(customer, "accounting_invoices", {
    p_source: "customer",
  });
  const reversedInvoice = customerPage.items.find(
    (item) => item.id === invoice,
  );
  assert.equal(reversedInvoice.paid_total, "0.00");
  assert.equal(reversedInvoice.status, "registered");
  assert.equal(
    reversedInvoice.payments.find((entry) => entry.id === reversal.id)
      .reverses_id,
    paid.id,
  );
  assert.deepEqual(
    await documented(customer, "accounting_export", { p_id: exported.id }),
    exported,
  );

  const invoiceArgument = { p_invoice_id: invoice };
  const creditDoc = await upload(
    owner,
    "material",
    Buffer.concat([bytes, Buffer.from("% Fictional distinct credit note\n")]),
  );
  const creditArgs = {
    ...invoiceArgument,
    p_payload: {
      reference: "Fictional-API-CREDIT",
      issued_on: "2001-01-02",
      currency: "AUD",
      amount: "70.03",
      reason: "Fictional credit for a reviewed charge",
      document_version_id: creditDoc.current_version_id,
      issued_and_reviewed: true,
    },
    p_request_id: randomUUID(),
  };
  await transport(
    manager,
    "register_customer_credit_note",
    creditArgs,
    403,
    "42501",
  );
  await transport(
    owner,
    "register_customer_credit_note",
    {
      ...creditArgs,
      p_payload: { ...creditArgs.p_payload, currency: "EUR" },
    },
    400,
    "22023",
  );
  const credit = await transport(
    owner,
    "register_customer_credit_note",
    creditArgs,
  );
  const applicationArgs = {
    ...invoiceArgument,
    p_credit_note_id: credit.id,
    p_reason: "Fictional credit applied to original invoice",
    p_request_id: randomUUID(),
  };
  const application = await transport(
    owner,
    "apply_customer_invoice_credit_note",
    applicationArgs,
  );
  assert.deepEqual(
    await transport(
      owner,
      "apply_customer_invoice_credit_note",
      applicationArgs,
    ),
    application,
  );
  await transport(
    owner,
    "apply_customer_invoice_credit_note",
    {
      ...applicationArgs,
      p_request_id: randomUUID(),
    },
    409,
    "PT409",
  );
  const receipt = await transport(owner, "record_customer_invoice_payment", {
    ...paymentArgs,
    p_amount: "160.00",
    p_reference: "Fictional new receipt",
    p_request_id: randomUUID(),
  });
  const now = new Date();
  const refundArgs = {
    ...invoiceArgument,
    p_amount: "30.00",
    p_refunded_at: now.toISOString(),
    p_reference: "=Fictional reviewed transfer",
    p_request_id: randomUUID(),
  };
  await transport(
    customer,
    "record_customer_invoice_refund",
    refundArgs,
    403,
    "42501",
  );
  await transport(
    owner,
    "record_customer_invoice_refund",
    {
      ...refundArgs,
      p_amount: "30.01",
    },
    409,
    "PT409",
  );
  const refund = await transport(
    owner,
    "record_customer_invoice_refund",
    refundArgs,
  );
  assert.deepEqual(
    await transport(owner, "record_customer_invoice_refund", refundArgs),
    refund,
  );
  const customerSettlement = await transport(
    customer,
    "accounting_customer_settlement",
    invoiceArgument,
  );
  assert.equal(customerSettlement.net_total, "130.00");
  assert.equal(customerSettlement.refunded_total, "30.00");
  assert.equal(customerSettlement.refunds, null);
  assert.equal(customerSettlement.credit_applications, null);
  await transport(
    outsider,
    "accounting_customer_settlement",
    invoiceArgument,
    403,
    "42501",
  );
  const reverseCredit = {
    ...invoiceArgument,
    p_application_id: application.id,
    p_reason: "Fictional correction of the credit application",
    p_request_id: randomUUID(),
  };
  await transport(
    owner,
    "reverse_customer_invoice_credit_note",
    reverseCredit,
    409,
    "PT409",
  );
  await transport(
    owner,
    "reverse_customer_invoice_payment",
    {
      ...reversalArgs,
      p_payment_id: receipt.id,
      p_request_id: randomUUID(),
    },
    409,
    "PT409",
  );
  const refundReversal = await transport(
    owner,
    "reverse_customer_invoice_refund",
    {
      ...invoiceArgument,
      p_refund_id: refund.id,
      p_reason: "Fictional correction of the refund record",
      p_request_id: randomUUID(),
    },
  );
  const creditReversal = await transport(
    owner,
    "reverse_customer_invoice_credit_note",
    reverseCredit,
  );
  const date = (days) =>
    new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const journalDateRange = { p_from: date(-1), p_to: date(1) };
  const journal = await transport(
    owner,
    "accounting_settlement_journal",
    journalDateRange,
  );
  for (const [entry, original, amount] of [
    [application, null, "70.03"],
    [creditReversal, application.id, "70.03"],
    [refund, null, "30.00"],
    [refundReversal, refund.id, "30.00"],
  ]) {
    const row = journal.items.find(({ id }) => id === entry.id);
    assert.ok(row, "Expected an exact settlement journal entry");
    assert.equal(row.reverses_id, original);
    assert.equal(row.amount, amount);
    assert.equal(row.currency, "AUD");
  }
  const netJournal = await transport(
    manager,
    "accounting_settlement_journal",
    journalDateRange,
  );
  assert.deepEqual(journal.scopes, ["customer", "lecturer"]);
  assert.deepEqual(netJournal.scopes, ["lecturer"]);
  assert.ok(
    netJournal.items.every(({ kind }) => kind === "lecturer_repayment"),
  );
  for (const actor of [customer, outsider, teacher]) {
    await transport(
      actor,
      "accounting_settlement_journal",
      journalDateRange,
      403,
      "42501",
    );
  }
  await transport(
    owner,
    "accounting_settlement_journal",
    {
      p_from: "2001-01-01",
      p_to: date(1),
    },
    400,
    "22023",
  );
  await transport(
    owner,
    "accounting_settlement_journal",
    {
      p_from: "not-a-date",
      p_to: journalDateRange.p_to,
    },
    400,
    "22007",
  );
  await transport(
    owner,
    "accounting_settlement_journal",
    {
      p_from: journalDateRange.p_from,
    },
    404,
    "PGRST202",
  );
  const legacySnapshot = await documented(customer, "accounting_export", {
    p_id: exported.id,
  });
  assert.deepEqual(legacySnapshot, exported);
  const queued = JSON.parse(
    await sql(`select coalesce(jsonb_agg(
    jsonb_build_object('subscription',subscription_id,'id',event_id,'type',event_type,'invoice',invoice_id)
    order by event_type,event_id),'[]') from private.company_course_webhook_deliveries
    where subscription_id in (${q(subscription.id)},${q(foreignSubscription.id)},${q(courseSubscription.id)})`),
  );
  assert.deepEqual(
    queued.map(({ type }) => type),
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
  assert.equal(new Set(queued.map(({ id }) => id)).size, queued.length);
  assert.ok(
    queued.every(
      (row) => row.subscription === subscription.id && row.invoice === invoice,
    ),
  );
  for (const suffix of ["a", "b", "c"]) {
    await transport(owner, "company_course_webhook_subscribe", {
      ...webhook,
      p_destination: `fictional-course-${suffix}`,
      p_premium_events: false,
    });
  }
  await subscribe(
    owner,
    { ...webhook, p_destination: "fictional-over-budget" },
    429,
    "PT429",
  );
  assert.equal(
    (
      await outsider.client.rpc("create_accounting_export", {
        p_source: "customer",
        p_invoice_ids: [invoice],
        p_request_id: randomUUID(),
      })
    ).error?.code,
    "42501",
  );
  await checked(
    service
      .from("client_organisation_memberships")
      .update({ removed_at: new Date().toISOString() })
      .eq("user_id", customer.id),
  );
  assert.equal(
    (await customer.client.rpc("accounting_export", { p_id: exported.id }))
      .error?.code,
    "42501",
  );
  assert.equal((await download(customer, customerDoc)).status, 403);

  const grossExportArgs = {
    p_source: "customer",
    p_invoice_ids: [invoice],
    p_request_id: randomUUID(),
  };
  const grossExport = await checked(
    owner.client.rpc("create_accounting_export", grossExportArgs),
  );
  assert.equal(grossExport.invoices[0].accepted_charge_total, "200.03");
  assert.equal(grossExport.invoices[0].assignments[0].claim_id, claim);
  assert.equal(
    await sql(
      `select requires_gross from private.accounting_exports where id=${q(grossExport.id)}`,
    ),
    "t",
  );

  // Retain the exact previously authorised native password-authenticated bearer. Neither a
  // refresh nor fabricated JWT claims participate in the post-downgrade calls.
  const retainedOwnerHeaders = await headers(owner);
  /** Raw HTTP requests make token retention explicit; only fixed endpoint
   * names and fictional arguments are used, and tokens are never logged. */
  const retainedRpc = (name, args) =>
    fetch(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        ...retainedOwnerHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(30000),
    });
  const grossBefore = await retainedRpc("accounting_export", {
    p_id: grossExport.id,
  });
  assert.equal(grossBefore.status, 200);
  assert.deepEqual(await grossBefore.json(), grossExport);
  const pdfBefore = await download(owner, customerDoc, retainedOwnerHeaders);
  assert.equal(pdfBefore.status, 200);
  assert.deepEqual(Buffer.from(await pdfBefore.arrayBuffer()), bytes);

  // The public role API denies peer reassignment. The owned fixture models
  // a trusted role update while HTTP keeps exactly the same token.
  await sql(`begin;
    select 1 from public.profiles where id=${q(owner.id)} for update;
    delete from public.user_roles where user_id=${q(owner.id)} and role='admin';
    insert into public.user_roles(user_id,role) values(${q(owner.id)},'management');
    commit;`);
  const beforeRevoked = await evidence();
  /** A genuine authorization failure must come from PostgREST/SQL, not token
   * expiry, network failure or invalid parameters. Positive reads follow below. */
  const denyRetained = async (name, args) => {
    const response = await retainedRpc(name, args);
    assert.equal(response.status, 403, `Retained token denied for ${name}`);
    const body = await response.json();
    const definition =
      accountingPaths[`/rest/v1/rpc/${name}`].post.responses["403"];
    z.fromJSONSchema(definition.content["application/json"].schema).parse(body);
    assert.equal(body.code, "42501", `Current authority required for ${name}`);
  };
  await denyRetained("accounting_export", { p_id: grossExport.id });
  await denyRetained("create_accounting_export", grossExportArgs);
  await denyRetained("register_customer_invoice", registrationArgs);
  await denyRetained("record_customer_invoice_payment", paymentArgs);
  const downgradedJournal = await retainedRpc(
    "accounting_settlement_journal",
    journalDateRange,
  );
  assert.equal(downgradedJournal.status, 200);
  const downgraded = await downgradedJournal.json();
  assert.deepEqual(downgraded.scopes, ["lecturer"]);
  assert.ok(
    downgraded.items.every(({ kind }) => kind === "lecturer_repayment"),
  );
  const downgradedWebhook = await retainedRpc(
    "company_accounting_webhook_subscribe",
    webhook,
  );
  assert.equal(downgradedWebhook.status, 403);
  assert.equal((await downgradedWebhook.json()).code, "42501");
  assert.equal(
    (await download(owner, customerDoc, retainedOwnerHeaders)).status,
    403,
    "The original uploader's retained password-authenticated token cannot read its dedicated customer PDF after gross-role loss",
  );
  for (const [table, id] of [
    ["documents", customerDoc.id],
    ["document_versions", customerDoc.current_version_id],
  ]) {
    const response = await fetch(
      `${url}/rest/v1/${table}?select=id&id=eq.${id}`,
      { headers: retainedOwnerHeaders, signal: AbortSignal.timeout(30000) },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(
      await response.json(),
      [],
      "The dedicated customer document/version metadata must also be redacted",
    );
  }
  assert.equal(
    await evidence(),
    beforeRevoked,
    "Denied retained-token reads and receipt replays must not change accounting evidence",
  );
  const remaining = await retainedRpc("accounting_access", {});
  assert.equal(remaining.status, 200);
  const access = await remaining.json();
  z.fromJSONSchema(
    accountingPaths["/rest/v1/rpc/accounting_access"].post.responses["200"]
      .content["application/json"].schema,
  ).parse(access);
  assert.equal(access.can_manage_customer_invoices, false);
  assert.equal(access.can_export_all_lecturers, true);
  const netRead = await retainedRpc("accounting_invoices", {
    p_source: "lecturer_all",
  });
  assert.equal(netRead.status, 200);
  assert.ok(
    (await netRead.json()).items.some((item) => item.id === lecturerInvoice),
    "The same retained token keeps unrelated net-finance read access",
  );
  const personalAfter = await download(
    owner,
    personalDoc,
    retainedOwnerHeaders,
  );
  assert.equal(personalAfter.status, 200);
  assert.deepEqual(
    Buffer.from(await personalAfter.arrayBuffer()),
    bytes,
    "The same retained token still authorizes the actor's ordinary personal PDF",
  );
  console.log(
    "PASS actual Auth/REST, current-role read/write denial without side effects, scanned PDF bytes, original-currency snapshots/retry/foreign isolation, current membership and retained-token gross-role revocation with preserved net-finance/personal access.",
  );
});
