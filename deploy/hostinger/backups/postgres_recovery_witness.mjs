/**
 * Bindet ein späteres PostgreSQL-Image an seinen tatsächlich abgeschlossenen Kompatibilitätsnachweis und exakte historische Migrationsquellen. Ein Tag oder eine passende Major-Version allein reicht dafür nicht.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
// Berechnet SHA-256; verglichen werden exakte Bytes statt nur Versionsbezeichnungen.
const sha = (value) => createHash("sha256").update(value).digest("hex");
const imagePattern =
  /^supabase\/postgres:17\.\d+\.\d+\.\d+@sha256:[a-f0-9]{64}$/;
const proofPath =
  "opt/luminovia-portal/source/deploy/hostinger/selfhost/postgres-candidate-proof.json";
// Bindet Reihenfolge, Pfade und Quellenhashes des Migrationsinventars an einen Digest.
const inventoryHash = (inventory) => sha(JSON.stringify(inventory));
// Prüft die enge Struktur und Reihenfolge eines Migrationsinventars vor dessen Verwendung als Recovery-Beleg.
const validInventory = (entries) =>
  Array.isArray(entries) &&
  entries.length > 0 &&
  entries.length <= 10000 &&
  entries.every(
    (e, i) =>
      e &&
      JSON.stringify(Object.keys(e).sort()) ===
        JSON.stringify(["path", "sha256"]) &&
      /^supabase\/migrations\/\d{14}_[a-z0-9_]+\.sql$/.test(e.path) &&
      /^[a-f0-9]{64}$/.test(e.sha256) &&
      (i === 0 || entries[i - 1].path < e.path),
  );

// This is an explicit recovery witness from an authenticated complete set,
// never a global allowlist update or permission to pull arbitrary latest tags.
// Erlaubt ein späteres Image nur mit exakt passendem abgeschlossenem Kompatibilitätsbeleg und unveränderter historischer Quellenkette.
export function validateRecoveryImageWitness(image, catalog) {
  assert(
    imagePattern.test(image),
    "Recovery evidence only permits immutable PostgreSQL17 images.",
  );
  assert.equal(catalog?.format, "luminovia-complete-backup-v1");
  assert.equal(catalog.image, image);
  const evidence = catalog.postgresRecoveryEvidence;
  assert.equal(
    evidence?.format,
    "luminovia-installed-postgres-recovery-proof-v1",
  );
  assert.equal(evidence.proofPath, proofPath);
  assert(
    typeof evidence.proofText === "string" &&
      evidence.proofText.length <= 1024 * 1024,
  );
  assert.equal(sha(evidence.proofText), evidence.proofSha256);
  const savedProof = catalog.files?.filter((f) => f.path === proofPath);
  assert.equal(savedProof?.length, 1);
  assert.equal(savedProof[0].type, "file");
  assert.equal(savedProof[0].sha256, evidence.proofSha256);
  assert.equal(savedProof[0].bytes, Buffer.byteLength(evidence.proofText));
  const proof = JSON.parse(evidence.proofText);
  assert(
    proof.schemaVersion === 1 &&
      proof.postgresMajor === 17 &&
      proof.requiresLiveDataPreflight === true &&
      /^[a-f0-9]{40}$/.test(proof.sourceCommit),
  );
  assert(
    imagePattern.test(proof.sourceImage) &&
      imagePattern.test(proof.targetImage) &&
      proof.sourceImage !== proof.targetImage,
  );
  assert.equal(proof.targetImage, image);
  assert.equal(proof.validation?.kind, "isolated-selfhost-upgrade-fixture");
  for (const flag of [
    "passed",
    "migrationSourcesExact",
    "existingCredentialsAndFileExact",
    "roleAndMembershipExact",
  ])
    assert.equal(proof.validation[flag], true);
  const applied = evidence.appliedMigrationInventory,
    proven = proof.migrationInventory;
  assert(validInventory(applied) && validInventory(proven));
  assert.equal(inventoryHash(proven), proof.migrationInventorySha256);
  assert(proven.length <= applied.length);
  assert.deepEqual(
    proven,
    applied.slice(0, proven.length),
    "The completed proof must match an unchanged historical migration prefix.",
  );
  // Bind every applied SQL source to its physical captured deployed file too.
  for (const entry of applied) {
    const file = catalog.files.filter(
      (f) => f.path === "opt/luminovia-portal/source/" + entry.path,
    );
    assert.equal(file.length, 1);
    assert.equal(file[0].type, "file");
    assert.equal(file[0].sha256, entry.sha256);
  }
  const databases = catalog.containerConfiguration?.filter(
    (row) => row.Name === "/luminovia-supabase-db-1",
  );
  assert.equal(databases?.length, 1);
  const database = databases[0];
  assert.equal(database.Config?.Image, image);
  assert.equal(database.State?.Running, true);
  assert.equal(
    database.Config?.Labels?.["com.docker.compose.project"],
    "luminovia-supabase",
  );
  assert.equal(database.Config?.Labels?.["com.docker.compose.service"], "db");
  assert(/^sha256:[a-f0-9]{64}$/.test(database.Image));
  const images = catalog.imageInventory?.filter(
    (row) => row.Id === database.Image,
  );
  assert.equal(images?.length, 1);
  assert(
    images[0].RepoDigests?.includes("supabase/postgres@" + image.split("@")[1]),
  );
  return image;
}

// Liest die tatsächliche wiederhergestellte Migrationshistorie und vergleicht sie mit dem Recovery-Katalog.
export async function verifyRestoredRecoveryInventory(database, catalog) {
  const expected = catalog.postgresRecoveryEvidence?.appliedMigrationInventory;
  if (!expected) return false; // Original approved historical backup format.
  const rows = JSON.parse(
    await database.sql(
      "select json_agg(json_build_object('version',version,'source',statements[1],'statementCount',cardinality(statements)) order by version) from supabase_migrations.schema_migrations;",
    ),
  );
  assert(Array.isArray(rows) && rows.length === expected.length);
  for (let i = 0; i < rows.length; i++) {
    assert.equal(rows[i].version, expected[i].path.match(/\/(\d{14})_/)[1]);
    assert.equal(rows[i].statementCount, 1);
    assert.equal(typeof rows[i].source, "string");
    assert.equal(
      sha(rows[i].source),
      expected[i].sha256,
      "Restored live migration sources differ from the image witness.",
    );
  }
  return true;
}
