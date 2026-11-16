/**
 * Erzeugt pro SQL-Prüfung eine eigene Datenbank und spielt die echten Migrationen ein.
 * Auth-Funktionen werden für Rollentests nachgebildet; dies ersetzt keine native Auth- oder HTTP-Prüfung.
 */
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
/** Maskiert einen SQL-Literalwert; Datenbanknamen und andere Bezeichner werden separat begrenzt. */
export const quoteSql = (value) => `'${String(value).replaceAll("'", "''")}'`;
/** Erzeugt eine Zufallsdatenbank, spielt Migrationen bis zur erlaubten Grenze ein und entfernt sie auch bei Fehlern. */
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
  /** Sendet SQL an die eigene Testdatenbank und lässt jeden psql-Fehler den Prüflauf ablehnen. */
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
  /** Führt die Prüfung unter einer konkreten Identität aus; Verwaltungsrechte dürfen den Testaufruf nicht verdecken. */
  const actor = (id, text, aal = "aal1") =>
    sql(
      `begin;set local role authenticated;set local request.jwt.claims=${quoteSql(JSON.stringify({ sub: id, aal, role: "authenticated" }))};${text};commit;`,
    );
  try {
    await sql(`create database ${database}`, "postgres");
    // SQL-Tests benötigen nur auth.uid/auth.jwt und Rollen. Native Auth wird separat über echte API-Fixtures geprüft.
    await sql(`create schema auth;create schema extensions;create table auth.users(id uuid primary key,email text);
  create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
  create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
  grant usage on schema auth to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;`);
    // Die echte sortierte Migrationshistorie bleibt unverändert; ein optionaler Deckel erlaubt historische Übergangstests.
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
