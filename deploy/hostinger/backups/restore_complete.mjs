import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createIsolatedDatabase } from "../restore-check.mjs";
import { collectCommand } from "../backup.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const identifier = (s) => '"' + s.replaceAll('"', '""') + '"';
const literal = (s) => "'" + s.replaceAll("'", "''") + "'";
const normalize = (text, operator) =>
  text
    .split("\n")
    .map((s) => s.trim())
    .filter(
      (s) =>
        s &&
        !s.startsWith("--") &&
        !s.startsWith("\\") &&
        s !== "CREATE ROLE " + operator + ";" &&
        !s.startsWith("ALTER ROLE " + operator + " "),
    )
    .sort();

export async function restoreComplete({
  backup,
  identity,
  age = "age",
  image,
}) {
  const privateRoot = resolve(here, "../../../.local/hostinger");
  await mkdir(privateRoot, { recursive: true, mode: 0o700 });
  const temporary = resolve(privateRoot, "complete-restore-" + randomUUID());
  const diagnostic = resolve(
    privateRoot,
    "complete-restore-" + randomUUID() + ".stderr",
  );
  let database;
  let passed = false;
  try {
    await collectCommand("python3", [
      resolve(here, "unpack_complete.py"),
      "--backup",
      resolve(backup),
      "--identity",
      resolve(identity),
      "--output",
      temporary,
      "--age",
      age,
    ]);
    const catalog = JSON.parse(
      await readFile(resolve(temporary, "catalog.json"), "utf8"),
    );
    const expectedImage = image ?? catalog.image;
    assert.equal(
      expectedImage,
      catalog.image,
      "Complete recovery must first prove the original immutable image. Candidate testing is a separate reviewed procedure.",
    );
    database = await createIsolatedDatabase(expectedImage);
    const globals = await readFile(resolve(temporary, "globals.sql"), "utf8");
    assert(
      globals.length < 8 * 1024 * 1024,
      "Unexpectedly large source globals.",
    );
    await database.sql(
      globals.replace(/^CREATE ROLE supabase_admin;\r?$/m, ""),
      diagnostic,
    );
    const summarySQL = await readFile(
      resolve(here, "database-summary.sql"),
      "utf8",
    );
    for (const source of catalog.databases) {
      assert(
        typeof source.name === "string" &&
          source.name.length > 0 &&
          source.name.length <= 63,
      );
      assert.match(source.part, /^database-\d{3}\.dump\.age$/);
      const exists = await database.sql(
        "select exists(select 1 from pg_database where datname=" +
          literal(source.name) +
          ")::text;",
      );
      if (exists !== "true") {
        assert.equal(source.encoding, "UTF8");
        const locale =
          source.localeProvider === "i"
            ? "locale_provider icu icu_locale " + literal(source.locale)
            : "locale_provider libc lc_collate " +
              literal(source.collate) +
              " lc_ctype " +
              literal(source.ctype);
        await database.sql(
          "create database " +
            identifier(source.name) +
            " template template0 encoding 'UTF8' " +
            locale +
            " owner " +
            identifier(source.owner) +
            ";",
        );
      }
      await database.sql(
        "alter database " +
          identifier(source.name) +
          " owner to " +
          identifier(source.owner) +
          "; alter database " +
          identifier(source.name) +
          " connection limit " +
          Number(source.summary.database_settings.connection_limit) +
          ";",
      );
      const archive = "/tmp/complete-recovery.dump";
      await collectCommand("docker", [
        "cp",
        resolve(temporary, source.part.replace(/\.age$/, "")),
        database.name + ":" + archive,
      ]);
      // Keep the database itself: preloaded cron/net workers may be connected to
      // postgres. Restore schema/data transactionally and replay the captured DB
      // metadata separately, solely inside this labelled networkless cluster.
      await collectCommand(
        "docker",
        [
          "exec",
          database.name,
          "pg_restore",
          "-U",
          database.operator,
          "--dbname",
          source.name,
          "--clean",
          "--if-exists",
          "--single-transaction",
          "--exit-on-error",
          archive,
        ],
        { errorFile: diagnostic },
      );
      const settings = source.summary.database_settings;
      await database.sql(
        "update pg_database set datacl=" +
          (settings.acl === null
            ? "NULL"
            : literal(settings.acl) + "::aclitem[]") +
          ",datistemplate=" +
          (settings.template ? "true" : "false") +
          " where datname=" +
          literal(source.name) +
          "; comment on database " +
          identifier(source.name) +
          " is " +
          (settings.comment === null ? "NULL" : literal(settings.comment)) +
          ";",
      );
      // aclitem input resolves the restored role names; source grantors/options
      // are preserved exactly instead of replacing them with broad test grants.
      await database.sql(
        "alter database " + identifier(source.name) + " reset all;",
      );
      for (const entry of settings.settings) {
        const prefix =
          entry.role === null
            ? "alter database " + identifier(source.name)
            : "alter role " +
              identifier(entry.role) +
              " in database " +
              identifier(source.name);
        await database.sql(prefix + " reset all;");
        for (const value of entry.values) {
          const equals = value.indexOf("=");
          assert(equals > 0);
          const key = value.slice(0, equals);
          assert.match(key, /^[A-Za-z_][A-Za-z0-9_.]*$/);
          await database.sql(
            prefix +
              " set " +
              key.split(".").map(identifier).join(".") +
              " to " +
              literal(value.slice(equals + 1)) +
              ";",
          );
        }
      }
      const restored = JSON.parse(
        await collectCommand(
          "docker",
          [
            "exec",
            "-i",
            database.name,
            "psql",
            "-U",
            database.operator,
            "-d",
            source.name,
            "-X",
            "-qAt",
            "-v",
            "ON_ERROR_STOP=1",
          ],
          { input: summarySQL },
        ),
      );
      assert.deepEqual(
        restored,
        source.summary,
        "Restored all-database table counts/RLS/policies/function permissions/database settings/extensions differ.",
      );
    }
    const actualGlobals = await collectCommand("docker", [
      "exec",
      database.name,
      "pg_dumpall",
      "-U",
      database.operator,
      "--globals-only",
    ]);
    assert.deepEqual(
      normalize(actualGlobals, database.operator),
      normalize(globals),
      "Restored password-bearing role attributes/memberships/grantors/options differ.",
    );
    const files = JSON.parse(
      await readFile(
        resolve(temporary, "filesystem-verification.json"),
        "utf8",
      ),
    );
    assert.equal(files.status, "passed");
    const result = {
      status: "passed",
      checkedAt: new Date().toISOString(),
      image: expectedImage,
      databases: catalog.databases.length,
      sourceRolePasswordsAttributesMembershipsAndGrantorsExact: true,
      allDatabaseCountsRlsPoliciesAndFunctionPermissionsExact: true,
      privateFileBytesAndSecretConfigurationHashesExact: true,
      archiveModesOwnersGroupsExact: true,
      files: files.regularFiles,
      bytes: files.bytes,
      limitations: [
        "No live VPS data were restored or overwritten.",
        "Database recovery was isolated with no network or host ports; full Auth/HTTP service recovery was not started.",
        "Original filesystem owner/ACL/link metadata were verified against the encrypted inventory; privileged ownership/ACL application and absolute links are intentionally not applied on the desktop.",
        "OS binaries, pinned image layers and reconstructible caches require reinstall/pull/signature refresh from the recorded inventories.",
      ],
    };
    await writeFile(
      resolve(backup, "desktop-restore-result.json"),
      JSON.stringify(result, null, 2) + "\n",
      { mode: 0o600 },
    );
    passed = true;
    return result;
  } finally {
    if (database) await database.cleanup();
    await rm(temporary, { recursive: true, force: true });
    if (passed) await rm(diagnostic, { force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    assert(["--backup", "--identity", "--age"].includes(process.argv[i]));
    options[process.argv[i].slice(2)] = process.argv[i + 1];
  }
  try {
    assert(options.backup && options.identity);
    const result = await restoreComplete(options);
    console.log(
      "PASS complete encrypted recovery: " +
        result.databases +
        " databases, exact password-bearing roles/permissions and " +
        result.files +
        " restored file/config hashes; owned isolated resources cleaned, secrets withheld.",
    );
  } catch {
    console.error(
      "Complete encrypted recovery did not pass; private diagnostics withheld.",
    );
    process.exitCode = 1;
  }
}
