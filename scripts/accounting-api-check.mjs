/** Canonical real Auth/REST/Storage acceptance for accounting. Fictional
 * invoice PDFs pass the scanner; current permissions gate bytes and snapshots. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { withApiFixture } from "./testing/api.mjs";
import { quoteSql as q } from "./testing/database.mjs";
import { accountingTestPdf } from "./testing/accounting-pdf.mjs";

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
   delete from private.accounting_operations where actor_id in(${users});delete from private.accounting_exports where actor_id in(${users});
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
  const bytes = accountingTestPdf();
  /** Exercise the existing reservation/Storage/scanner gateway with real PDF
   * bytes. A clean metadata stub would not establish this integration. */
  async function upload(who, kind) {
    const form = new FormData();
    form.set(
      "file",
      new File([bytes], "Fictional accounting.pdf", {
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
    assert.equal(response.status, 200);
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
  const first = await checked(
    teacher.client.rpc("create_accounting_export", args),
  );
  assert.equal(first.invoices[0].recorded_total, "100.01");
  assert.equal(first.invoices[0].currency, "AUD");
  assert.equal(first.invoices[0].tax.vat_amount, null);
  assert.deepEqual(
    await checked(teacher.client.rpc("create_accounting_export", args)),
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
    (await checked(owner.client.rpc("accounting_customer_claims"))).some(
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
    await checked(
      owner.client.rpc("register_customer_invoice", registrationArgs),
    )
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
  const paid = await checked(
    owner.client.rpc("record_customer_invoice_payment", paymentArgs),
  );
  assert.deepEqual(
    await checked(
      owner.client.rpc("record_customer_invoice_payment", paymentArgs),
    ),
    paid,
  );
  const exported = await checked(
    customer.client.rpc("create_accounting_export", {
      p_source: "customer",
      p_invoice_ids: [invoice],
      p_request_id: randomUUID(),
    }),
  );
  assert.equal(exported.invoices[0].paid_total, "33.34");
  assert.equal(exported.invoices[0].outstanding_total, "166.69");
  assert.equal(exported.invoices[0].accepted_charge_total, null);
  assert.equal(exported.invoices[0].assignments[0].claim_id, null);
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
    assert.equal(
      (await response.json()).code,
      "42501",
      `Current authority required for ${name}`,
    );
  };
  await denyRetained("accounting_export", { p_id: grossExport.id });
  await denyRetained("create_accounting_export", grossExportArgs);
  await denyRetained("register_customer_invoice", registrationArgs);
  await denyRetained("record_customer_invoice_payment", paymentArgs);
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
