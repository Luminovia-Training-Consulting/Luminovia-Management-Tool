/**
 * Real Auth/HTTP checks for executed contract PDFs, earnings, invoices and payments.
 * Separate fictional identities verify actual API results and denied access; responses are not browser mocks.
 */
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
process.loadEnvFile(".env.test.local");
const url = process.env.SUPABASE_URL;
assert.ok(
  url && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
  "Commercial checks only permit loopback projects.",
);
const origin = new URL(
  process.env.PORTAL_APP_ORIGIN ??
    process.env.E2E_BASE_URL ??
    "http://127.0.0.1:5173",
).origin;
/** Creates a separate SDK client without persistent sessions or automatic session refresh. */
const make = (key) =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const service = make(process.env.SUPABASE_SERVICE_ROLE_KEY),
  users = [],
  clients = [],
  jobs = [];
const suffix = randomUUID();
/** Requires actual SDK success before returning the response data. */
async function checked(request, label) {
  const { data, error } = await request;
  assert.equal(error, null, `${label}: ${error?.message}`);
  return data;
}
/** Creates separate fictional accounts and signs them in through Auth; their IDs belong only to the fixture. */
async function fixture(name, role) {
  const email = `commercial-${name}-${suffix}@example.invalid`;
  const auth = await checked(
    service.auth.admin.createUser({
      email,
      password: process.env.E2E_PASSWORD,
      email_confirm: true,
    }),
    "Create temporary commercial fixture",
  );
  users.push(auth.user.id);
  await checked(
    service.from("user_roles").insert({ user_id: auth.user.id, role }),
    "Set known fixture role",
  );
  await checked(
    service
      .from("profiles")
      .update({ display_name: `Commercial QA ${name}` })
      .eq("id", auth.user.id),
    "Set fictional name",
  );
  const client = make(process.env.SUPABASE_ANON_KEY);
  clients.push(client);
  await checked(
    client.auth.signInWithPassword({
      email,
      password: process.env.E2E_PASSWORD,
    }),
    "Actual Auth sign-in",
  );
  return { client, id: auth.user.id };
}
/** Computes the current six-digit TOTP from the fictional MFA secret; never log the code or secret. */
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replace(/=+$/, "").toUpperCase()]
    .map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(
    bits.match(/.{8}/g).map((byte) => Number.parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return (
    (digest.readUInt32BE(digest[digest.length - 1] & 15) & 0x7fffffff) %
    1_000_000
  )
    .toString()
    .padStart(6, "0");
}
/** Creates synthetic PDF bytes for the real file-validation path without personal source documents. */
function pdf(label) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 9 Tf 10 50 Td (${label}) Tj ET`;
  objects[3] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}
/** Reads the test actor's current session token for actual authenticated gateway requests. */
async function headers(actor) {
  const data = await checked(
    actor.client.auth.getSession(),
    "Read local session",
  );
  return {
    Origin: origin,
    apikey: process.env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${data.session.access_token}`,
  };
}
/** Sends real fixture bytes through the authenticated file endpoint; scanning and release remain server responsibilities. */
async function upload(actor, bytes, kind, owner, replace) {
  const form = new FormData();
  form.set(
    "file",
    new File([bytes], `${kind}.pdf`, { type: "application/pdf" }),
  );
  form.set("scope", "personal");
  form.set("kind", kind);
  form.set("client_id", randomUUID());
  if (owner) form.set("owner_id", owner);
  if (replace) form.set("replace_id", replace);
  const response = await fetch(`${url}/functions/v1/files`, {
    method: "POST",
    headers: await headers(actor),
    body: form,
    signal: AbortSignal.timeout(90000),
  });
  const body = await response.json();
  assert.equal(
    response.status,
    200,
    `Actual scanned ${kind} upload: ${body.error ?? "unexpected response"}`,
  );
  assert.equal(body.document.status, "clean");
  return body.document;
}
/** Requests the authorised bytes for this identity and exact document version through the gateway. */
async function download(actor, id, versionId) {
  return fetch(`${url}/functions/v1/files`, {
    method: "POST",
    headers: { ...(await headers(actor)), "Content-Type": "application/json" },
    body: JSON.stringify({ action: "download", id, version_id: versionId }),
  });
}
/** Creates a fictional job with controlled sessions and terms for the following assertions. */
async function job(admin, day, fee) {
  const date = new Date(Date.now() + (90 + day) * 86400000);
  date.setUTCHours(8, 0, 0, 0);
  const data = await checked(
    admin.client.rpc("create_job", {
      p_payload: {
        title: `Fictional tracked assignment ${suffix} ${day}`,
        customer_name: "Fictional billing customer",
        description: "Local QA only",
        delivery_type: "online",
        location: "Online",
        time_zone: "Europe/Berlin",
        status: "published",
        amount: fee,
        total_amount: fee,
        currency: "EUR",
        rate_unit: "fixed_total",
        terms: "Immutable accepted fee",
        requires_contract: true,
        sessions: [
          {
            starts_at: date.toISOString(),
            ends_at: new Date(+date + 3600000).toISOString(),
          },
        ],
        topic_ids: [],
      },
    }),
    "Create actual commercial job",
  );
  jobs.push(data);
  return data;
}
try {
  const a = await fixture("lecturer", "lecturer"),
    b = await fixture("other", "senior_lecturer"),
    admin = await fixture("manager", "admin");
  assert.ok(
    (await admin.client.rpc("contract_records", { p_all: true })).error,
  );
  const factor = await checked(
    admin.client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Commercial QA",
    }),
    "Enroll real management TOTP",
  );
  await checked(
    admin.client.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: totp(factor.totp.secret),
    }),
    "Verify real management TOTP",
  );
  const original = pdf("Fictional externally executed contract - QA only.");
  const contractDoc = await upload(admin, original, "contract", a.id);
  const version = await checked(
    a.client
      .from("document_versions")
      .select("*")
      .eq("id", contractDoc.current_version_id)
      .single(),
    "Read scanned contract version",
  );
  assert.match(version.scanner_version, /^ClamAV /);
  assert.equal(
    version.sha256,
    createHash("sha256").update(original).digest("hex"),
  );
  const effective = new Date(Date.now() - 86400000).toISOString(),
    expires = new Date(Date.now() + 365 * 86400000).toISOString(),
    contractKey = randomUUID();
  const args = {
    p_user_id: a.id,
    p_title: "Executed fictional master",
    p_document_version_id: version.id,
    p_effective_from: effective,
    p_expires_at: expires,
    p_kind: "master",
    p_parent_id: null,
    p_client_id: contractKey,
  };
  const contract = await checked(
    admin.client.rpc("register_executed_contract", args),
    "Register actual scanned executed agreement",
  );
  assert.equal(
    await checked(
      admin.client.rpc("register_executed_contract", args),
      "Retry actual agreement registration",
    ),
    contract,
  );
  const receiptKey = randomUUID();
  const receipt = await checked(
    a.client.rpc("acknowledge_contract", {
      p_contract_id: contract,
      p_sha256: version.sha256,
      p_client_id: receiptKey,
    }),
    "Receipt acknowledgement only",
  );
  assert.equal(
    await checked(
      a.client.rpc("acknowledge_contract", {
        p_contract_id: contract,
        p_sha256: version.sha256,
        p_client_id: receiptKey,
      }),
      "Receipt retry",
    ),
    receipt,
  );
  assert.ok(
    (
      await b.client.rpc("acknowledge_contract", {
        p_contract_id: contract,
        p_sha256: version.sha256,
        p_client_id: randomUUID(),
      })
    ).error,
  );
  assert.deepEqual(
    await checked(
      b.client.rpc("contract_records"),
      "Other senior personal contracts",
    ),
    [],
  );
  assert.equal((await download(b, contractDoc.id, version.id)).status, 403);
  const claims = [];
  for (const [day, fee] of [
    [1, 100],
    [2, 200],
  ]) {
    const id = await job(admin, day, fee);
    const result = await checked(
      a.client.rpc("claim_job", {
        p_job_id: id,
        p_idempotency_key: randomUUID(),
        p_terms_version: 1,
      }),
      "Actual contract-required claim",
    );
    assert.equal(result.status, "confirmed");
    claims.push(result.claim_id);
  }
  const invoiceBytes = pdf(
    "Fictional compensation statement - no tax calculation.",
  );
  const invoiceDoc = await upload(a, invoiceBytes, "invoice");
  const invoiceVersion = invoiceDoc.current_version_id;
  const issued = new Date().toISOString().slice(0, 10),
    due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    invoiceKey = randomUUID();
  const invoiceArgs = {
    p_number: `QA-${suffix}`,
    p_claim_ids: claims,
    p_document_version_id: invoiceVersion,
    p_issued_on: issued,
    p_due_on: due,
    p_client_id: invoiceKey,
  };
  const invoice = await checked(
    a.client.rpc("submit_invoice", invoiceArgs),
    "Submit actual own compensation invoice",
  );
  assert.equal(
    await checked(
      a.client.rpc("submit_invoice", invoiceArgs),
      "Retry invoice submission",
    ),
    invoice,
  );
  let record = (
    await checked(a.client.rpc("invoice_records"), "Read own invoice")
  )[0];
  assert.equal(Number(record.total_amount), 300);
  assert.equal(record.currency, "EUR");
  assert.deepEqual(
    await checked(
      b.client.rpc("invoice_records"),
      "Other senior private invoices",
    ),
    [],
  );
  assert.ok((await b.client.rpc("finance_earnings", { p_all: true })).error);
  assert.equal((await download(b, invoiceDoc.id, invoiceVersion)).status, 403);
  await checked(
    admin.client.rpc("review_invoice", {
      p_invoice_id: invoice,
      p_status: "approved",
      p_note: "Fictional local QA review",
    }),
    "Approve with real MFA",
  );
  const paidAt = new Date(Date.now() - 1000).toISOString(),
    paymentKey = randomUUID();
  const paymentArgs = {
    p_invoice_id: invoice,
    p_amount: 100,
    p_paid_at: paidAt,
    p_reference: "Fictional payment tracking reference",
    p_client_id: paymentKey,
  };
  const firstPayment = await checked(
    admin.client.rpc("record_invoice_payment", paymentArgs),
    "Record partial tracking payment",
  );
  assert.equal(
    await checked(
      admin.client.rpc("record_invoice_payment", paymentArgs),
      "Retry tracking payment",
    ),
    firstPayment,
  );
  assert.ok(
    (
      await admin.client.rpc("record_invoice_payment", {
        ...paymentArgs,
        p_amount: 201,
        p_client_id: randomUUID(),
      })
    ).error,
  );
  await checked(
    admin.client.rpc("record_invoice_payment", {
      ...paymentArgs,
      p_amount: 200,
      p_client_id: randomUUID(),
    }),
    "Record final tracking payment",
  );
  record = (
    await checked(a.client.rpc("invoice_records"), "Read paid invoice")
  )[0];
  assert.equal(record.status, "paid");
  assert.equal(Number(record.paid_amount), 300);
  assert.ok(
    (
      await checked(a.client.rpc("finance_earnings"), "Own statement stages")
    ).every((r) => r.stage === "paid"),
  );
  await checked(
    admin.client.rpc("void_invoice_payment", {
      p_payment_id: firstPayment,
      p_reason: "Corrected fictional tracking entry",
    }),
    "Audited correction retains original payment record",
  );
  record = (
    await checked(a.client.rpc("invoice_records"), "Read corrected invoice")
  )[0];
  assert.equal(record.status, "approved");
  assert.equal(Number(record.paid_amount), 200);
  assert.equal(
    (
      await checked(
        a.client.rpc("invoice_payments", { p_invoice_id: invoice }),
        "Audited payment history",
      )
    ).filter((p) => p.voided_at).length,
    1,
  );
  const replacement = pdf(
    "Future replacement must not modify accepted contract evidence.",
  );
  await upload(admin, replacement, "contract", a.id, contractDoc.id);
  const oldDownload = await download(a, contractDoc.id, version.id);
  assert.equal(oldDownload.status, 200);
  assert.deepEqual(new Uint8Array(await oldDownload.arrayBuffer()), original);
  assert.equal(
    (
      await checked(
        a.client.rpc("contract_records"),
        "Exact original contract version",
      )
    )[0].document_version_id,
    version.id,
  );
  assert.ok(
    (
      await a.client.rpc("rename_document", {
        p_id: contractDoc.id,
        p_name: "Hide contract.pdf",
        p_delete: true,
      })
    ).error,
    "Linked executed evidence cannot be hidden by ordinary file deletion",
  );
  console.log(
    "PASS: actual Auth, real MFA, Storage/ClamAV-scanned PDF versions: externally executed contract registration, exact-hash receipt-not-signature, contract-gated claims, original-fee invoice derivation/idempotency/privacy, MFA partial/full payment+audited correction and immutable old-version download after replacement.",
  );
} finally {
  for (const client of clients) await client.removeAllChannels();
  if (users.length) {
    const invoices = await checked(
      service.from("invoices").select("id").in("user_id", users),
      "Select only temporary invoices",
    );
    const invoiceIds = invoices.map((i) => i.id);
    if (invoiceIds.length) {
      await checked(
        service.from("payment_records").delete().in("invoice_id", invoiceIds),
        "Clean temporary tracking payments",
      );
      await checked(
        service.from("invoice_items").delete().in("invoice_id", invoiceIds),
        "Clean temporary invoice items",
      );
      await checked(
        service.from("invoices").delete().in("id", invoiceIds),
        "Clean temporary invoices",
      );
    }
    const rooms = jobs.length
      ? await checked(
          service.from("chat_rooms").select("id").in("job_id", jobs),
          "Select temporary course rooms",
        )
      : [];
    for (const room of rooms)
      await checked(
        service.from("chat_members").delete().eq("room_id", room.id),
        "Clean temporary course membership",
      );
    if (rooms.length)
      await checked(
        service
          .from("chat_rooms")
          .delete()
          .in(
            "id",
            rooms.map((r) => r.id),
          ),
        "Clean temporary course rooms",
      );
    await checked(
      service.from("notifications").delete().in("user_id", users),
      "Clean temporary notifications",
    );
    const claims = jobs.length
      ? await checked(
          service.from("job_claims").select("id").in("job_id", jobs),
          "Select temporary accepted claims",
        )
      : [];
    if (claims.length) {
      const ids = claims.map((c) => c.id);
      await checked(
        service.from("claim_events").delete().in("claim_id", ids),
        "Clean temporary claim events",
      );
      await checked(
        service.from("assignment_sessions").delete().in("claim_id", ids),
        "Clean temporary calendar allocations",
      );
      await checked(
        service.from("job_claims").delete().in("id", ids),
        "Clean temporary claims",
      );
    }
    const jobRows = jobs.length
      ? await checked(
          service.from("jobs").select("course_run_id").in("id", jobs),
          "Select temporary course links",
        )
      : [];
    if (jobs.length)
      await checked(
        service.from("jobs").delete().in("id", jobs),
        "Clean temporary job offers",
      );
    const runIds = jobRows.map((j) => j.course_run_id).filter(Boolean);
    if (runIds.length) {
      const runs = await checked(
        service
          .from("course_runs")
          .select("id,template_id,organisation_id")
          .in("id", runIds),
        "Select temporary course records",
      );
      await checked(
        service.from("course_sessions").delete().in("course_run_id", runIds),
        "Clean temporary course sessions",
      );
      await checked(
        service.from("course_runs").delete().in("id", runIds),
        "Clean temporary runs",
      );
      await checked(
        service
          .from("course_templates")
          .delete()
          .in(
            "id",
            runs.map((r) => r.template_id),
          ),
        "Clean temporary templates",
      );
      await checked(
        service
          .from("organisations")
          .delete()
          .in(
            "id",
            runs.map((r) => r.organisation_id),
          ),
        "Clean temporary organisations",
      );
    }
    await checked(
      service.from("contract_acceptances").delete().in("user_id", users),
      "Clean temporary receipt acknowledgements",
    );
    await checked(
      service.from("contracts").delete().in("user_id", users),
      "Clean temporary executed metadata",
    );
    const docs = await checked(
      service.from("documents").select("id").in("owner_id", users),
      "Select temporary private PDFs",
    );
    if (docs.length) {
      const ids = docs.map((d) => d.id),
        versions = await checked(
          service
            .from("document_versions")
            .select("object_path")
            .in("document_id", ids),
          "Select temporary storage paths",
        );
      const paths = versions.map((v) => v.object_path);
      await service.storage.from("portal-clean").remove(paths);
      await service.storage.from("portal-quarantine").remove(paths);
      await checked(
        service
          .from("documents")
          .update({ current_version_id: null })
          .in("id", ids),
        "Release temporary version pointers",
      );
      await checked(
        service.from("document_versions").delete().in("document_id", ids),
        "Clean temporary file versions",
      );
      await checked(
        service.from("documents").delete().in("id", ids),
        "Clean temporary file metadata",
      );
    }
    await checked(
      service.from("audit_events").delete().in("actor_id", users),
      "Clean temporary audited actions",
    );
    for (const id of users)
      await checked(
        service.auth.admin.deleteUser(id),
        "Remove temporary commercial account",
      );
  }
}
