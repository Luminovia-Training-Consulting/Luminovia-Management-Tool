/**
 * Real Auth/HTTP checks for tenant permissions and separate gross, platform and net shares.
 * Separate fictional identities verify actual API results and denied access; responses are not browser mocks.
 */
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
if (process.env.PORTAL_TEST_MODE !== "1")
  throw new Error("Commission API mutations require isolated ./portal test.");
process.loadEnvFile(".env.test.local");
const url = process.env.SUPABASE_URL;
assert.ok(
  url && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
  "Commission tests only permit loopback projects.",
);
const project = /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m.exec(
  readFileSync("supabase/config.toml", "utf8"),
)?.[1];
assert.ok(
  project?.startsWith("luminovia-portal-test-"),
  "Only an isolated test project is permitted.",
);
const container = process.env.PORTAL_DB_CONTAINER ?? `supabase_db_${project}`;
assert.equal(
  container,
  `supabase_db_${project}`,
  "Test database must belong to this isolated project.",
);
const origin = new URL(
  process.env.PORTAL_APP_ORIGIN ??
    process.env.E2E_BASE_URL ??
    "http://127.0.0.1:5273",
).origin;
/** Creates a separate SDK client without persistent sessions or automatic session refresh. */
const make = (key) =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const service = make(process.env.SUPABASE_SERVICE_ROLE_KEY),
  users = [],
  clients = [],
  jobs = [],
  orgs = [];
const suffix = randomUUID();
/** Requires actual SDK success before returning the response data. */
async function checked(request, label) {
  const { data, error } = await request;
  assert.equal(error, null, `${label}: ${error?.message}`);
  return data;
}
/** Creates separate fictional accounts and signs them in through Auth; their IDs belong only to the fixture. */
async function fixture(name, role) {
  const email = `commission-${name}-${suffix}@example.invalid`;
  const auth = await checked(
    service.auth.admin.createUser({
      email,
      password: process.env.E2E_PASSWORD,
      email_confirm: true,
    }),
    "Create fictional commission actor",
  );
  users.push(auth.user.id);
  await checked(
    service.from("user_roles").insert({ user_id: auth.user.id, role }),
    "Assign fixture role",
  );
  await checked(
    service
      .from("profiles")
      .update({ display_name: `Fictional ${name}` })
      .eq("id", auth.user.id),
    "Name fictional actor",
  );
  const client = make(process.env.SUPABASE_ANON_KEY);
  clients.push(client);
  await checked(
    client.auth.signInWithPassword({
      email,
      password: process.env.E2E_PASSWORD,
    }),
    "Real Auth sign-in",
  );
  return { client, id: auth.user.id };
}
/** Verifies a real TOTP factor so privileged test requests actually use AAL2. */
async function mfa(actor) {
  const factor = await checked(
    actor.client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Commission QA",
    }),
    "Enroll real TOTP",
  );
  await checked(
    actor.client.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: totp(factor.totp.secret),
    }),
    "Verify real TOTP",
  );
}
/** Creates this module's fictional inputs; authoritative validation remains on the server. */
const payload = (day = 0, gross = 100.01, currency = "EUR") => ({
  title: `Fictional commissioned course ${suffix} ${day}`,
  description: "Auth API test",
  delivery_type: "online",
  location: "",
  time_zone: "Europe/Berlin",
  gross_amount: gross,
  gross_total_amount: gross,
  currency,
  rate_unit: "fixed_total",
  sessions: [
    {
      starts_at: new Date(Date.now() + (95 + day) * 86400000).toISOString(),
      ends_at: new Date(
        Date.now() + (95 + day) * 86400000 + 3600000,
      ).toISOString(),
    },
  ],
  topic_ids: [],
});
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
try {
  const admin = await fixture("admin", "admin"),
    owner = await fixture("owner", "owner"),
    management = await fixture("management", "management"),
    client = await fixture("clientA", "client"),
    other = await fixture("clientB", "client"),
    lecturer = await fixture("lecturer", "lecturer"),
    senior = await fixture("senior", "senior_lecturer");
  assert.ok(
    (await admin.client.rpc("commission_report")).error,
    "AAL1 cannot read gross",
  );
  await mfa(admin);
  await mfa(owner);
  await mfa(management);
  for (const who of [management, lecturer, senior])
    assert.ok(
      (await who.client.rpc("commission_report")).error,
      "Management/lecturer cannot read gross even with MFA",
    );
  const org = await checked(
    admin.client.rpc("save_organisation", {
      p_id: null,
      p_payload: {
        name: `Fictional commission customer A ${suffix}`,
        country: "DE",
        time_zone: "Europe/Berlin",
      },
    }),
    "Create real customer A",
  );
  orgs.push(org);
  const otherOrg = await checked(
    owner.client.rpc("save_organisation", {
      p_id: null,
      p_payload: {
        name: `Fictional commission customer B ${suffix}`,
        country: "AU",
        time_zone: "Australia/Brisbane",
      },
    }),
    "Create real customer B",
  );
  orgs.push(otherOrg);
  await checked(
    admin.client.rpc("manage_client_organisation", {
      p_user_id: client.id,
      p_organisation_id: org,
    }),
    "Link actual client A",
  );
  await checked(
    owner.client.rpc("manage_client_organisation", {
      p_user_id: other.id,
      p_organisation_id: otherOrg,
    }),
    "Link actual client B",
  );
  assert.deepEqual(
    (
      await checked(
        client.client.rpc("client_organisations"),
        "Own client organisations",
      )
    ).map((o) => o.id),
    [org],
  );
  assert.ok(
    (
      await client.client.rpc("manage_client_organisation", {
        p_user_id: client.id,
        p_organisation_id: otherOrg,
      })
    ).error,
  );
  assert.ok(
    (
      await client.client.rpc("create_client_request", {
        p_organisation_id: otherOrg,
        p_payload: payload(),
        p_client_id: randomUUID(),
      })
    ).error,
    "Cross-org request denied",
  );
  const requestKey = randomUUID(),
    requestArgs = {
      p_organisation_id: org,
      p_payload: payload(),
      p_client_id: requestKey,
    };
  const request = await checked(
    client.client.rpc("create_client_request", requestArgs),
    "Create real scoped gross request",
  );
  assert.equal(
    await checked(
      client.client.rpc("create_client_request", requestArgs),
      "Retry scoped request",
    ),
    request,
  );
  assert.deepEqual(
    await checked(
      other.client.rpc("client_requests", { p_organisation_id: org }),
      "Other client request isolation",
    ),
    [],
  );
  assert.ok(
    (
      await client.client.rpc("publish_client_request", {
        p_request_id: request,
        p_requires_contract: false,
      })
    ).error,
    "Client cannot set lecturer offer/commission",
  );
  const job = await checked(
    admin.client.rpc("publish_client_request", {
      p_request_id: request,
      p_requires_contract: false,
      p_terms: "Immutable actual API net fee",
    }),
    "Publish request with private fictional test policy",
  );
  jobs.push(job);
  const offer = await checked(
    lecturer.client.from("jobs").select("*").eq("id", job).single(),
    "Actual lecturer REST offer",
  );
  assert.equal(Number(offer.amount), 0);
  assert.equal(Number(offer.total_amount), 0);
  assert.ok(
    !Object.keys(offer).some((k) => /gross|platform|commission/.test(k)),
  );
  const adminPolicy = await checked(
    admin.client.rpc("commission_offer_policy", { p_job_id: job }),
    "Captured administrative offer policy",
  );
  assert.equal(adminPolicy.regular_lecturer_percent, 31);
  assert.equal(adminPolicy.senior_lecturer_percent, 73);
  for (const who of [management, lecturer, senior, client, other]) {
    const privateAccess = await checked(
      who.client.rpc("commission_access"),
      "Bounded policy access",
    );
    assert.equal("regular_lecturer_percent" in privateAccess, false);
    assert.equal("senior_lecturer_percent" in privateAccess, false);
    assert.equal(
      (await who.client.rpc("commission_offer_policy", { p_job_id: job })).error
        ?.code,
      "42501",
    );
    assert.equal(
      (
        await who.client.rpc("configure_compensation_policy", {
          p_regular_percent: 32,
          p_senior_percent: 74,
          p_expected_version: adminPolicy.policy_version,
        })
      ).error?.code,
      "42501",
    );
  }
  assert.ok(
    (
      await lecturer.client
        .schema("private")
        .from("job_commission_offers")
        .select("*")
    ).error,
    "Private schema cannot be queried through REST",
  );
  assert.ok(
    (await lecturer.client.from("job_commission_offers").select("*")).error,
    "No public gross mirror",
  );
  await checked(
    lecturer.client.auth.updateUser({
      data: { roles: ["owner"], role: "owner" },
    }),
    "Forge editable metadata",
  );
  assert.equal(
    (
      await checked(
        lecturer.client.rpc("commission_access"),
        "Metadata ignored",
      )
    ).can_manage_gross,
    false,
  );
  const teacherQuote = (
      await checked(lecturer.client.rpc("job_offers"), "Own teacher quote")
    ).find((row) => row.id === job),
    seniorQuote = (
      await checked(senior.client.rpc("job_offers"), "Own senior quote")
    ).find((row) => row.id === job);
  assert.equal(Number(teacherQuote.total_amount), 31);
  assert.equal(Number(seniorQuote.total_amount), 73.01);
  const calls = Array.from({ length: 10 }, (_, index) =>
    (index % 2 ? lecturer : senior).client.rpc("claim_job", {
      p_job_id: job,
      p_idempotency_key: randomUUID(),
      p_terms_version:
        index % 2 ? teacherQuote.terms_version : seniorQuote.terms_version,
    }),
  );
  const results = await Promise.all(
    calls.map((call) => checked(call, "Actual concurrent commissioned claim")),
  );
  assert.equal(results.filter((r) => r.status === "confirmed").length, 1);
  assert.equal(results.filter((r) => r.status === "filled").length, 9);
  const winningIndex = results.findIndex((r) => r.status === "confirmed"),
    winner = winningIndex % 2 ? lecturer : senior,
    claim = results[winningIndex].claim_id;
  const expectedNet = winner === senior ? 73.01 : 31;
  const accepted = await checked(
    winner.client.from("job_claims").select("*").eq("id", claim).single(),
    "Own accepted net snapshot",
  );
  assert.equal(Number(accepted.total_amount), expectedNet);
  assert.ok(
    !Object.keys(accepted).some((k) => /gross|platform|commission/.test(k)),
  );
  const report = (
    await checked(
      owner.client.rpc("commission_report"),
      "Actual private owner revenue",
    )
  ).find((row) => row.job_id === job);
  assert.equal(report.pricing_model, "commission");
  assert.equal(Number(report.gross_total_amount), 100.01);
  assert.equal(
    Number(report.platform_total_amount),
    Number((100.01 - expectedNet).toFixed(2)),
  );
  assert.equal(Number(report.lecturer_net_total_amount), expectedNet);
  assert.equal(report.claim_id, claim);
  assert.ok(
    (
      await admin.client.rpc("set_job_commission", {
        p_job_id: job,
        p_gross_amount: 200,
        p_gross_total_amount: 200,
        p_platform_percent: 75,
      })
    ).error,
    "Accepted deal cannot be repriced",
  );
  const statement = await checked(
    client.client.rpc("client_spend_summary"),
    "Actual client spend",
  );
  assert.ok(statement.every((row) => row.organisation_id === org));
  assert.equal(
    Number(
      statement.find((row) => row.currency === "EUR").gross_assigned_amount,
    ),
    100.01,
  );
  assert.ok(statement[0].teachers.some((p) => p.id === winner.id));
  assert.deepEqual(
    await checked(
      other.client.rpc("client_spend_summary"),
      "Other client has no spending",
    ),
    [],
  );
  const invoiceDoc = await upload(
    winner,
    pdf("Fictional net-fee invoice - QA only."),
    "invoice",
  );
  const issued = new Date().toISOString().slice(0, 10),
    due = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const invoice = await checked(
    winner.client.rpc("submit_invoice", {
      p_number: `NET-${suffix}`,
      p_claim_ids: [claim],
      p_document_version_id: invoiceDoc.current_version_id,
      p_issued_on: issued,
      p_due_on: due,
      p_client_id: randomUUID(),
    }),
    "Actual scanned invoice uses net compensation",
  );
  let record = (
    await checked(winner.client.rpc("invoice_records"), "Own net invoice")
  ).find((row) => row.id === invoice);
  assert.equal(Number(record.total_amount), expectedNet);
  await checked(
    winner.client.rpc("set_invoice_labels", {
      p_invoice_id: invoice,
      p_labels: [" Teaching ", "Teaching", "Reviewed"],
    }),
    "Owner invoice labels",
  );
  record = (
    await checked(winner.client.rpc("invoice_records"), "Read invoice labels")
  ).find((row) => row.id === invoice);
  assert.deepEqual(record.labels, ["Reviewed", "Teaching"]);
  assert.equal(Number(record.total_amount), expectedNet);
  assert.ok(
    (
      await client.client.rpc("set_invoice_labels", {
        p_invoice_id: invoice,
        p_labels: ["Forged"],
      })
    ).error,
  );
  await checked(
    management.client.rpc("set_invoice_labels", {
      p_invoice_id: invoice,
      p_labels: ["Finance QA"],
    }),
    "MFA finance operations can organize net invoice",
  );
  assert.ok(
    (await management.client.rpc("commission_report")).error,
    "Invoice operations do not grant gross",
  );
  const ownerBody = {
    ...payload(2, 200, "AUD"),
    terms: "Owner own accepted net",
    requires_contract: false,
  };
  const ownJob = await checked(
    owner.client.rpc("create_commission_job", {
      p_organisation_id: org,
      p_payload: ownerBody,
      p_client_id: randomUUID(),
    }),
    "Owner creates actual AUD commissioned offer",
  );
  jobs.push(ownJob);
  const ownOffer = (
    await checked(
      owner.client.rpc("job_offers"),
      "Own functional lecturer quote",
    )
  ).find((row) => row.id === ownJob);
  assert.equal(
    (
      await checked(
        owner.client.rpc("claim_job", {
          p_job_id: ownJob,
          p_idempotency_key: randomUUID(),
          p_terms_version: ownOffer.terms_version,
        }),
        "Owner acts as lecturer without extra role",
      )
    ).status,
    "confirmed",
  );
  assert.equal(
    (
      await checked(
        owner.client.rpc("commercial_access"),
        "Own invoice capability",
      )
    ).can_submit_invoice,
    true,
  );
  const currencies = await checked(
    client.client.rpc("client_spend_summary"),
    "Separate original-currency spend",
  );
  assert.deepEqual(
    new Set(currencies.map((r) => r.currency)),
    new Set(["EUR", "AUD"]),
  );
  await checked(
    admin.client.rpc("manage_client_organisation", {
      p_user_id: client.id,
      p_organisation_id: org,
      p_remove: true,
    }),
    "Revoke current membership",
  );
  assert.deepEqual(
    await checked(
      client.client.rpc("client_requests"),
      "Old token loses client requests",
    ),
    [],
  );
  assert.deepEqual(
    await checked(
      client.client.rpc("client_spend_summary"),
      "Old token loses spend",
    ),
    [],
  );
  const ownEvent = await checked(
    lecturer.client
      .from("personal_events")
      .insert({
        user_id: lecturer.id,
        title: "Private commission test",
        starts_at: "2045-01-01T08:00:00Z",
        ends_at: "2045-01-01T09:00:00Z",
      })
      .select("id")
      .single(),
    "Create actual private event",
  );
  assert.deepEqual(
    await checked(
      owner.client.from("personal_events").select("id").eq("id", ownEvent.id),
      "Owner functional role does not bypass private calendars",
    ),
    [],
  );
  console.log(
    "PASS: actual Auth/MFA/REST/ClamAV commission: client cross-org isolation and revocation, private fictional role-policy rounding, hidden gross, atomic claims/revenue, immutable net invoice+labels, separate EUR/AUD, owner lecturer functionality and private-calendar boundary.",
  );
} finally {
  for (const client of clients) await client.removeAllChannels();
  if (users.length) {
    // Only the exact UUID-scoped fixtures in this already isolated scratch project.
    const ids = users
      .map((id) => {
        assert.match(id, /^[0-9a-f-]{36}$/);
        return `'${id}'`;
      })
      .join(",");
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        container,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-X",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      {
        input: `begin;delete from private.claim_revenue_ledger where lecturer_id in (${ids});delete from private.job_commission_offers where job_id in(select job_id from private.client_course_requests where requested_by in (${ids}));delete from private.client_course_requests where requested_by in (${ids});commit;`,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const invoices = await checked(
      service.from("invoices").select("id").in("user_id", users),
      "Select scoped net invoices",
    );
    if (invoices.length) {
      const ids = invoices.map((i) => i.id);
      await checked(
        service.from("payment_records").delete().in("invoice_id", ids),
        "Clean scoped payments",
      );
      await checked(
        service.from("invoice_items").delete().in("invoice_id", ids),
        "Clean scoped invoice items",
      );
      await checked(
        service.from("invoices").delete().in("id", ids),
        "Clean scoped invoices",
      );
    }
    const rooms = jobs.length
      ? await checked(
          service.from("chat_rooms").select("id").in("job_id", jobs),
          "Select scoped course rooms",
        )
      : [];
    if (rooms.length) {
      const ids = rooms.map((r) => r.id);
      await checked(
        service.from("chat_members").delete().in("room_id", ids),
        "Clean scoped members",
      );
      await checked(
        service.from("chat_rooms").delete().in("id", ids),
        "Clean scoped rooms",
      );
    }
    const claims = jobs.length
      ? await checked(
          service.from("job_claims").select("id").in("job_id", jobs),
          "Select scoped claims",
        )
      : [];
    if (claims.length) {
      const ids = claims.map((c) => c.id);
      await checked(
        service.from("claim_events").delete().in("claim_id", ids),
        "Clean scoped claim events",
      );
      await checked(
        service.from("assignment_sessions").delete().in("claim_id", ids),
        "Clean scoped allocation",
      );
      await checked(
        service.from("notifications").delete().in("resource_id", ids),
        "Clean scoped notifications",
      );
      await checked(
        service.from("job_claims").delete().in("id", ids),
        "Clean scoped claims",
      );
    }
    const jobRows = jobs.length
      ? await checked(
          service.from("jobs").select("course_run_id").in("id", jobs),
          "Select scoped runs",
        )
      : [];
    if (jobs.length)
      await checked(
        service.from("jobs").delete().in("id", jobs),
        "Clean scoped offers",
      );
    const runIds = jobRows.map((j) => j.course_run_id).filter(Boolean);
    if (runIds.length) {
      const runs = await checked(
        service.from("course_runs").select("id,template_id").in("id", runIds),
        "Read scoped templates",
      );
      await checked(
        service.from("course_sessions").delete().in("course_run_id", runIds),
        "Clean scoped sessions",
      );
      await checked(
        service.from("course_runs").delete().in("id", runIds),
        "Clean scoped runs",
      );
      const ids = runs.map((r) => r.template_id);
      await checked(
        service.from("course_template_topics").delete().in("template_id", ids),
        "Clean scoped template topics",
      );
      await checked(
        service.from("course_templates").delete().in("id", ids),
        "Clean scoped templates",
      );
    }
    const docs = await checked(
      service.from("documents").select("id").in("owner_id", users),
      "Read scoped PDFs",
    );
    if (docs.length) {
      const ids = docs.map((d) => d.id),
        versions = await checked(
          service
            .from("document_versions")
            .select("object_path")
            .in("document_id", ids),
          "Read scoped objects",
        );
      const paths = versions.map((v) => v.object_path);
      await checked(
        service.storage.from("portal-clean").remove(paths),
        "Clean scoped binary files",
      );
      await checked(
        service.storage.from("portal-quarantine").remove(paths),
        "Clean scoped quarantine",
      );
      await checked(
        service
          .from("documents")
          .update({ current_version_id: null })
          .in("id", ids),
        "Release scoped pointers",
      );
      await checked(
        service.from("document_versions").delete().in("document_id", ids),
        "Clean scoped versions",
      );
      await checked(
        service.from("documents").delete().in("id", ids),
        "Clean scoped metadata",
      );
    }
    await checked(
      service.from("personal_events").delete().in("user_id", users),
      "Clean scoped private event",
    );
    await checked(
      service
        .from("client_organisation_memberships")
        .delete()
        .in("user_id", users),
      "Clean scoped client memberships",
    );
    if (orgs.length)
      await checked(
        service.from("organisations").delete().in("id", orgs),
        "Clean scoped customers",
      );
    await checked(
      service.from("audit_events").delete().in("actor_id", users),
      "Clean scoped audit",
    );
    for (const id of users)
      await checked(
        service.auth.admin.deleteUser(id),
        "Remove scoped test account",
      );
  }
}
