/** Canonical real Auth/MFA/REST/Storage acceptance for accounting. Fictional
 * invoice PDFs pass the scanner; current permissions gate bytes and snapshots. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { withApiFixture } from "./testing/api.mjs";
import { quoteSql as q } from "./testing/database.mjs";
import { accountingTestPdf } from "./testing/accounting-pdf.mjs";

await withApiFixture(
  async ({ actor, mfa, checked, sql, defer, service, url }) => {
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
      [org, foreignOrg, job, claim] = Array.from({ length: 4 }, randomUUID);
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
   delete from private.claim_revenue_ledger where claim_id=${q(claim)};delete from public.job_claims where id=${q(claim)};delete from public.jobs where id=${q(job)};
   delete from public.client_organisation_memberships where user_id in(${users});delete from public.organisations where id in(${q(org)},${q(foreignOrg)});
   delete from public.document_versions where document_id in(select id from public.documents where owner_id in(${users}));delete from public.documents where owner_id in(${users});delete from public.notifications where user_id in(${users});commit;`);
    });
    await sql(`insert into public.organisations(id,name) values(${q(org)},'Fictional accounting API customer'),(${q(foreignOrg)},'Fictional isolated API customer');insert into public.client_organisation_memberships(user_id,organisation_id) values(${q(customer.id)},${q(org)}),(${q(outsider.id)},${q(foreignOrg)});
  insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms) values(${q(job)},'Fictional accounting API course','Fictional accounting API customer','online','filled',100.01,100.01,'AUD','fixed_total','Fictional immutable agreement');
  insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version) values(${q(claim)},${q(job)},${q(teacher.id)},${q(randomUUID())},100.01,100.01,'AUD','fixed_total','Fictional immutable agreement',1);
  insert into private.claim_revenue_ledger(claim_id,job_id,organisation_id,lecturer_id,gross_amount,gross_total_amount,platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency) values(${q(claim)},${q(job)},${q(org)},${q(teacher.id)},200.03,200.03,50,100.02,100.01,100.01,'AUD');`);
    await mfa(owner.client);
    await mfa(manager.client);
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
    const download = async (who, doc) =>
      fetch(`${url}/functions/v1/files`, {
        method: "POST",
        headers: {
          ...(await headers(who)),
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
    assert.equal((await download(manager, customerDoc)).status, 403);
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
        owner.client.rpc("register_customer_invoice", {
          p_payload: payload,
          p_request_id: randomUUID(),
        }),
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
    console.log(
      "PASS actual Auth/MFA/REST, scanned Storage PDF bytes, lecturer original-currency snapshots/retry/foreign denial, private external customer registry, finance/client isolation, payment totals and membership-revoked export/download denial.",
    );
  },
);
