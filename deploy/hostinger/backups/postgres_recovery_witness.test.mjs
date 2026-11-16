/**
 * Isolated recovery-witness cases use fictional image digests and migration inventories. Reject changed history, incomplete proof and wrong images before restoring.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { checkedDatabaseImage } from "../restore-check.mjs";
import { verifyRestoredRecoveryInventory } from "./postgres_recovery_witness.mjs";
// Compute a stable SHA-256 digest for the source/artifact comparison.
const hash = (v) => createHash("sha256").update(v).digest("hex");
const target = "supabase/postgres:17.13.0.000@sha256:" + "a".repeat(64);
const source = "supabase/postgres:17.12.0.000@sha256:" + "b".repeat(64);
// Fictional guard fixtures only: no newer image is downloaded or claimed tested.
// Build fictional completed image/migration proof; this unit fixture does not claim a downloaded candidate was tested.
function witness() {
  const first = {
    path: "supabase/migrations/20260101000000_first.sql",
    sha256: hash("first SQL"),
  };
  const appended = {
    path: "supabase/migrations/20260102000000_second.sql",
    sha256: hash("second SQL"),
  };
  const proof = {
    schemaVersion: 1,
    postgresMajor: 17,
    requiresLiveDataPreflight: true,
    sourceCommit: "c".repeat(40),
    sourceImage: source,
    targetImage: target,
    migrationInventory: [first],
    migrationInventorySha256: hash(JSON.stringify([first])),
    validation: {
      kind: "isolated-selfhost-upgrade-fixture",
      passed: true,
      migrationSourcesExact: true,
      existingCredentialsAndFileExact: true,
      roleAndMembershipExact: true,
    },
  };
  const proofText = JSON.stringify(proof),
    proofPath =
      "opt/luminovia-portal/source/deploy/hostinger/selfhost/postgres-candidate-proof.json",
    imageId = "sha256:" + "d".repeat(64);
  return {
    format: "luminovia-complete-backup-v1",
    image: target,
    postgresRecoveryEvidence: {
      format: "luminovia-installed-postgres-recovery-proof-v1",
      proofPath,
      proofText,
      proofSha256: hash(proofText),
      appliedMigrationInventory: [first, appended],
    },
    files: [
      {
        path: proofPath,
        type: "file",
        sha256: hash(proofText),
        bytes: Buffer.byteLength(proofText),
      },
      ...[first, appended].map((e) => ({
        path: "opt/luminovia-portal/source/" + e.path,
        type: "file",
        sha256: e.sha256,
      })),
    ],
    containerConfiguration: [
      {
        Name: "/luminovia-supabase-db-1",
        Image: imageId,
        State: { Running: true },
        Config: {
          Image: target,
          Labels: {
            "com.docker.compose.project": "luminovia-supabase",
            "com.docker.compose.service": "db",
          },
        },
      },
    ],
    imageInventory: [
      {
        Id: imageId,
        RepoDigests: ["supabase/postgres@" + target.split("@")[1]],
      },
    ],
  };
}
test("legacy factory rejects an unknown exact pin unless its complete-set witness passes", () => {
  assert.throws(() => checkedDatabaseImage(target));
  assert.equal(
    checkedDatabaseImage(target, { recoveryEvidence: witness() }),
    target,
  );
});
test("proof target, flags, prefix, physical sources and actual installed image are all required", () => {
  const cases = [
    (c) => {
      c.image = source;
    },
    (c) => {
      c.postgresRecoveryEvidence.proofSha256 = "e".repeat(64);
    },
    (c) => {
      c.postgresRecoveryEvidence.appliedMigrationInventory[0].sha256 =
        "f".repeat(64);
    },
    (c) => {
      c.files.pop();
    },
    (c) => {
      c.containerConfiguration[0].Config.Image = source;
    },
    (c) => {
      c.imageInventory[0].Id = "sha256:" + "e".repeat(64);
    },
    (c) => {
      c.imageInventory[0].RepoDigests = [];
    },
    (c) => {
      c.postgresRecoveryEvidence.appliedMigrationInventory.reverse();
    },
    (c) => {
      const p = JSON.parse(c.postgresRecoveryEvidence.proofText);
      p.validation.passed = false;
      const t = JSON.stringify(p);
      c.postgresRecoveryEvidence.proofText = t;
      c.postgresRecoveryEvidence.proofSha256 = hash(t);
      c.files[0].sha256 = hash(t);
      c.files[0].bytes = Buffer.byteLength(t);
    },
  ];
  for (const mutate of cases) {
    const c = witness();
    mutate(c);
    assert.throws(() => checkedDatabaseImage(target, { recoveryEvidence: c }));
  }
  assert.throws(() =>
    checkedDatabaseImage(target.replace(":17.", ":18."), {
      recoveryEvidence: witness(),
    }),
  );
  assert.throws(() =>
    checkedDatabaseImage("supabase/postgres:latest", {
      recoveryEvidence: witness(),
    }),
  );
});
test("the eventual restored ledger must match every current source, including appended history", async () => {
  const rows = [
    { version: "20260101000000", source: "first SQL", statementCount: 1 },
    { version: "20260102000000", source: "second SQL", statementCount: 1 },
  ];
  const database = { sql: async () => JSON.stringify(rows) };
  assert.equal(
    await verifyRestoredRecoveryInventory(database, witness()),
    true,
  );
  rows[1].source = "changed SQL";
  await assert.rejects(verifyRestoredRecoveryInventory(database, witness()));
  assert.equal(await verifyRestoredRecoveryInventory(database, {}), false);
});
