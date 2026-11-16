/** Reproduce strict SQL body diagnostics in an owned disposable database. This
 * complements, never replaces, the canonical CLI lint/advisor and trigger gates. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { withTestDatabase, quoteSql } from "./testing/database.mjs";

const sources = [
  "20261116034641_course_readiness.sql",
  "20261116034757_internal_support_desk.sql",
  "20261116034812_replacement_marketplace.sql",
  "20261116034826_attendance_delivery.sql",
  "20261116035802_operations_notification_integration.sql",
  "20261116055506_accounting_interoperability.sql",
];
const names = new Set();
for (const file of sources) {
  const source = await readFile(
    new URL("../supabase/migrations/" + file, import.meta.url),
    "utf8",
  );
  for (const match of source.matchAll(
    /create(?: or replace)? function private\.([a-z_]+)\(/g,
  ))
    names.add(match[1]);
}
await withTestDatabase("operational_body_lint", async ({ sql }) => {
  await sql("create extension plpgsql_check with schema extensions");
  const functions = JSON.parse(
    await sql(
      `select jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) from pg_proc p join pg_language l on l.oid=p.prolang join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and l.lanname='plpgsql' and p.prorettype<>'trigger'::regtype and p.proname in(${[...names].map(quoteSql).join(",")})`,
    ),
  );
  assert.ok(
    functions.length >= 20,
    "The new operational implementations must be included, not an empty lint list",
  );
  for (const signature of functions) {
    const diagnostics = JSON.parse(
      await sql(
        `select coalesce(jsonb_agg(to_jsonb(t)),'[]') from extensions.plpgsql_check_function_tb(${quoteSql(signature)}::regprocedure) t`,
      ),
    );
    assert.deepEqual(
      diagnostics,
      [],
      `${signature}: ${JSON.stringify(diagnostics)}`,
    );
  }
  console.log(
    `PASS Strict PL/pgSQL body checks: ${functions.length} operational non-trigger functions, zero warnings/errors; canonical trigger/advisor checks remain required`,
  );
});
