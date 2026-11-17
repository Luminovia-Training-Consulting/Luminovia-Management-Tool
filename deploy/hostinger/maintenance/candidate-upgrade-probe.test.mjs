/**
 * Financial witness contract and business-call orchestration with controlled SDK
 * fixtures. These cases never start services or substitute for the native upgrade.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readPrivateJson } from "../../../scripts/testing/private-state.mjs";
import {
  assertFinancialWitness,
  assertRetainedFinancialWitness,
  canonicalProbeUuid,
  createFinancialWitness,
  financialProbePdf,
  financialSnapshotSql,
  writeUpgradeProbeLedger,
} from "./candidate-upgrade-probe.mjs";

// Deterministic fictional IDs make cross-record relationships visible without real accounts.
const id = (n) => `f7000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// Compare exact fixture bytes and accepted conditions without floating-point tolerances.
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Own only this private temporary directory; no test changes another checkout or starts a service. */
function ledgerFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "portal-financial-ledger-"));
  chmodSync(directory, 0o700);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return {
    directory,
    file: join(directory, ".candidate-upgrade-probe.json"),
    probe: {
      owner: "luminovia-portal-test-" + "a".repeat(24),
      documentId: id(77),
      financial: fixture(),
    },
  };
}

test("document IDs accept exact UUID values and reject arbitrary file or HTTP strings without exposing them", () => {
  for (const value of [
    id(77),
    "ABCDEF01-00AB-4CDE-8F01-0123456789AB",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "00000000-0000-0000-0000-000000000000",
  ])
    assert.equal(canonicalProbeUuid(value), value.toLowerCase());
  for (const value of [
    undefined,
    null,
    {},
    [id(77)],
    77,
    "FICTIONAL_PRIVATE_BYTES",
    id(77) + "\n",
    id(77) + "/../../private",
    "https://example.invalid/" + id(77),
    id(77).slice(1),
  ])
    assert.throws(
      () => canonicalProbeUuid(value),
      (error) => error.message === "A canonical probe UUID is required.",
    );
});

test("one complete bounded ledger round-trips through descriptor-based private reads and never overwrites earlier evidence", (t) => {
  const { directory, file, probe } = ledgerFixture(t);
  writeUpgradeProbeLedger(probe, directory);
  assert.deepEqual(readPrivateJson(file), probe);
  const info = statSync(file);
  assert.equal(info.mode & 0o7777, 0o600);
  assert.equal(info.uid, process.getuid());
  assert.equal(info.nlink, 1);
  assert.throws(() => writeUpgradeProbeLedger(probe, directory), {
    code: "EEXIST",
  });
  assert.deepEqual(readPrivateJson(file), probe);
});

test("incomplete, oversized or malformed-document witnesses cannot create a ledger", (t) => {
  const { directory, file, probe } = ledgerFixture(t);
  for (const invalid of [
    null,
    {},
    { ...probe, documentId: "FICTIONAL_PRIVATE_BYTES" },
    { ...probe, financial: null },
    { ...probe, extra: "x".repeat(64 * 1024) },
  ]) {
    assert.throws(() => writeUpgradeProbeLedger(invalid, directory));
    assert.equal(existsSync(file), false);
  }
  assert.deepEqual(readdirSync(directory), []);
});

test("unsafe parents and pre-existing symlink or hardlink targets are preserved rather than followed or replaced", (t) => {
  const { directory, file, probe } = ledgerFixture(t);
  chmodSync(directory, 0o755);
  assert.throws(
    () => writeUpgradeProbeLedger(probe, directory),
    /owned 0700 directory/,
  );
  assert.equal(existsSync(file), false);
  chmodSync(directory, 0o700);
  const retained = join(directory, "retained.json");
  writeFileSync(retained, '{"retained":true}', { mode: 0o600 });
  symlinkSync(retained, file);
  assert.throws(() => writeUpgradeProbeLedger(probe, directory), {
    code: "EEXIST",
  });
  assert.throws(() => readPrivateJson(file), { code: "ELOOP" });
  rmSync(file);
  linkSync(retained, file);
  assert.throws(() => writeUpgradeProbeLedger(probe, directory), {
    code: "EEXIST",
  });
  assert.throws(() => readPrivateJson(file), /one link/);
  assert.equal(readFileSync(retained, "utf8"), '{"retained":true}');
});

test("an interrupted descriptor write removes its partial ledger before verification can accept it", (t) => {
  const { directory, file, probe } = ledgerFixture(t);
  // The child owns its built-in-module fault injection; other tests retain the real filesystem exports.
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import assert from 'node:assert/strict';
       import fs from 'node:fs';
       import {syncBuiltinESMExports} from 'node:module';
       import {writeUpgradeProbeLedger} from ${JSON.stringify(new URL("./candidate-upgrade-probe.mjs", import.meta.url).href)};
       const write = fs.writeFileSync;
       fs.writeFileSync = (descriptor, bytes) => {
         write(descriptor, bytes.slice(0, 10));
         throw new Error('fictional interrupted write');
       };
       syncBuiltinESMExports();
       assert.throws(() => writeUpgradeProbeLedger(JSON.parse(process.argv[2]), process.argv[1]), /fictional interrupted write/);`,
      directory,
      JSON.stringify(probe),
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.equal(existsSync(file), false);
  assert.equal(readPrivateJson(file), null);
  assert.deepEqual(readdirSync(directory), []);
});

/** Complete fictional snapshots include both legacy net-only and captured commission history. */
function fixture(commissions = true) {
  const claims = (commissions ? [4, 5] : [4]).map((n) => ({
    id: id(n),
    job_id: id(n + 10),
    lecturer_id: id(1),
    status: "confirmed",
    amount: n === 4 ? 89.17 : 100.01,
    total_amount: n === 4 ? 89.17 : 100.01,
    currency: "AUD",
    rate_unit: "fixed_total",
    contract_id: id(2),
    terms: "Exact original accepted conditions.",
    terms_version: 1,
  }));
  const contractDocument = {
    id: id(6),
    versionId: id(8),
    sha256: "a".repeat(64),
  };
  const invoiceDocument = {
    id: id(7),
    versionId: id(9),
    sha256: "b".repeat(64),
  };
  const witness = {
    version: 1,
    ids: {
      actorId: id(1),
      contractId: id(2),
      invoiceId: id(3),
      claimIds: claims.map((row) => row.id),
      commissionedClaimId: commissions ? id(5) : null,
    },
    contractDocument,
    invoiceDocument,
    ownClaims: structuredClone(claims),
    contract: {
      id: id(2),
      document_version_id: id(8),
      sha256: contractDocument.sha256,
    },
    invoice: {
      id: id(3),
      total_amount: commissions ? 189.18 : 89.17,
      currency: "AUD",
      status: "submitted",
      document_version_id: id(9),
    },
    commission: commissions
      ? [
          {
            claim_id: id(5),
            gross_total_amount: 271.83,
            platform_total_amount: 171.82,
            lecturer_net_total_amount: 100.01,
          },
        ]
      : [],
    database: {
      claims,
      sessions: claims.flatMap((row, index) =>
        [0, 1].map((day) => ({
          id: id(20 + index * 2 + day),
          claim_id: row.id,
          lecturer_id: id(1),
          starts_at: `2039-01-0${1 + index * 3 + day}T08:00:00+00:00`,
          ends_at: `2039-01-0${1 + index * 3 + day}T09:00:00+00:00`,
          released_at: null,
        })),
      ),
      contracts: [{ id: id(2), user_id: id(1), document_version_id: id(8) }],
      receipts: [
        {
          id: id(10),
          contract_id: id(2),
          user_id: id(1),
          document_sha256: contractDocument.sha256,
        },
      ],
      invoices: [
        {
          id: id(3),
          user_id: id(1),
          total_amount: commissions ? 189.18 : 89.17,
          currency: "AUD",
          status: "submitted",
          document_version_id: id(9),
        },
      ],
      items: claims.map((row) => ({
        claim_id: row.id,
        invoice_id: id(3),
        active: true,
      })),
      payments: [],
      versions: [contractDocument, invoiceDocument].map((doc) => ({
        id: doc.versionId,
        document_id: doc.id,
        status: "clean",
        sha256: doc.sha256,
      })),
      revenue: commissions
        ? [
            {
              claim_id: id(5),
              job_id: id(15),
              currency: "AUD",
              gross_total_amount: 271.83,
              platform_total_amount: 171.82,
              lecturer_net_total_amount: 100.01,
              platform_percent: 63.21,
            },
          ]
        : [],
    },
  };
  witness.acceptedDigests = digests(witness.database);
  witness.ownInvoiceRows = structuredClone(witness.database.invoices);
  return witness;
}
/** Hash the stable term and exact allocation endpoints, independently of future schema columns. */
function digests(database) {
  return database.claims.map((claim) => ({
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
}

test("import is inert and complete pre-upgrade financial evidence is mandatory", () => {
  for (const missing of [
    undefined,
    {},
    { version: 1 },
    { version: 1, ids: { claimIds: [] } },
  ])
    assert.throws(() => assertFinancialWitness(missing));
  for (const commissions of [false, true]) {
    const before = fixture(commissions);
    assert.doesNotThrow(() => assertFinancialWitness(before));
    assert.doesNotThrow(() =>
      assertRetainedFinancialWitness(before, structuredClone(before)),
    );
  }
});

test("a genuine extra schema column is compatible while missing or changed old values are not", () => {
  const before = fixture();
  const after = structuredClone(before);
  after.database.claims.forEach((row) => {
    row.new_future_column = "default";
  });
  after.ownClaims.forEach((row) => {
    row.new_future_column = "default";
  });
  assert.doesNotThrow(() => assertRetainedFinancialWitness(before, after));
  delete after.database.claims[0].terms_version;
  assert.throws(() => assertRetainedFinancialWitness(before, after));
});

for (const [label, change] of [
  [
    "accepted amount",
    (w) => {
      w.database.claims[0].amount = 89.18;
      w.ownClaims[0].amount = 89.18;
    },
  ],
  [
    "currency",
    (w) => {
      w.database.claims[0].currency = "EUR";
    },
  ],
  [
    "terms",
    (w) => {
      w.database.claims[0].terms = "Changed original deal";
      w.ownClaims[0].terms = "Changed original deal";
      w.acceptedDigests = digests(w.database);
    },
  ],
  [
    "terms version",
    (w) => {
      w.database.claims[0].terms_version = 2;
      w.ownClaims[0].terms_version = 2;
    },
  ],
  [
    "accepted status",
    (w) => {
      w.database.claims[0].status = "cancelled";
    },
  ],
  [
    "whole block",
    (w) => {
      w.database.sessions.pop();
    },
  ],
  [
    "session instant",
    (w) => {
      w.database.sessions[0].starts_at = "2039-01-01T08:00:00.000001+00:00";
      w.acceptedDigests = digests(w.database);
    },
  ],
  [
    "conserved private split",
    (w) => {
      w.database.revenue[0].platform_total_amount = 171.81;
      w.database.revenue[0].lecturer_net_total_amount = 100.02;
    },
  ],
  [
    "private policy snapshot",
    (w) => {
      w.database.revenue[0].platform_percent = 12.34;
    },
  ],
  [
    "invoice amount",
    (w) => {
      w.database.invoices[0].total_amount = 189.19;
    },
  ],
  [
    "invoice status",
    (w) => {
      w.database.invoices[0].status = "paid";
    },
  ],
  [
    "invoice association",
    (w) => {
      w.database.items[0].active = false;
    },
  ],
  [
    "new payment",
    (w) => {
      w.database.payments.push({ id: id(30), amount: 10, currency: "AUD" });
    },
  ],
  [
    "invoice bytes hash",
    (w) => {
      w.database.versions[1].sha256 = "c".repeat(64);
    },
  ],
  [
    "contract receipt",
    (w) => {
      w.database.receipts = [];
    },
  ],
])
  test("retained verification rejects changed " + label, () => {
    const before = fixture(),
      after = structuredClone(before);
    change(after);
    assert.throws(() => assertRetainedFinancialWitness(before, after));
  });

test("snapshot SQL only observes exact fixture IDs in a read-only transaction", () => {
  const sql = financialSnapshotSql(fixture().ids);
  assert.match(sql, /^begin read only;/);
  assert.match(sql, /private\.claim_revenue_ledger/);
  assert.match(sql, /public\.invoices/);
  assert(!/set_config|set role|insert into|update |delete from/i.test(sql));
  assert.throws(() =>
    financialSnapshotSql({
      ...fixture().ids,
      invoiceId: "'; delete from public.invoices; --",
    }),
  );
  assert(
    !financialSnapshotSql(fixture(false).ids).includes(
      "private.claim_revenue_ledger",
    ),
  );
  assert(
    financialSnapshotSql(fixture(false).ids, true).includes(
      "private.claim_revenue_ledger",
    ),
    "A newly present ledger must not hide guessed legacy revenue rows after upgrade",
  );
});

test("financial PDFs have actual object/xref offsets and bounded text", () => {
  const bytes = financialProbePdf("Fictional existing record.");
  const text = bytes.toString();
  assert.match(text, /^%PDF-1.7/);
  const offset = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.equal(bytes.subarray(offset, offset + 4).toString(), "xref");
  assert.match(text, /\/Type \/Catalog/);
  assert.throws(() => financialProbePdf("unsafe (PDF) operators"));
});

/** Controlled SDK boundary records API ownership/order; no SQL business writes are simulated. */
function apiFixture({ commissions = true, failure } = {}) {
  const trace = [],
    state = fixture(commissions);
  const manager = {
    rpc: async (name, args) => {
      trace.push({ actor: "manager", name, args });
      if (failure === name)
        return {
          data: null,
          error: {
            code: "22023",
            message: "Rejected actual business operation",
          },
        };
      const data =
        name === "register_executed_contract"
          ? id(2)
          : name === "create_job"
            ? id(14)
            : name === "create_commission_job"
              ? id(15)
              : null;
      return { data, error: null };
    },
  };
  let claimed = 0;
  const lecturer = {
    rpc: async (name, args) => {
      trace.push({ actor: "lecturer", name, args });
      if (failure === name) return { data: null, error: { code: "42501" } };
      const data =
        name === "job_offers"
          ? [
              {
                id: id(14),
                amount: 89.17,
                total_amount: 89.17,
                terms_version: 1,
              },
              {
                id: id(15),
                amount: 100.01,
                total_amount: 100.01,
                terms_version: 1700003,
              },
            ]
          : name === "claim_job"
            ? {
                status:
                  failure === "unconfirmed" ? "terms_changed" : "confirmed",
                claim_id: id(4 + claimed++),
              }
            : name === "submit_invoice"
              ? id(3)
              : id(10);
      return { data, error: null };
    },
  };
  return {
    trace,
    options: {
      actorId: id(1),
      lecturer,
      manager,
      commissions,
      upload: async (who, bytes, kind, subject) => {
        trace.push({
          actor: who === manager ? "manager" : "lecturer",
          name: "upload",
          kind,
          subject,
        });
        const doc =
          kind === "contract" ? state.contractDocument : state.invoiceDocument;
        doc.sha256 = hash(bytes);
        state.database.versions.find((row) => row.id === doc.versionId).sha256 =
          doc.sha256;
        return doc;
      },
      collect: async (skeleton) => {
        trace.push({ name: "collect" });
        return { ...state, ...skeleton };
      },
    },
  };
}

test("pre-upgrade creation uses scanned evidence, real business callers and the exact quote token before invoice/snapshot", async () => {
  const { options, trace } = apiFixture();
  const before = await createFinancialWitness(options);
  assertFinancialWitness(before);
  const names = trace.map((row) => row.name);
  assert.deepEqual(names, [
    "upload",
    "register_executed_contract",
    "acknowledge_contract",
    "create_job",
    "job_offers",
    "claim_job",
    "create_commission_job",
    "job_offers",
    "claim_job",
    "upload",
    "submit_invoice",
    "collect",
  ]);
  assert.equal(
    trace.find((row) => row.name === "register_executed_contract").actor,
    "manager",
  );
  assert.equal(
    trace.find((row) => row.name === "submit_invoice").actor,
    "lecturer",
  );
  const claims = trace.filter((row) => row.name === "claim_job");
  assert.deepEqual(
    claims.map((row) => row.args.p_terms_version),
    [1, 1700003],
  );
  assert(
    claims.every(
      (row) =>
        !Object.hasOwn(row.args, "p_user_id") &&
        !Object.hasOwn(row.args, "p_lecturer_id"),
    ),
  );
  assert(
    !Object.hasOwn(
      trace.find((row) => row.name === "create_commission_job").args,
      "p_platform_percent",
    ),
  );
  assert(!names.includes("configure_compensation_policy"));
});

for (const failure of [
  "register_executed_contract",
  "create_commission_job",
  "job_offers",
  "unconfirmed",
  "submit_invoice",
])
  test(
    "a rejected " + failure + " cannot produce a financial retention witness",
    async () => {
      const { options, trace } = apiFixture({ failure });
      await assert.rejects(createFinancialWitness(options));
      assert(!trace.some((row) => row.name === "collect"));
    },
  );

test("a pre-commission baseline still requires an accepted legacy claim and actual invoice", async () => {
  const { options, trace } = apiFixture({ commissions: false });
  options.offerProjectionAvailable = false;
  options.lecturer.from = (table) => {
    trace.push({ name: "exact-legacy-quote", table });
    return {
      select: () => ({
        eq: (_column, job) => ({
          single: async () => ({
            data: {
              id: job,
              amount: 89.17,
              total_amount: 89.17,
              terms_version: 1,
            },
            error: null,
          }),
        }),
      }),
    };
  };
  const before = await createFinancialWitness(options);
  assert.equal(before.ids.claimIds.length, 1);
  assert(trace.some((row) => row.name === "submit_invoice"));
  assert(!trace.some((row) => row.name === "create_commission_job"));
  assert(!trace.some((row) => row.name === "job_offers"));
  assert(
    trace.some(
      (row) => row.name === "exact-legacy-quote" && row.table === "jobs",
    ),
  );
});
test("older commissioned baselines use their exact authorized net quote when no private role-pricing model exists", async () => {
  const { options, trace } = apiFixture();
  options.offerProjectionAvailable = false;
  options.rolePricingAvailable = false;
  options.lecturer.from = (table) => {
    assert.equal(table, "jobs");
    return {
      select: () => ({
        eq: (_column, job) => ({
          single: async () => ({
            data: {
              id: job,
              amount: job === id(14) ? 89.17 : 100.01,
              total_amount: job === id(14) ? 89.17 : 100.01,
              terms_version: 1,
            },
            error: null,
          }),
        }),
      }),
    };
  };
  assertFinancialWitness(await createFinancialWitness(options));
  assert(trace.some((row) => row.name === "create_commission_job"));
  assert(!trace.some((row) => row.name === "job_offers"));
});
test("missing actor quote projection on a private role-pricing schema cannot fall back to raw sentinels", async () => {
  const { options, trace } = apiFixture();
  options.offerProjectionAvailable = false;
  options.rolePricingAvailable = true;
  await assert.rejects(createFinancialWitness(options), /actor quote API/);
  assert.deepEqual(trace, []);
});

test("the candidate-owned probe remains the two-phase witness and precedes candidate-only bootstrap", () => {
  const source = readFileSync(
    new URL("./selfhost-candidate-check.mjs", import.meta.url),
    "utf8",
  );
  const creation = source.indexOf('[probe, "--create"]');
  const upgrade = source.indexOf("stageSource(candidateRoot)");
  const verification = source.indexOf('[probe, "--verify"]');
  const bootstrap = source.indexOf(
    "// The retained baseline can predate candidate-only commercial settings.",
  );
  assert(
    creation > 0 &&
      creation < upgrade &&
      upgrade < verification &&
      verification < bootstrap,
  );
  assert.match(source, /retainedAcceptedClaimsAndInvoices: true/);
  assert.match(source, /acceptedFinancialSnapshotsExact: true/);
});
