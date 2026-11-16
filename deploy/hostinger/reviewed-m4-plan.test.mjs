/**
 * Deterministic source-bound M4 planning cases check exact history, release inventory and digest without mutating hosted data.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createM4ReviewPlan,
  loadM4ReviewContext,
  reviewedM4,
} from "./reviewed-m4-plan.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const context = await loadM4ReviewContext();
// Build the exact historical state for the successful or deliberately corrupted plan case.
const history = (full = false) =>
  [...context.baseline, ...(full ? context.pending : [])].map(
    ({ version, source }) => ({ version, source }),
  );
// Build the synthetic release inventory whose individual fields the cases modify.
function manifest() {
  const sources = [...context.baseline, ...context.pending];
  return {
    schemaVersion: 1,
    repository: "Luminovia-Training-Consulting/Luminovia-Management-Tool",
    branch: "main",
    commit: "a".repeat(40),
    migrations: sources.map(({ file, version, sha256 }) => ({
      path: "supabase/migrations/" + file,
      version,
      sha256,
    })),
    files: [
      ...sources.map(({ file, source, sha256 }) => ({
        path: "supabase/migrations/" + file,
        sha256,
        size: Buffer.byteLength(source),
      })),
      ...context.runtime,
    ],
  };
}
// Join this fixture's history and synthetic manifest for the read-only planner.
const plan = (h = history(), m = manifest()) =>
  createM4ReviewPlan({ history: h, manifest: m }, context);
test("exact14 to17 plan reports the two blocked migration reasons without changing automatic policy", () => {
  const result = plan();
  assert.equal(result.status, "operator_review_required");
  assert.equal(result.baselineCount, 14);
  assert.equal(result.resultCount, 17);
  assert.equal(
    result.pending.filter((item) => !item.automaticEligible).length,
    2,
  );
  assert.equal(result.automaticPolicyChanged, false);
  assert.equal(result.automaticInstallationEligible, false);
  assert.deepEqual(
    result.pending.map((item) => item.sha256),
    reviewedM4.map((item) => item.sha256),
  );
  assert(
    context.runtime.some((item) => item.path.endsWith("/avatar-download.ts")),
  );
});
test("exact completed17 history is recognised without offering another apply action", () => {
  const result = plan(history(true));
  assert.equal(result.status, "already_applied");
  assert.deepEqual(result.pending, []);
  assert(!("sql" in result));
  assert(!("apply" in result));
});
test("missing, duplicate, partial and extra future history is refused", () => {
  for (const rows of [
    history().slice(1),
    [...history(), history()[0]],
    [...history(), context.pending[0]],
    [...history(true), { version: "20270101000000", source: "future" }],
  ])
    assert.throws(() => plan(rows));
  const rows = history();
  rows[0] = { ...rows[0], password: "not a migration field" };
  assert.throws(() => plan(rows));
});
test("changed baseline or completed M4 historical source is refused", () => {
  for (const full of [false, true]) {
    const rows = history(full);
    rows[full ? 16 : 0].source += "\n";
    assert.throws(() => plan(rows), /History is missing or differs/);
  }
});
test("release identity, extra migrations, altered files and missing runtime helpers are refused", () => {
  const wrong = manifest();
  wrong.branch = "feature";
  assert.throws(() => plan(history(), wrong));
  const extra = manifest();
  extra.migrations.push({
    version: "20270101000000",
    path: "supabase/migrations/20270101000000_future.sql",
    sha256: "f".repeat(64),
  });
  assert.throws(() => plan(history(), extra));
  const changed = manifest();
  changed.files.find((item) => item.path.endsWith(reviewedM4[0].file)).sha256 =
    "f".repeat(64);
  assert.throws(() => plan(history(), changed));
  const missing = manifest();
  missing.files = missing.files.filter(
    (item) => !item.path.endsWith("/avatar-download.ts"),
  );
  assert.throws(() => plan(history(), missing), /runtime helper missing/);
  const duplicate = manifest();
  duplicate.files.push(duplicate.files[0]);
  assert.throws(() => plan(history(), duplicate), /duplicate/);
});
test("source pins reject changed/missing/unreviewed past source while a future M5 file does not redefine this historical fixture", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "luminovia-m4-plan-"));
  try {
    await mkdir(resolve(root, "supabase/migrations"), { recursive: true });
    await mkdir(resolve(root, "supabase/functions"), { recursive: true });
    for (const item of [...context.baseline, ...context.pending])
      await copyFile(
        resolve(repository, "supabase/migrations", item.file),
        resolve(root, "supabase/migrations", item.file),
      );
    await writeFile(
      resolve(root, "supabase/migrations/20270101000000_future.sql"),
      "BEGIN; SELECT 1; COMMIT;",
    );
    assert.equal((await loadM4ReviewContext(root)).pending.length, 3);
    const file = resolve(root, "supabase/migrations", reviewedM4[0].file),
      original = await readFile(file);
    await writeFile(file, Buffer.concat([original, Buffer.from("\n")]));
    await assert.rejects(loadM4ReviewContext(root), /hash differs/);
    await writeFile(file, original);
    const extra = resolve(
      root,
      "supabase/migrations/20261115155100_unreviewed.sql",
    );
    await writeFile(extra, "BEGIN; SELECT 1; COMMIT;");
    await assert.rejects(loadM4ReviewContext(root), /exactly the pinned/);
    await rm(extra);
    await rm(file);
    await assert.rejects(loadM4ReviewContext(root), /exactly the pinned/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("the actual ordinary updater still rejects avatar constraint replacement and CBW DO, accepting comment DDL", () => {
  const script = `import importlib.util,json,sys\nspec=importlib.util.spec_from_file_location('review_guard',sys.argv[1]);u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)\nrows=[]\nfor item in json.load(sys.stdin):\n try:\n  u.compatible_migration(item['source']);rows.append(True)\n except u.UpdateError:\n  rows.append(False)\nprint(json.dumps(rows))\n`;
  const result = execFileSync(
    "python3",
    ["-c", script, resolve(repository, "deploy/hostinger/updates/updater.py")],
    { input: JSON.stringify(context.pending), encoding: "utf8" },
  );
  assert.deepEqual(JSON.parse(result), [false, true, false]);
});
test("CLI accepts no apply or implicit hosted mode", () => {
  for (const args of [[], ["--apply", "true"], ["--once", "true"]])
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            resolve(repository, "deploy/hostinger/reviewed-m4-plan.mjs"),
            ...args,
          ],
          { stdio: "pipe" },
        ),
      (error) =>
        error.status === 1 && !String(error.stderr).includes("password"),
    );
});
