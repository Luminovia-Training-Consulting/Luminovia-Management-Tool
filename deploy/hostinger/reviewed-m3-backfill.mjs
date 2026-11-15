import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { collectCommand, repository, summarySQL } from "./backup.mjs";
import {
  candidateDatabaseImage,
  createIsolatedDatabase,
  inspectBackup,
  streamIntoContainer,
} from "./restore-check.mjs";

// One reviewed exception for PR#3, which arrived after the development VPS's
// capacity migration. The ordinary updater must still reject backdated SQL.
export const reviewedMigrations = [
  [
    "20261115141620_client_commission_revenue.sql",
    "a8c21842308c506a5c0efa044f5030a075c925e04e1839edb2a98864a4ec00e2",
  ],
  [
    "20261115141740_profiles_labels_reviews_enrolment.sql",
    "88cbe4029ad6a21192030c22f1c9df4626e3bed5c01d5de0e043dd11fed73e98",
  ],
  [
    "20261115141856_account_roles_and_api.sql",
    "07b7806b854b50d4d00d96a23236c97b42d280025e99cec10c793936084f1e02",
  ],
].map(([file, sha256]) => ({
  file,
  sha256,
  version: file.slice(0, 14),
  name: file.slice(15, -4),
}));
const baselineVersions = [
  "20261115111133",
  "20261115112053",
  "20261115113559",
  "20261115121732",
  "20261115121922",
  "20261115123659",
  "20261115123853",
  "20261115125144",
  "20261115125912",
  "20261115132410",
  "20261115142130",
];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const historySQL =
  "select coalesce(json_agg(json_build_object('version',version,'source',statements[1]) order by version),'[]'::json)::text from supabase_migrations.schema_migrations;";
function quoted(value) {
  return "'" + value.replaceAll("'", "''") + "'";
}
function dollar(value, suffix) {
  const delimiter = "$reviewed_m3_" + suffix + "$";
  assert(!value.includes(delimiter), "Unexpected reviewed source delimiter.");
  return delimiter + value + delimiter;
}

export async function loadReviewedSources(root = repository) {
  const sources = [];
  for (const item of reviewedMigrations) {
    const file = resolve(root, "supabase/migrations", item.file);
    const state = await lstat(file);
    assert(
      state.isFile() && !state.isSymbolicLink(),
      "Reviewed source must be a regular file.",
    );
    const source = await readFile(file, "utf8");
    assert.equal(
      hash(source),
      item.sha256,
      "Reviewed M3 source hash differs: " + item.version,
    );
    assert.match(source, /^begin;\s*/i);
    assert.match(source, /\ncommit;\s*$/i);
    sources.push({ ...item, source });
  }
  return sources;
}

// Fingerprint every pre-existing data column in auth/public/private/storage.
// Newly added columns are intentionally excluded. Existing permission grants
// are checked as a subset because PR#3 deliberately adds catalog permissions.
const preserveBeforeSQL = `
create temporary table cms_m3_preserved(query text not null, fingerprint text not null) on commit drop;
create temporary table cms_m3_permissions on commit drop as select role,permission from public.role_permissions;
do $preserve$ declare r record; columns text; query text; fingerprint text; begin
 if pg_database_size(current_database()) > 1073741824 then raise exception 'Reviewed development backfill size limit exceeded'; end if;
 for r in select n.nspname,c.relname,c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','public','private','storage') and c.relkind in ('r','p') and not (n.nspname='public' and c.relname='role_permissions') order by n.nspname,c.relname loop
  select string_agg(format('%I',attname),',' order by attnum) into columns from pg_attribute where attrelid=r.oid and attnum>0 and not attisdropped;
  query=format('select coalesce(md5(string_agg(row_hash, %L order by row_hash)),md5(%L)) from (select md5(row::text) row_hash from (select %s from %I.%I) row) rows','', '',columns,r.nspname,r.relname);
  execute query into fingerprint;
  insert into cms_m3_preserved values(query,fingerprint);
 end loop;
end; $preserve$;
`;
const preserveAfterSQL = `
do $verify$ declare r record; actual text; begin
 for r in select * from cms_m3_preserved loop
  execute r.query into actual;
  if actual is distinct from r.fingerprint then raise exception 'Reviewed backfill changed existing protected data'; end if;
 end loop;
 if exists(select role,permission from cms_m3_permissions except select role,permission from public.role_permissions) then raise exception 'Reviewed backfill removed existing permissions'; end if;
end; $verify$;
`;

export function buildBackfillSQL(pending, history) {
  assert(
    pending.length > 0 &&
      pending.every((item) =>
        reviewedMigrations.some(
          (expected) =>
            expected.version === item.version &&
            expected.sha256 === hash(item.source),
        ),
      ),
    "Only the three exact reviewed sources may run.",
  );
  const expected = history
    .map(
      (item) =>
        "(" +
        quoted(item.version) +
        "," +
        dollar(item.source, item.version) +
        ")",
    )
    .join(",");
  let sql =
    "BEGIN;\nSET LOCAL lock_timeout='15s';\nSELECT pg_advisory_xact_lock(hashtext('luminovia.schema_migrations'));\n";
  sql +=
    "DO $history$ BEGIN IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> " +
    history.length +
    " OR EXISTS (SELECT version,source FROM (VALUES " +
    expected +
    ") expected(version,source) EXCEPT SELECT version,statements[1] FROM supabase_migrations.schema_migrations) THEN RAISE EXCEPTION 'Reviewed backfill history changed'; END IF; END; $history$;\n";
  sql += preserveBeforeSQL;
  for (const item of pending) {
    // All three original transactions form one atomic backfill; their complete
    // original file bytes, including BEGIN/COMMIT, remain in the source ledger.
    sql += item.source
      .replace(/^begin;\s*/i, "")
      .replace(/\ncommit;\s*$/i, "\n");
    sql +=
      "\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (" +
      quoted(item.version) +
      "," +
      quoted(item.name) +
      ",ARRAY[" +
      dollar(item.source, item.version) +
      "]);\n";
  }
  return sql + preserveAfterSQL + "NOTIFY pgrst, 'reload schema';\nCOMMIT;\n";
}

export async function applyReviewedBackfill(sql, root = repository) {
  const sources = await loadReviewedSources(root);
  const history = JSON.parse(await sql(historySQL));
  assert(Array.isArray(history), "Invalid existing source history.");
  const byVersion = new Map(history.map((item) => [item.version, item.source]));
  assert.equal(byVersion.size, history.length, "Duplicate existing history.");
  const allowed = new Set([
    ...baselineVersions,
    ...sources.map((item) => item.version),
  ]);
  const names = await readdir(resolve(root, "supabase/migrations"));
  for (const version of baselineVersions)
    assert(
      byVersion.has(version),
      "Expected development baseline migration missing.",
    );
  for (const item of history) {
    assert(
      allowed.has(item.version),
      "Unexpected migration outside reviewed development baseline.",
    );
    const matches = names.filter(
      (name) => name.startsWith(item.version + "_") && name.endsWith(".sql"),
    );
    assert.equal(
      matches.length,
      1,
      "Existing migration source is missing or ambiguous.",
    );
    assert.equal(
      await readFile(resolve(root, "supabase/migrations", matches[0]), "utf8"),
      item.source,
      "Existing applied source differs.",
    );
  }
  const pending = sources.filter((item) => !byVersion.has(item.version));
  // A partially applied three-file backfill is not an accepted starting state.
  assert(
    pending.length === 0 || pending.length === 3,
    "Partial M3 backfill requires operator review.",
  );
  if (!pending.length)
    return { status: "already_applied", migrations: history.length };
  await sql(buildBackfillSQL(pending, history));
  const after = JSON.parse(await sql(historySQL));
  assert.equal(after.length, 14);
  for (const item of [...history, ...sources])
    assert.equal(
      after.find((row) => row.version === item.version)?.source,
      item.source,
      "Backfill source ledger differs.",
    );
  return {
    status: "applied",
    migrations: after.length,
    existingDataAndQuotaPreserved: true,
  };
}

export async function backfillRestoreCheck(directory) {
  const { actual, manifest } = await inspectBackup(directory);
  let database;
  try {
    database = await createIsolatedDatabase(candidateDatabaseImage);
    const diagnostic = resolve(actual, "reviewed-m3-backfill-error.stderr");
    const roles = await readFile(resolve(actual, "roles.sql"), "utf8");
    await database.sql(
      roles.replace(/^CREATE ROLE supabase_admin;\r?$/m, ""),
      diagnostic,
    );
    await streamIntoContainer(
      database.name,
      [
        "pg_restore",
        "-U",
        database.operator,
        "-d",
        "postgres",
        "--exit-on-error",
        "--single-transaction",
        "--clean",
        "--if-exists",
      ],
      resolve(actual, "database.dump"),
      diagnostic,
    );
    const before = JSON.parse(await database.sql(summarySQL));
    assert.equal(before.server_version, "17.12");
    assert.deepEqual(before.counts, manifest.summary.counts);
    assert.deepEqual(before.limits, manifest.summary.limits);
    assert(
      before.counts.profiles > 0,
      "Rollback probe needs the existing fictional profiles.",
    );
    const originalHistory = JSON.parse(await database.sql(historySQL));
    const rollbackProbe = buildBackfillSQL(
      await loadReviewedSources(),
      originalHistory,
    ).replace(
      "do $verify$",
      "update public.profiles set display_name=display_name||' rollback probe';\ndo $verify$",
    );
    await assert.rejects(database.sql(rollbackProbe, diagnostic));
    assert.deepEqual(
      JSON.parse(await database.sql(historySQL)),
      originalHistory,
      "Failed preservation check must roll back every new migration.",
    );
    assert.deepEqual(
      JSON.parse(await database.sql(summarySQL)),
      before,
      "Failed backfill must leave source data and schema unchanged.",
    );
    const first = await applyReviewedBackfill((input) =>
      database.sql(input, diagnostic),
    );
    assert.equal(first.status, "applied");
    const second = await applyReviewedBackfill((input) =>
      database.sql(input, diagnostic),
    );
    assert.equal(second.status, "already_applied");
    const after = JSON.parse(await database.sql(summarySQL));
    assert.deepEqual(after.counts, before.counts);
    assert.deepEqual(after.limits, before.limits);
    for (const [table, enabled] of Object.entries(before.rls))
      assert.equal(after.rls[table], enabled);
    assert.equal(after.migrations.length, 14);
    const result = {
      status: "passed",
      checkedAt: new Date().toISOString(),
      image: candidateDatabaseImage,
      method:
        "networkless PostgreSQL17.12 restore of actual development backup; atomic reviewed backfill and idempotent second run",
      migrationsBefore: before.migrations.length,
      migrationsAfter: after.migrations.length,
      allExistingDataColumnsAndQuotaPreserved: true,
      originalHistoryAndThreeSourcesExact: true,
      repeatRunIdempotent: true,
      protectedDataViolationRollsBackAllThree: true,
      reviewedSources: reviewedMigrations,
      limitations: [
        "No live VPS mutation or Auth/Storage/frontend HTTP acceptance in this check.",
        "Only the three hash-pinned PR3 files bypass automatic backdating/destructive guards.",
      ],
    };
    await writeFile(
      resolve(actual, "reviewed-m3-backfill-result.json"),
      JSON.stringify(result, null, 2) + "\n",
      { mode: 0o600 },
    );
    return result;
  } finally {
    if (database) await database.cleanup();
  }
}

async function developmentSql(input) {
  return collectCommand(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "ConnectTimeout=15",
      "root@72.61.20.240",
      "/usr/bin/flock -n /run/lock/luminovia-maintenance.lock docker exec -i luminovia-supabase-db-1 psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1",
    ],
    { input },
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.length === 4 && process.argv[2] === "--restored-backup") {
      console.log(JSON.stringify(await backfillRestoreCheck(process.argv[3])));
      process.exitCode = 0;
    } else {
      assert.deepEqual(
        process.argv.slice(2),
        ["--development-vps"],
        "Use only --development-vps for this reviewed exception.",
      );
      const ready = await collectCommand("ssh", [
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "root@72.61.20.240",
        "test -f /opt/luminovia-portal/www/maintenance.enabled && test \"$(docker inspect --format '{{.State.Running}}' luminovia-supabase-auth-1 luminovia-supabase-rest-1 luminovia-supabase-realtime-1 luminovia-supabase-storage-1 luminovia-supabase-api-gw-1 luminovia-supabase-functions-1 | sort -u)\" = false && printf ready",
      ]);
      assert.equal(
        ready,
        "ready",
        "Stop backend writers and enable CMS maintenance before backfill.",
      );
      console.log(JSON.stringify(await applyReviewedBackfill(developmentSql)));
    }
  } catch {
    console.error(
      "Reviewed development backfill refused or failed; private database output withheld.",
    );
    process.exitCode = 1;
  }
}
