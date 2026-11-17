/**
 * Creates an owned database for each SQL check. Canonical runners may clone a
 * per-run replayed migration template; historical-bound tests still replay.
 * Auth helpers are emulated for role tests, not native Auth/HTTP verification.
 */
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { collectUtf8 } from "./utf8-stream.mjs";
/** Quotes one SQL literal; database names and other identifiers have separate validation. */
export const quoteSql = (value) => `'${String(value).replaceAll("'", "''")}'`;
/** Applies the permission helper from the current password-only migration to
 * historical schema snapshots that intentionally stop before the auth-policy
 * migration. Keeps those module tests representative of the current runtime. */
export async function applyPasswordOnlyPermissionPolicy(sql) {
  const migrations = await readdir(
    new URL("../../supabase/migrations/", import.meta.url),
  );
  const migration = migrations.find((name) =>
    /^\d{14}_remove_mfa_and_assurance_gates\.sql$/.test(name),
  );
  if (!migration)
    throw new Error("Current password-only permission migration is missing.");
  const source = await readFile(
    new URL(`../../supabase/migrations/${migration}`, import.meta.url),
    "utf8",
  );
  const definition = source.match(
    /create or replace function private\.has_permission\(p_permission text\)[\s\S]*?\$\$;/i,
  )?.[0];
  if (!definition)
    throw new Error("Current password-only permission policy is missing.");
  await sql(definition);
}
const ownedTemplate = (value) => {
  if (!/^portal_test_template_[a-f0-9]{8}$/.test(value ?? ""))
    throw new Error(
      "Only this run's random isolated SQL template is permitted.",
    );
  return value;
};
async function initializeDatabase(
  database,
  sql,
  migrationsThrough,
  template = "template0",
  container = process.env.PORTAL_DB_CONTAINER ?? "supabase_db_luminovia-portal",
) {
  await sql(`create database ${database} template ${template}`, "postgres");
  await sql(
    `create schema auth;create schema extensions;create table auth.users(id uuid primary key,email text);
  create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
  create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
  grant usage on schema auth to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;`,
    database,
  );
  const files = (
    await readdir(new URL("../../supabase/migrations/", import.meta.url))
  )
    .filter(
      (name) =>
        name.endsWith(".sql") &&
        (migrationsThrough === undefined ||
          name.slice(0, 14) <= migrationsThrough),
    )
    .sort();
  const replay = async () => {
    for (const file of files)
      await sql(
        await readFile(
          new URL("../../supabase/migrations/" + file, import.meta.url),
          "utf8",
        ),
        database,
      );
  };
  if (container) await withMigrationReplayLock(container, replay);
  else await replay();
}

/** Several historical SQL suites replay migrations into separate databases
 * concurrently in one PostgreSQL cluster. A few migrations alter cluster-wide
 * role settings, so serialize only migration replay across those databases. */
export async function withMigrationReplayLock(container, run) {
  if (
    !/^supabase_db_luminovia-portal(?:-test(?:-[a-zA-Z0-9_-]+)?)?$/.test(
      container,
    )
  )
    throw new Error(
      "Only an owned local portal migration container is permitted.",
    );
  const child = spawn(
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
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "",
    error = "",
    acquired = false;
  let acquire;
  const ready = new Promise((resolve, reject) => {
    acquire = { resolve, reject };
  });
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(Error(error || "Migration lock failed")),
    );
  });
  void closed.catch(() => {});
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (
      !acquired &&
      output.split(/\r?\n/).some((line) => line === "t" || line === "f")
    ) {
      acquired = true;
      acquire.resolve();
    }
  });
  child.stderr.on("data", (chunk) => (error += chunk));
  child.once("close", () => {
    if (!acquired)
      acquire.reject(Error(error || "Migration lock closed early"));
  });
  child.stdin.write(
    "select pg_catalog.pg_advisory_lock(1129740097,2048) is null;\n",
  );
  try {
    await ready;
    await run();
  } finally {
    child.stdin.end(
      "select pg_catalog.pg_advisory_unlock(1129740097,2048);\n\\q\n",
    );
    await closed;
  }
}

/** Replay the exact checked-in migration set once in a uniquely owned disposable template. */
export async function prepareTestDatabaseTemplate({
  container,
  template,
  execute,
}) {
  const name = ownedTemplate(template);
  if (
    !/^supabase_db_luminovia-portal-test(?:-[a-zA-Z0-9_-]+)?$/.test(container)
  )
    throw new Error(
      "Only an owned isolated portal test database is permitted.",
    );
  const dockerSql = (text, target = "postgres") =>
    new Promise((resolve, reject) => {
      const child = spawn(
        "docker",
        [
          "exec",
          "-i",
          container,
          "psql",
          "-U",
          "postgres",
          "-d",
          target,
          "-X",
          "-qAt",
          "-v",
          "ON_ERROR_STOP=1",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      const stdout = collectUtf8(child.stdout);
      const stderr = collectUtf8(child.stderr);
      child.on("error", reject);
      child.on("close", (code) => {
        const out = stdout();
        const err = stderr();
        if (code === 0) resolve(out.trim());
        else reject(new Error(err || out));
      });
      child.stdin.end(text);
    });
  const sql = execute ?? dockerSql;
  try {
    await initializeDatabase(
      name,
      sql,
      undefined,
      "template0",
      execute ? null : container,
    );
  } catch (error) {
    try {
      await sql(`drop database if exists ${name} with (force)`);
    } catch {
      /* The owned QA stack cleanup remains responsible after a lost engine. */
    }
    throw error;
  }
  return name;
}

/** Drop only the unpredictable template name inside this run's owned QA container. */
export async function dropTestDatabaseTemplate({
  container,
  template,
  execute,
}) {
  const name = ownedTemplate(template);
  if (
    !/^supabase_db_luminovia-portal-test(?:-[a-zA-Z0-9_-]+)?$/.test(container)
  )
    throw new Error(
      "Only an owned isolated portal test database is permitted.",
    );
  if (execute) {
    await execute(`drop database if exists ${name} with (force)`);
    return;
  }
  await new Promise((resolve, reject) => {
    const child = spawn(
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
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    const stderr = collectUtf8(child.stderr);
    child.on("error", reject);
    child.on("close", (code) => {
      const err = stderr();
      if (code === 0) resolve();
      else reject(new Error(err || "Template cleanup failed."));
    });
    child.stdin.end(`drop database if exists ${name} with (force)`);
  });
}
/** Creates a random database, migrates up to the permitted bound and drops it even when assertions fail. */
export async function withTestDatabase(
  prefix,
  run,
  { migrationsThrough } = {},
) {
  if (
    migrationsThrough !== undefined &&
    (typeof migrationsThrough !== "string" ||
      !/^\d{14}$/.test(migrationsThrough))
  )
    throw new Error("A migration ceiling must be an exact 14-digit version.");
  const container =
    process.env.PORTAL_DB_CONTAINER ?? "supabase_db_luminovia-portal";
  if (
    !/^supabase_db_luminovia-portal(?:-test(?:-[a-zA-Z0-9_-]+)?)?$/.test(
      container,
    )
  )
    throw new Error("Only an owned local portal test database is permitted.");
  if (!/^[a-z_]+$/.test(prefix))
    throw new Error("Safe test database prefix required");
  const database = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  /** Sends SQL to the owned test database and makes every psql error fail the run. */
  const sql = (text, target = database) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        "docker",
        [
          "exec",
          "-i",
          container,
          "psql",
          "-U",
          "postgres",
          "-d",
          target,
          "-X",
          "-qAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-v",
          "VERBOSITY=verbose",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      const stdout = collectUtf8(child.stdout);
      const stderr = collectUtf8(child.stderr);
      child.on("error", reject);
      child.on("close", (code) => {
        const out = stdout();
        const err = stderr();
        if (code === 0) resolve(out.trim());
        else reject(new Error(err || out));
      });
      child.stdin.end(text);
    });
  /** Executes the check as a specific identity so administrative fixture privileges cannot mask the tested access. */
  const actor = (id, text, aal = "aal1") =>
    sql(
      `begin;set local role authenticated;set local request.jwt.claims=${quoteSql(JSON.stringify({ sub: id, aal, role: "authenticated" }))};${text};commit;`,
    );
  try {
    const template =
      migrationsThrough === undefined && process.env.PORTAL_TEST_DB_TEMPLATE
        ? ownedTemplate(process.env.PORTAL_TEST_DB_TEMPLATE)
        : undefined;
    if (template)
      await sql(`create database ${database} template ${template}`, "postgres");
    else
      await initializeDatabase(
        database,
        sql,
        migrationsThrough,
        "template0",
        container,
      );
    return await run({ sql, actor, database, container });
  } finally {
    await sql(`drop database if exists ${database} with (force)`, "postgres");
  }
}
