import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { repository } from "./backup.mjs";
import {
  applyReviewedBackfill,
  buildBackfillSQL,
  loadReviewedSources,
  reviewedMigrations,
} from "./reviewed-m3-backfill.mjs";

async function history() {
  const files = await readdir(resolve(repository, "supabase/migrations"));
  return Promise.all(
    files
      .filter((file) => !reviewedMigrations.some((item) => item.file === file))
      .map(async (file) => ({
        version: file.slice(0, 14),
        source: await readFile(
          resolve(repository, "supabase/migrations", file),
          "utf8",
        ),
      })),
  );
}

test("only exact reviewed source bytes can form the single atomic backfill", async () => {
  const sources = await loadReviewedSources();
  const sql = buildBackfillSQL(sources, await history());
  assert(sql.startsWith("BEGIN;\nSET LOCAL lock_timeout="));
  assert(sql.endsWith("COMMIT;\n"));
  for (const item of sources)
    assert(
      sql.includes(
        "$reviewed_m3_" +
          item.version +
          "$" +
          item.source +
          "$reviewed_m3_" +
          item.version +
          "$",
      ),
    );
  assert(
    sql.indexOf("cms_m3_preserved") <
      sql.indexOf("alter table public.user_roles"),
  );
  assert(
    sql.indexOf("Reviewed backfill changed existing protected data") >
      sql.indexOf("create function public.complete_account_invitation"),
  );
  assert.throws(
    () =>
      buildBackfillSQL(
        [{ ...sources[0], source: sources[0].source + "\n" }],
        [],
      ),
    /exact reviewed/,
  );
});
test("changed file hash is refused before database access", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "luminovia-reviewed-m3-"));
  try {
    await mkdir(resolve(root, "supabase/migrations"), { recursive: true });
    const item = reviewedMigrations[0];
    await writeFile(
      resolve(root, "supabase/migrations", item.file),
      "BEGIN; SELECT 'changed'; COMMIT;\n",
    );
    await assert.rejects(loadReviewedSources(root), /source hash differs/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unexpected, missing and partial history cannot execute a migration", async () => {
  const baseline = await history();
  const sources = await loadReviewedSources();
  for (const rows of [
    baseline.slice(1),
    [...baseline, { version: "20990101000000", source: "unreviewed" }],
    [...baseline, sources[0]],
  ]) {
    let calls = 0;
    await assert.rejects(
      applyReviewedBackfill(async () => {
        calls++;
        return JSON.stringify(rows);
      }),
    );
    assert.equal(calls, 1);
  }
});

test("already applied exact history is checked without SQL mutation", async () => {
  const rows = [...(await history()), ...(await loadReviewedSources())];
  let calls = 0;
  const result = await applyReviewedBackfill(async () => {
    calls++;
    return JSON.stringify(rows);
  });
  assert.deepEqual(result, { status: "already_applied", migrations: 14 });
  assert.equal(calls, 1);
});

test("CLI refuses missing development flag before reaching SSH", () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [resolve(repository, "deploy/hostinger/reviewed-m3-backfill.mjs")],
        { stdio: "pipe" },
      ),
    (error) => error.status === 1 && !String(error.stderr).includes("password"),
  );
});
