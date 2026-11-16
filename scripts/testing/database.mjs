/**
 * Creates an owned database for each SQL check and replays the real migrations.
 * Auth helpers are emulated for role tests; this does not replace native Auth or HTTP verification.
 */
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
/** Quotes one SQL literal; database names and other identifiers have separate validation. */
export const quoteSql = (value) => `'${String(value).replaceAll("'", "''")}'`;
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
      let out = "",
        err = "";
      child.stdout.on("data", (data) => (out += data));
      child.stderr.on("data", (data) => (err += data));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve(out.trim()) : reject(new Error(err || out)),
      );
      child.stdin.end(text);
    });
  /** Executes the check as a specific identity so administrative fixture privileges cannot mask the tested access. */
  const actor = (id, text, aal = "aal1") =>
    sql(
      `begin;set local role authenticated;set local request.jwt.claims=${quoteSql(JSON.stringify({ sub: id, aal, role: "authenticated" }))};${text};commit;`,
    );
  try {
    await sql(`create database ${database}`, "postgres");
    // SQL tests need auth.uid/auth.jwt and roles only. Native Auth is verified separately through real API fixtures.
    await sql(`create schema auth;create schema extensions;create table auth.users(id uuid primary key,email text);
  create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
  create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
  grant usage on schema auth to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;`);
    // Real sorted migration history stays unchanged; an optional bound permits historical transition tests.
    for (const file of (
      await readdir(new URL("../../supabase/migrations/", import.meta.url))
    )
      .filter(
        (name) =>
          name.endsWith(".sql") &&
          (migrationsThrough === undefined ||
            name.slice(0, 14) <= migrationsThrough),
      )
      .sort())
      await sql(
        await readFile(
          new URL("../../supabase/migrations/" + file, import.meta.url),
          "utf8",
        ),
      );
    return await run({ sql, actor, database, container });
  } finally {
    await sql(`drop database if exists ${database} with (force)`, "postgres");
  }
}
