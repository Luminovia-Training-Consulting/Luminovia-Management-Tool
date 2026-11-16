/** Reproduce actual strict function-body diagnostics on a disposable UUID
 * database. This complements the canonical CLI advisors and trigger checks. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";
const source = await readFile(
  new URL(
    "../supabase/migrations/20261116055506_accounting_interoperability.sql",
    import.meta.url,
  ),
  "utf8",
);
const names = [
  ...new Set(
    [
      ...source.matchAll(
        /create(?: or replace)? function private\.([a-z_]+)\(/g,
      ),
    ].map((match) => match[1]),
  ),
];
await withTestDatabase("accounting_body_lint", async ({ sql }) => {
  await sql("create extension plpgsql_check with schema extensions");
  const functions = JSON.parse(
    await sql(
      `select jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) from pg_proc p join pg_language l on l.oid=p.prolang join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and l.lanname='plpgsql' and p.prorettype<>'trigger'::regtype and p.proname in(${names.map(q).join(",")})`,
    ),
  );
  assert.ok(
    functions.length >= 10,
    "Accounting functions, not an empty list, must be linted",
  );
  for (const signature of functions) {
    const diagnostics = JSON.parse(
      await sql(
        `select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from extensions.plpgsql_check_function_tb(${q(signature)}::regprocedure) t`,
      ),
    );
    assert.deepEqual(
      diagnostics,
      [],
      signature + ": " + JSON.stringify(diagnostics),
    );
  }
  console.log(
    `PASS ${functions.length} strict accounting PL/pgSQL bodies, zero errors/warnings; canonical trigger/advisor checks remain mandatory.`,
  );
});
