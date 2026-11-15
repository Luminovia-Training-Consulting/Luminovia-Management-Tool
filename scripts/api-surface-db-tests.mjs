/** Bind delivered frontend RPC references to the actual replayed database surface. */
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanFrontendRpcReferences } from "./code-integrity.mjs";
import { withTestDatabase } from "./testing/database.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await withTestDatabase("api_surface", async ({ sql }) => {
  const endpoints = JSON.parse(
    await sql(
      `select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'signature',pg_get_function_identity_arguments(p.oid),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'definer',p.prosecdef)),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`,
    ),
  );
  const references = scanFrontendRpcReferences(root);
  assert.ok(
    references.length > 25,
    "Reference scan must cover the delivered application, not an empty subset",
  );
  for (const reference of references)
    assert.ok(
      endpoints.some(
        (endpoint) =>
          endpoint.name === reference.name && endpoint.authenticated,
      ),
      `${reference.file}:${reference.line} calls an unavailable public authenticated RPC ${reference.name}`,
    );
  console.log(
    `PASS All ${references.length} literal delivered frontend RPC references resolve to executable migrated APIs`,
  );
  assert.ok(endpoints.length > 50);
  assert.equal(
    endpoints.filter((endpoint) => endpoint.definer).length,
    0,
    "Privileged implementations must remain in the unexposed schema",
  );
  console.log(
    "PASS Exposed application functions retain invoker security; no public definer bypass",
  );
  assert.equal(
    await sql(
      "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity",
    ),
    "0",
  );
  console.log("PASS Every current exposed application table enforces RLS");
  console.log(
    "\n3 API-surface PostgreSQL checks passed (source binding, function boundary and RLS).",
  );
});
