/**
 * Two-phase native upgrade witness: create owned password accounts/object bytes before upgrading, then verify the same data afterward. A private ledger joins the phases without publishing credentials.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { readPrivateJson } from "../../../scripts/testing/private-state.mjs";
import { assertPasswordOnly } from "../../../scripts/testing/password-only.mjs";

import { pathToFileURL } from "node:url";

// Compute a stable SHA-256 digest for the source/artifact comparison.
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
// Fail on an SDK error rather than accepting an empty response as successful evidence.
async function checked(promise) {
  const result = await promise;
  assert.equal(result.error, null);
  return result.data;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ledgerName = ".candidate-upgrade-probe.json";
const maxLedgerBytes = 64 * 1024;

/** Rebuild an exact UUID from bounded numeric components; private file bytes never become arbitrary request data. */
export function canonicalProbeUuid(value) {
  if (typeof value !== "string" || value.length !== 36 || !uuid.test(value))
    throw new TypeError("A canonical probe UUID is required.");
  const widths = [8, 4, 4, 4, 12];
  return value
    .split("-")
    .map((part, index) =>
      Number.parseInt(part, 16).toString(16).padStart(widths[index], "0"),
    )
    .join("-");
}

/** Persist one bounded complete witness in the pinned private directory; exclusive creation never replaces an earlier ledger. */
export function writeUpgradeProbeLedger(probe, directory = process.cwd()) {
  if (!probe || !/^luminovia-portal-test-[a-f0-9]{24}$/.test(probe.owner ?? ""))
    throw new TypeError("An owned upgrade probe ledger is required.");
  assertFinancialWitness(probe.financial);
  const json = JSON.stringify({
    ...probe,
    documentId: canonicalProbeUuid(probe.documentId),
  });
  if (Buffer.byteLength(json) > maxLedgerBytes)
    throw new Error("Private upgrade probe JSON exceeds its bounded size.");
  const parent = openSync(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const info = fstatSync(parent);
    if (
      !info.isDirectory() ||
      info.uid !== process.getuid() ||
      (info.mode & 0o7777) !== 0o700
    )
      throw new Error("The upgrade probe requires an owned 0700 directory.");
    const target = `/proc/self/fd/${parent}/${ledgerName}`;
    const descriptor = openSync(
      target,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    let completed = false;
    try {
      const file = fstatSync(descriptor);
      if (
        !file.isFile() ||
        file.uid !== process.getuid() ||
        file.nlink !== 1 ||
        (file.mode & 0o7777) !== 0o600
      )
        throw new Error("The upgrade probe requires an owned private file.");
      writeFileSync(descriptor, json);
      fsyncSync(descriptor);
      fsyncSync(parent);
      completed = true;
    } finally {
      try {
        closeSync(descriptor);
      } finally {
        // A failed partial write must never remain available to the verify phase.
        if (!completed) unlinkSync(target);
      }
    }
  } finally {
    closeSync(parent);
  }
}

/** Exact fixture cents, without tolerances that could hide an altered accepted fee. */
function cents(value) {
  const text = String(value);
  assert.match(text, /^\d+(?:\.\d{1,2})?$/, "Invalid retained monetary value");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
/** A small genuine PDF for the existing quarantine/scanning gateway, never renamed text. */
export function financialProbePdf(text) {
  assert.match(text, /^[A-Za-z0-9 .!-]+$/);
  const stream = `BT /F1 12 Tf 30 100 Td (${text}) Tj ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  return Buffer.from(
    pdf +
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
}

/** Read only exact fixture rows. No SET ROLE/JWT, writes, business bootstrap or candidate policy changes. */
export function financialSnapshotSql(
  ids,
  revenueAvailable = Boolean(ids.commissionedClaimId),
) {
  for (const id of [
    ids.actorId,
    ids.contractId,
    ids.invoiceId,
    ...ids.claimIds,
  ])
    assert.match(id, uuid);
  const claims = ids.claimIds.map((id) => `'${id}'::uuid`).join(",");
  assert(claims && ids.claimIds.length <= 2);
  const rows = (table, where, order) =>
    `(select coalesce(jsonb_agg(to_jsonb(r) order by ${order}), '[]'::jsonb) from ${table} r where ${where})`;
  return `begin read only;
select jsonb_build_object(
 'claims',${rows("public.job_claims", `r.id in (${claims}) and r.lecturer_id='${ids.actorId}'::uuid`, "r.id")},
 'sessions',${rows("public.assignment_sessions", `r.claim_id in (${claims})`, "r.id")},
 'contracts',${rows("public.contracts", `r.id='${ids.contractId}'::uuid`, "r.id")},
 'receipts',${rows("public.contract_acceptances", `r.contract_id='${ids.contractId}'::uuid`, "r.id")},
 'invoices',${rows("public.invoices", `r.id='${ids.invoiceId}'::uuid`, "r.id")},
 'items',${rows("public.invoice_items", `r.invoice_id='${ids.invoiceId}'::uuid`, "r.claim_id")},
 'payments',${rows("public.payment_records", `r.invoice_id='${ids.invoiceId}'::uuid`, "r.id")},
 'versions',${rows("public.document_versions", `r.id in (select document_version_id from public.contracts where id='${ids.contractId}'::uuid union select document_version_id from public.invoices where id='${ids.invoiceId}'::uuid)`, "r.id")},
 'revenue',${revenueAvailable ? rows("private.claim_revenue_ledger", `r.claim_id in (${claims})`, "r.claim_id") : "'[]'::jsonb"}
)::text;
commit;`;
}

/** Added schema columns may appear after upgrading; every pre-existing value must survive exactly. */
function existingProjection(actual, expected) {
  if (Array.isArray(expected)) {
    assert(Array.isArray(actual));
    assert.equal(actual.length, expected.length, "Retained row count changed");
    return expected.map((row, index) => existingProjection(actual[index], row));
  }
  if (expected && typeof expected === "object") {
    assert(actual && typeof actual === "object");
    return Object.fromEntries(
      Object.entries(expected).map(([key, value]) => {
        assert(
          Object.hasOwn(actual, key),
          "Retained snapshot field disappeared: " + key,
        );
        return [key, existingProjection(actual[key], value)];
      }),
    );
  }
  return actual;
}
/** Reject incomplete witnesses as well as changed claims, splits, original currencies, sessions, invoices and file hashes. */
export function assertFinancialWitness(witness) {
  assert.equal(
    witness?.version,
    1,
    "A pre-upgrade financial witness is required",
  );
  const { ids, database, ownClaims, invoice, contract, commission } = witness;
  assert(ids && Array.isArray(ids.claimIds) && ids.claimIds.length >= 1);
  assert.equal(database.claims.length, ids.claimIds.length);
  assert.equal(ownClaims.length, ids.claimIds.length);
  assert.deepEqual(
    witness.ownInvoiceRows,
    database.invoices,
    "The caller's invoice RLS projection differs from the physical invoice",
  );
  assert.equal(database.invoices.length, 1);
  assert.equal(database.invoices[0].id, ids.invoiceId);
  assert.equal(database.invoices[0].user_id, ids.actorId);
  assert.equal(database.invoices[0].status, "submitted");
  assert.equal(database.invoices[0].currency, "AUD");
  assert.equal(
    database.invoices[0].document_version_id,
    witness.invoiceDocument.versionId,
  );
  assert.equal(invoice.id, ids.invoiceId);
  assert.equal(database.items.length, ids.claimIds.length);
  assert.deepEqual(
    database.items.map((row) => row.claim_id).sort(),
    [...ids.claimIds].sort(),
  );
  assert(database.items.every((row) => row.active));
  assert.equal(database.contracts.length, 1);
  assert.equal(database.contracts[0].id, ids.contractId);
  assert.equal(contract.id, ids.contractId);
  assert.equal(database.receipts.length, 1);
  assert.equal(database.receipts[0].user_id, ids.actorId);
  assert.equal(database.receipts[0].contract_id, ids.contractId);
  assert.equal(database.contracts[0].user_id, ids.actorId);
  assert.equal(
    database.contracts[0].document_version_id,
    witness.contractDocument.versionId,
  );
  assert.equal(database.versions.length, 2);
  assert.equal(database.sessions.length, ids.claimIds.length * 2);
  assert(
    database.sessions.every(
      (row) => row.released_at === null || row.released_at === undefined,
    ),
    "Confirmed retained intervals must not be released",
  );
  let total = 0n;
  for (const claim of database.claims) {
    assert(ids.claimIds.includes(claim.id));
    assert.equal(claim.lecturer_id, ids.actorId);
    assert.equal(claim.status, "confirmed");
    assert.equal(claim.currency, "AUD");
    assert.equal(claim.contract_id, ids.contractId);
    assert.deepEqual(
      ownClaims.find((row) => row.id === claim.id),
      claim,
      "The caller's retained claim differs from the physical snapshot",
    );
    assert.equal(
      database.sessions.filter((row) => row.claim_id === claim.id).length,
      2,
    );
    assert(claim.terms && Number.isInteger(claim.terms_version));
    assert.equal(
      witness.acceptedDigests.find((row) => row.claimId === claim.id)
        ?.termsSha256,
      hash(claim.terms),
    );
    assert.equal(
      witness.acceptedDigests.find((row) => row.claimId === claim.id)
        ?.sessionsSha256,
      hash(
        JSON.stringify(
          database.sessions
            .filter((row) => row.claim_id === claim.id)
            .map(({ id, claim_id, lecturer_id, starts_at, ends_at }) => ({
              id,
              claim_id,
              lecturer_id,
              starts_at,
              ends_at,
            })),
        ),
      ),
    );
    cents(claim.amount);
    total += cents(claim.total_amount);
  }
  assert.equal(cents(database.invoices[0].total_amount), total);
  assert.equal(cents(invoice.total_amount), total);
  assert.equal(invoice.currency, "AUD");
  for (const doc of [witness.contractDocument, witness.invoiceDocument]) {
    const version = database.versions.find((row) => row.id === doc.versionId);
    assert(version, "Retained exact document version missing");
    assert.equal(version.document_id, doc.id);
    assert.equal(version.status, "clean");
    assert.equal(version.sha256, doc.sha256);
    assert.match(doc.sha256, /^[a-f0-9]{64}$/);
  }
  if (ids.commissionedClaimId) {
    assert.equal(database.revenue.length, 1);
    const revenue = database.revenue[0];
    assert.equal(revenue.claim_id, ids.commissionedClaimId);
    assert.equal(revenue.currency, "AUD");
    assert.equal(
      cents(revenue.gross_total_amount),
      cents(revenue.platform_total_amount) +
        cents(revenue.lecturer_net_total_amount),
    );
    assert.equal(
      cents(
        database.claims.find((row) => row.id === revenue.claim_id).total_amount,
      ),
      cents(revenue.lecturer_net_total_amount),
    );
    assert.equal(commission.length, 1);
    assert.equal(commission[0].claim_id, revenue.claim_id);
    for (const field of [
      "gross_total_amount",
      "platform_total_amount",
      "lecturer_net_total_amount",
    ])
      assert.equal(
        cents(commission[0][field]),
        cents(revenue[field]),
        "The administrative finance projection differs from the physical ledger",
      );
  } else {
    assert.deepEqual(database.revenue, []);
    assert.deepEqual(commission, []);
  }
}
/** Physical DB rows and current caller-authorised projections must both retain their old values. */
export function assertRetainedFinancialWitness(before, after) {
  assertFinancialWitness(before);
  assertFinancialWitness(after);
  assert.deepEqual(
    existingProjection(after, before),
    before,
    "Accepted financial snapshots changed during upgrade",
  );
}

/** Create retained business evidence through real caller-authenticated RPCs and the scanned upload gateway. */
export async function createFinancialWitness({
  actorId,
  lecturer,
  manager,
  commissions,
  offerProjectionAvailable = true,
  rolePricingAvailable = false,
  upload,
  collect,
}) {
  assert(
    !rolePricingAvailable || offerProjectionAvailable,
    "Role-priced baselines require their actor quote API; raw sentinel values are never a fallback",
  );
  const contractBytes = financialProbePdf(
    "Fictional executed agreement - native upgrade witness only.",
  );
  const contractDocument = await upload(
    manager,
    contractBytes,
    "contract",
    actorId,
  );
  const start = new Date(Date.now() + 90 * 86400000);
  start.setUTCHours(8, 0, 0, 0);
  const contractId = await checked(
    manager.rpc("register_executed_contract", {
      p_user_id: actorId,
      p_title: "Existing fictional agreement",
      p_document_version_id: contractDocument.versionId,
      p_effective_from: new Date(Date.now() - 86400000).toISOString(),
      p_expires_at: new Date(+start + 365 * 86400000).toISOString(),
      p_kind: "master",
      p_parent_id: null,
      p_client_id: randomUUID(),
    }),
  );
  await checked(
    lecturer.rpc("acknowledge_contract", {
      p_contract_id: contractId,
      p_sha256: contractDocument.sha256,
      p_client_id: randomUUID(),
    }),
  );
  const ids = {
    actorId,
    contractId,
    claimIds: [],
    invoiceId: null,
    commissionedClaimId: null,
  };
  for (const commissioned of commissions ? [false, true] : [false]) {
    const day = +start + (commissioned ? 3 : 0) * 86400000;
    const payload = {
      title:
        "Existing fictional " +
        (commissioned ? "commissioned" : "legacy") +
        " assignment " +
        randomUUID(),
      customer_name: "Existing fictional financial witness",
      description: "Disposable upgrade retention fixture only.",
      delivery_type: "online",
      location: "Online",
      time_zone: "Australia/Brisbane",
      status: "published",
      currency: "AUD",
      rate_unit: "fixed_total",
      terms: "Exact existing accepted conditions - preserve this snapshot.",
      requires_contract: true,
      topic_ids: [],
      sessions: [0, 1].map((offset) => ({
        starts_at: new Date(day + offset * 86400000).toISOString(),
        ends_at: new Date(day + offset * 86400000 + 3600000).toISOString(),
      })),
      ...(commissioned
        ? { gross_amount: 271.83, gross_total_amount: 271.83 }
        : { amount: 89.17, total_amount: 89.17 }),
    };
    // No policy setup/override is permitted here: use the baseline's actual
    // configured fixture policy or fail, before any candidate bootstrap occurs.
    const jobId = await checked(
      manager.rpc(
        commissioned ? "create_commission_job" : "create_job",
        commissioned
          ? {
              p_organisation_id: null,
              p_payload: payload,
              p_client_id: randomUUID(),
            }
          : { p_payload: payload },
      ),
    );
    // Older non-role-priced baselines may have no job_offers RPC.
    // Only that detected schema shape uses its existing exact RLS projection;
    // an RPC denial/error must never trigger a raw-table pricing fallback.
    const offer = offerProjectionAvailable
      ? (await checked(lecturer.rpc("job_offers"))).find(
          (row) => row.id === jobId,
        )
      : await checked(
          lecturer
            .from("jobs")
            .select("id,amount,total_amount,terms_version")
            .eq("id", jobId)
            .single(),
        );
    assert(offer && offer.amount !== null && offer.total_amount !== null);
    const receipt = await checked(
      lecturer.rpc("claim_job", {
        p_job_id: jobId,
        p_idempotency_key: randomUUID(),
        p_terms_version: offer.terms_version,
      }),
    );
    assert.equal(receipt.status, "confirmed");
    assert.match(receipt.claim_id, uuid);
    ids.claimIds.push(receipt.claim_id);
    if (commissioned) ids.commissionedClaimId = receipt.claim_id;
  }
  const invoiceDocument = await upload(
    lecturer,
    financialProbePdf(
      "Fictional existing invoice - native upgrade witness only.",
    ),
    "invoice",
  );
  ids.invoiceId = await checked(
    lecturer.rpc("submit_invoice", {
      p_number: "EXISTING-" + randomUUID(),
      p_claim_ids: ids.claimIds,
      p_document_version_id: invoiceDocument.versionId,
      p_issued_on: new Date().toISOString().slice(0, 10),
      p_due_on: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      p_client_id: randomUUID(),
    }),
  );
  const witness = await collect({
    version: 1,
    ids,
    contractDocument,
    invoiceDocument,
  });
  assertFinancialWitness(witness);
  return witness;
}

/** Execute one guarded native phase; credentials and snapshots stay in the owned private ledger. */
export async function runUpgradeProbe(mode) {
  assert(["--create", "--verify"].includes(mode));
  const owner = process.env.PORTAL_CANDIDATE_OWNER;
  assert.match(owner ?? "", /^luminovia-portal-test-[a-f0-9]{24}$/);
  assert.equal(lstatSync(process.cwd()).mode & 0o077, 0);
  const metadata = JSON.parse(
    execFileSync("docker", ["inspect", "supabase_db_" + owner], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  )[0];
  assert.equal(metadata.Config.Labels["org.luminovia.candidate"], owner);
  assert.equal(Object.keys(metadata.HostConfig.PortBindings ?? {}).length, 0);
  assert.deepEqual(Object.keys(metadata.NetworkSettings.Networks), [
    owner + "-backend",
  ]);
  process.loadEnvFile(".env.test.local");
  const url = new URL(process.env.SUPABASE_URL);
  assert(url.protocol === "https:" && url.hostname === "127.0.0.1" && url.port);
  // Create a stateless SDK client for the isolated candidate instance.
  const make = (key) =>
    createClient(url.href, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  const service = make(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const filesEndpoint = url.href.replace(/\/$/, "") + "/functions/v1/files";
  // This connection only observes physical snapshot rows. All business writes
  // below use authenticated callers and the normal password/RPC/file boundaries.
  const readDatabase = (statement) =>
    JSON.parse(
      execFileSync(
        "docker",
        [
          "exec",
          "supabase_db_" + owner,
          "psql",
          "-X",
          "-A",
          "-t",
          "-q",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "postgres",
          "-c",
          statement,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000 },
      ).trim(),
    );
  const capabilities = readDatabase(
    "begin read only; select json_build_object('invoices',to_regclass('public.invoices') is not null,'commission',to_regclass('private.claim_revenue_ledger') is not null,'jobOffers',to_regprocedure('public.job_offers()') is not null,'rolePricing',to_regclass('private.compensation_policy') is not null); commit;",
  );
  assert(
    capabilities.invoices,
    "The retained upgrade baseline must support the existing invoice business API",
  );
  // Use the real caller session and gateway/scan path, including the existing
  // contracts.manage boundary for a contract uploaded for this fixed lecturer.
  const uploadFinancial = async (who, bytes, kind, subject) => {
    const { session } = await checked(who.auth.getSession());
    const form = new FormData();
    form.set(
      "file",
      new File([bytes], "existing-" + kind + ".pdf", {
        type: "application/pdf",
      }),
    );
    form.set("scope", "personal");
    form.set("kind", kind);
    form.set("client_id", randomUUID());
    if (subject) form.set("owner_id", subject);
    const result = await fetch(filesEndpoint, {
      method: "POST",
      headers: {
        Origin: process.env.PORTAL_APP_ORIGIN,
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: "Bearer " + session.access_token,
      },
      body: form,
      signal: AbortSignal.timeout(90000),
    });
    assert.equal(
      result.status,
      200,
      "Retained financial PDF upload must pass the real gateway/scanner",
    );
    const document = (await result.json()).document;
    assert.equal(document.status, "clean");
    return {
      id: canonicalProbeUuid(document.id),
      versionId: canonicalProbeUuid(document.current_version_id),
      sha256: hash(bytes),
    };
  };
  // API and direct-RLS views must agree with the physical snapshots; neither
  // privileged read-only evidence nor a cached ID grants browser authority.
  const collectFinancial = async (witness, lecturer, manager) => {
    const { ids } = witness;
    const ownClaims = await checked(
      lecturer
        .from("job_claims")
        .select("*")
        .in("id", ids.claimIds)
        .order("id"),
    );
    const invoice = (await checked(lecturer.rpc("invoice_records"))).find(
      (row) => row.id === ids.invoiceId,
    );
    const ownInvoiceRows = await checked(
      lecturer.from("invoices").select("*").eq("id", ids.invoiceId),
    );
    const contract = (await checked(lecturer.rpc("contract_records"))).find(
      (row) => row.id === ids.contractId,
    );
    const commission = ids.commissionedClaimId
      ? (await checked(manager.rpc("commission_report"))).filter(
          (row) => row.claim_id === ids.commissionedClaimId,
        )
      : [];
    const database = readDatabase(
      financialSnapshotSql(ids, capabilities.commission),
    );
    const acceptedDigests = database.claims.map((claim) => ({
      claimId: claim.id,
      termsSha256: hash(claim.terms),
      sessionsSha256: hash(
        JSON.stringify(
          database.sessions
            .filter((row) => row.claim_id === claim.id)
            .map(({ id, claim_id, lecturer_id, starts_at, ends_at }) => ({
              id,
              claim_id,
              lecturer_id,
              starts_at,
              ends_at,
            })),
        ),
      ),
    }));
    return {
      ...witness,
      ownClaims,
      ownInvoiceRows,
      invoice,
      contract,
      commission,
      database,
      acceptedDigests,
    };
  };
  // Fixture bootstrap creates real Auth identities; it never forges a SQL JWT,
  // fabricates authorization or inserts accepted claims/invoices directly.
  const newFinancialActor = async (role) => {
    const email = "candidate-finance-" + randomUUID() + "@example.invalid";
    const password = "Retained!" + randomUUID() + "Aa9";
    const { user } = await checked(
      service.auth.admin.createUser({ email, password, email_confirm: true }),
    );
    await checked(
      service.from("user_roles").insert({ user_id: user.id, role }),
    );
    const client = make(process.env.SUPABASE_ANON_KEY);
    await checked(client.auth.signInWithPassword({ email, password }));
    await assertPasswordOnly(client);
    const identity = { id: user.id, email, password };
    return { client, identity };
  };
  // Establish a new real session after upgrading; an old bearer cannot stand
  // in for retained passwords and current database roles.
  const retainedFinancialActor = async (identity) => {
    const client = make(process.env.SUPABASE_ANON_KEY);
    const login = await checked(
      client.auth.signInWithPassword({
        email: identity.email,
        password: identity.password,
      }),
    );
    assert.equal(login.user.id, identity.id);
    await assertPasswordOnly(client);
    return client;
  };
  // Guessed commercial IDs and exact version downloads stay denied to the
  // separate lecturer, while the owner receives the same uncached bytes.
  const checkFinancialPrivacy = async (witness, lecturer, foreign) => {
    assert.deepEqual(
      await checked(
        foreign.from("job_claims").select("id").in("id", witness.ids.claimIds),
      ),
      [],
    );
    assert.deepEqual(await checked(foreign.rpc("invoice_records")), []);
    assert.deepEqual(
      await checked(
        foreign.from("invoices").select("id").eq("id", witness.ids.invoiceId),
      ),
      [],
    );
    assert.deepEqual(await checked(foreign.rpc("contract_records")), []);
    if (witness.ids.commissionedClaimId)
      assert.equal(
        (await lecturer.rpc("commission_report")).error?.code,
        "42501",
      );
    for (const document of [
      witness.contractDocument,
      witness.invoiceDocument,
    ]) {
      for (const [who, permitted] of [
        [lecturer, true],
        [foreign, false],
      ]) {
        const { session } = await checked(who.auth.getSession());
        const response = await fetch(filesEndpoint, {
          method: "POST",
          headers: {
            Origin: process.env.PORTAL_APP_ORIGIN,
            apikey: process.env.SUPABASE_ANON_KEY,
            Authorization: "Bearer " + session.access_token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "download",
            id: canonicalProbeUuid(document.id),
            version_id: canonicalProbeUuid(document.versionId),
          }),
          signal: AbortSignal.timeout(90000),
        });
        assert.equal(response.status, permitted ? 200 : 403);
        if (permitted) {
          assert.equal(
            hash(new Uint8Array(await response.arrayBuffer())),
            document.sha256,
          );
          assert.match(response.headers.get("cache-control"), /no-store/);
        } else await response.body?.cancel();
      }
    }
  };
  let financialReceipt;
  if (mode === "--create") {
    const id = randomUUID(),
      email = "candidate-existing-" + id + "@example.invalid";
    const password = "Existing!" + randomUUID() + "Aa9";
    const { user } = await checked(
      service.auth.admin.createUser({ email, password, email_confirm: true }),
    );
    await checked(
      service.from("user_roles").insert({ user_id: user.id, role: "lecturer" }),
    );
    const client = make(process.env.SUPABASE_ANON_KEY);
    await checked(client.auth.signInWithPassword({ email, password }));
    await assertPasswordOnly(client);
    const { session } = await checked(client.auth.getSession());
    const event = await checked(
      client
        .from("personal_events")
        .insert({
          user_id: user.id,
          title: "Private existing candidate event " + id,
          starts_at: "2046-01-01T08:00:00Z",
          ends_at: "2046-01-01T09:00:00Z",
          time_zone: "Europe/Berlin",
        })
        .select()
        .single(),
    );
    const bytes = new TextEncoder().encode(
      "Existing private scanned candidate file " + id,
    );
    const form = new FormData();
    form.set(
      "file",
      new File([bytes], "existing-private.txt", { type: "text/plain" }),
    );
    form.set("scope", "personal");
    form.set("kind", "material");
    form.set("client_id", randomUUID());
    const response = await fetch(
      url.href.replace(/\/$/, "") + "/functions/v1/files",
      {
        method: "POST",
        headers: {
          Origin: process.env.PORTAL_APP_ORIGIN,
          apikey: process.env.SUPABASE_ANON_KEY,
          Authorization: "Bearer " + session.access_token,
        },
        body: form,
        signal: AbortSignal.timeout(90000),
      },
    );
    assert.equal(response.status, 200);
    const document = (await response.json()).document;
    assert.equal(document.status, "clean");
    const roles = await checked(
      service
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .order("role"),
    );
    const manager = await newFinancialActor("admin");
    const foreign = await newFinancialActor("lecturer");
    const financial = await createFinancialWitness({
      actorId: user.id,
      lecturer: client,
      manager: manager.client,
      commissions: capabilities.commission,
      offerProjectionAvailable: capabilities.jobOffers,
      rolePricingAvailable: capabilities.rolePricing,
      upload: uploadFinancial,
      collect: (witness) => collectFinancial(witness, client, manager.client),
    });
    await checkFinancialPrivacy(financial, client, foreign.client);
    financialReceipt = {
      kind: "accepted-financial-witness",
      phase: mode,
      claims: financial.ids.claimIds.length,
      invoices: 1,
      commissioned: Boolean(financial.ids.commissionedClaimId),
      snapshotSha256: hash(JSON.stringify(financial)),
      foreignDenied: true,
    };
    writeUpgradeProbeLedger({
      owner,
      id: user.id,
      email,
      password,
      event,
      documentId: canonicalProbeUuid(document.id),
      sha256: hash(bytes),
      roles,
      financial,
      financialManager: manager.identity,
      financialForeign: foreign.identity,
    });
  } else {
    const probe = readPrivateJson(ledgerName);
    assert(probe, "A complete private upgrade probe ledger is required.");
    assert.equal(probe.owner, owner);
    assertFinancialWitness(probe.financial);
    const client = make(process.env.SUPABASE_ANON_KEY);
    const data = await checked(
      client.auth.signInWithPassword({
        email: probe.email,
        password: probe.password,
      }),
    );
    assert.equal(data.user.id, probe.id);
    await assertPasswordOnly(client);
    assert.deepEqual(
      await checked(
        service
          .from("user_roles")
          .select("role")
          .eq("user_id", probe.id)
          .order("role"),
      ),
      probe.roles,
    );
    assert.deepEqual(
      await checked(
        client
          .from("personal_events")
          .select()
          .eq("id", probe.event.id)
          .single(),
      ),
      probe.event,
    );
    const { session } = await checked(client.auth.getSession());
    const download = (token) =>
      fetch(url.href.replace(/\/$/, "") + "/functions/v1/files", {
        method: "POST",
        headers: {
          Origin: process.env.PORTAL_APP_ORIGIN,
          apikey: process.env.SUPABASE_ANON_KEY,
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "download",
          id: canonicalProbeUuid(probe.documentId),
        }),
        signal: AbortSignal.timeout(90000),
      });
    const response = await download(session.access_token);
    assert.equal(response.status, 200);
    assert.equal(
      hash(new Uint8Array(await response.arrayBuffer())),
      probe.sha256,
    );
    assert.match(response.headers.get("cache-control"), /no-store/);
    const administrator = make(process.env.SUPABASE_ANON_KEY);
    const admin = await checked(
      administrator.auth.signInWithPassword({
        email: "admin@example.invalid",
        password: process.env.E2E_PASSWORD,
      }),
    );
    const denied = await download(admin.session.access_token);
    assert.equal(denied.status, 403);
    await denied.body?.cancel();
    assert.deepEqual(
      await checked(
        administrator
          .from("personal_events")
          .select("id")
          .eq("id", probe.event.id),
      ),
      [],
    );
    const manager = await retainedFinancialActor(probe.financialManager);
    const foreign = await retainedFinancialActor(probe.financialForeign);
    const retained = await collectFinancial(probe.financial, client, manager);
    assertRetainedFinancialWitness(probe.financial, retained);
    await checkFinancialPrivacy(retained, client, foreign);
    financialReceipt = {
      kind: "accepted-financial-witness",
      phase: mode,
      claims: retained.ids.claimIds.length,
      invoices: 1,
      commissioned: Boolean(retained.ids.commissionedClaimId),
      snapshotSha256: hash(
        JSON.stringify(existingProjection(retained, probe.financial)),
      ),
      foreignDenied: true,
    };
  }
  console.log(
    "PASS scoped existing password-only Auth/no factors/roles/private-event/scanned-file/accepted-finance/invoice " +
      mode,
  );
  // The parent may persist this anonymous digest/count receipt. No credentials,
  // monetary values, private policy, document text or record IDs leave the ledger.
  console.log(JSON.stringify(financialReceipt));
}

// Importable fixture logic remains inert; only the explicit owned native command runs services/API calls.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  assert.equal(process.argv.length, 3);
  await runUpgradeProbe(process.argv[2]);
}
