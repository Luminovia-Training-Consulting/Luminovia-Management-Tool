/**
 * Compiles the browser's native RPC surface against a disposable PostgreSQL
 * migration replay. This is metadata only: it creates neither grants nor routes.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { legacyHandoverOperations } from "../src/features/jobs/handover-schema.ts";
import { scanFrontendRpcReferences } from "./code-integrity.mjs";
import { quoteSql, withTestDatabase } from "./testing/database.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogue = new URL("../data/native-rpc.generated.json", import.meta.url);

/** Determine whether a PostgreSQL argument is a named input or a result field. */
const inputModes = new Set(["i", "b", "v"]);
const outputModes = new Set(["o", "b", "t"]);

/** Group generated endpoints by the first owning app feature. */
function featureFor(file) {
  return file.match(/^src\/features\/([^/]+)\//)?.[1] ?? "portal";
}

/**
 * Replay output contracts are names and type OIDs, never expressions or
 * records. OIDs are used for joins only and deliberately absent from output.
 */
export async function buildNativeRpcCatalogue(
  sql,
  references = scanFrontendRpcReferences(root),
) {
  const functions = JSON.parse(
    await sql(`
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', p.proname,
        'defaultCount', p.pronargdefaults,
        'resultType', p.prorettype,
        'set', p.proretset,
        'args', coalesce((select jsonb_agg(jsonb_build_object(
            'name', p.proargnames[arg.n],
            'mode', coalesce(p.proargmodes[arg.n], 'i'),
            'type', arg.type
          ) order by arg.n)
          from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[]))
            with ordinality as arg(type, n)), '[]'::jsonb)
      ) order by p.proname collate "C", pg_get_function_identity_arguments(p.oid) collate "C"), '[]')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and not p.prosecdef
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and not exists (
          select 1 from pg_depend d where d.classid = 'pg_proc'::regclass
            and d.objid = p.oid and d.deptype = 'e'
        )
    `),
  );
  const types = JSON.parse(
    await sql(`
      select jsonb_object_agg(t.oid, jsonb_build_object(
        'name', t.typname, 'kind', t.typtype,
        'element', case when t.typcategory = 'A' then t.typelem end,
        'base', case when t.typtype = 'd' then t.typbasetype end,
        'labels', (select jsonb_agg(e.enumlabel order by e.enumsortorder)
          from pg_enum e where e.enumtypid = t.oid),
        'fields', (select jsonb_agg(jsonb_build_object(
            'name', a.attname, 'type', a.atttypid, 'nullable', not a.attnotnull
          ) order by a.attnum)
          from pg_attribute a where a.attrelid = t.typrelid
            and a.attnum > 0 and not a.attisdropped)
      ))
      from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where n.nspname in ('pg_catalog', 'public', 'extensions')
    `),
  );
  const allByName = new Map();
  for (const row of functions) {
    const overloads = allByName.get(row.name) ?? [];
    overloads.push(row);
    allByName.set(row.name, overloads);
  }

  /** SQL admits null values at the transport level; business validation can narrow them. */
  function nullable(schema) {
    if (schema.type === "null") return schema;
    if (schema.type && !schema.enum)
      return { ...schema, type: [schema.type, "null"] };
    return schema.enum
      ? { ...schema, type: [schema.type, "null"], enum: [...schema.enum, null] }
      : schema;
  }

  /** Describe JSON transport types without guessing fields inside a jsonb value. */
  function schema(typeId, seen = new Set()) {
    const type = types[typeId];
    assert.ok(type, `No PostgreSQL type metadata for ${typeId}`);
    if (seen.has(typeId))
      return { type: "object", "x-postgresql-type": type.name };
    if (type.base) return schema(type.base, new Set([...seen, typeId]));
    if (type.element)
      return {
        type: "array",
        items: nullable(schema(type.element, new Set([...seen, typeId]))),
      };
    if (type.labels) return { type: "string", enum: type.labels };
    if (type.fields) {
      return rowSchema(type.fields, new Set([...seen, typeId]));
    }
    switch (type.name) {
      case "bool":
        return { type: "boolean" };
      case "int2":
        return { type: "integer", minimum: -32768, maximum: 32767 };
      case "int4":
        return { type: "integer", format: "int32" };
      case "int8":
        return { type: "integer", format: "int64" };
      case "numeric":
      case "float4":
      case "float8":
        return { type: "number" };
      case "uuid":
        return { type: "string", format: "uuid" };
      case "date":
        return { type: "string", format: "date" };
      case "timestamptz":
        return { type: "string", format: "date-time" };
      case "timestamp":
      case "interval":
      case "text":
      case "varchar":
      case "bpchar":
      case "bytea":
        return { type: "string" };
      case "void":
        return { type: "null" };
      case "record":
        return { type: "object", "x-postgresql-type": "record" };
      default:
        return { "x-postgresql-type": type.name };
    }
  }

  /** PostgREST includes named result fields by default; their values may be null. */
  function rowSchema(fields, seen) {
    return {
      type: "object",
      properties: Object.fromEntries(
        fields.map((field) => {
          const value = schema(field.type, seen);
          return [
            field.name,
            field.nullable !== false ? nullable(value) : value,
          ];
        }),
      ),
      required: fields.map(({ name }) => name),
      additionalProperties: false,
    };
  }

  const browserCalls = new Map();
  for (const { name, file, line } of references) {
    assert.ok(
      allByName.has(name),
      `${file}:${line} calls ${name} without an authenticated invoker signature`,
    );
    const feature = featureFor(file);
    const former = browserCalls.get(name);
    if (!former || feature < former) browserCalls.set(name, feature);
  }
  // The full download retains deprecated integration contracts after the
  // portal removes their interactive call sites.
  for (const name of legacyHandoverOperations) {
    if (allByName.has(name) && !browserCalls.has(name))
      browserCalls.set(name, "jobs");
  }
  // Keep the bounded legacy CRM list in the authenticated API manifest even
  // though the company board now uses the paginated RPC.
  if (
    allByName.has("list_crm_opportunities") &&
    !browserCalls.has("list_crm_opportunities")
  )
    browserCalls.set("list_crm_opportunities", "crm");
  const names = [...browserCalls.keys()];
  const access = await probeRestGates(sql, names);
  return Object.fromEntries(
    [...browserCalls]
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([name, feature]) => {
        assert.match(name, /^[a-z][a-z0-9_]*$/);
        const signatures = allByName.get(name);
        const overloads = signatures.map((signature) => {
          const args = signature.args.filter(({ mode }) =>
            inputModes.has(mode),
          );
          assert.ok(
            args.every((arg) => arg.name),
            `Unnamed arguments need a reviewed HTTP contract: ${name}`,
          );
          const required = args
            .slice(0, args.length - signature.defaultCount)
            .map(({ name }) => name);
          const output = signature.args.filter(({ mode }) =>
            outputModes.has(mode),
          );
          const row =
            types[signature.resultType]?.kind === "c" ||
            types[signature.resultType]?.name === "record" ||
            output.length > 1;
          const result =
            row && output.length
              ? rowSchema(output)
              : schema(signature.resultType);
          return {
            request: {
              type: "object",
              properties: Object.fromEntries(
                args.map(({ name, type }) => [name, nullable(schema(type))]),
              ),
              required,
              additionalProperties: false,
            },
            response:
              signature.set || row
                ? { type: "array", items: result }
                : nullable(result),
            ...(types[signature.resultType]?.name === "void"
              ? { void: true }
              : {}),
          };
        });
        return [
          name,
          {
            feature,
            participant: access.participant.has(name),
            guest: access.guest.has(name),
            overloads,
          },
        ];
      }),
  );
}

/**
 * Exercise the same migrated pre-request entry point PostgREST calls. This
 * covers additive/delegating wrappers without inferring permissions from SQL
 * text. The fictional profiles and probe helper are rolled back.
 */
async function probeRestGates(sql, names) {
  const sources = names.map((name) => quoteSql(name)).join(",");
  const roles = ["participant", "guest"];
  const fixtures = roles.map((role) => ({ role, id: randomUUID() }));
  const statements = fixtures.map(
    ({ role, id }) => `
        set local request.jwt.claims=${quoteSql(JSON.stringify({ sub: id, role: "authenticated" }))};
        select jsonb_build_object('role', ${quoteSql(role)}, 'allowed', coalesce(jsonb_agg(name), '[]'::jsonb))
          from unnest(array[${sources}]::text[]) as rpc(name)
          where private.native_rpc_catalogue_probe('/rpc/' || name);
    `,
  );
  const result = await sql(`
        begin;
        insert into auth.users(id,email,email_confirmed_at) values ${fixtures
          .map(
            ({ id }) =>
              `(${quoteSql(id)},${quoteSql(id + "@rpc-probe.example.invalid")},now())`,
          )
          .join(",")};
        delete from public.user_roles where user_id in (${fixtures.map(({ id }) => quoteSql(id)).join(",")});
        insert into public.user_roles(user_id,role) values ${fixtures
          .map(({ id, role }) => `(${quoteSql(id)},${quoteSql(role)})`)
          .join(",")};
        create function private.native_rpc_catalogue_probe(path text) returns boolean
        language plpgsql security invoker set search_path='' as $probe$
        begin
            perform set_config('request.path',path,true);
            perform public.require_portal_access();
            return true;
        exception when insufficient_privilege then return false;
        end;
        $probe$;
        grant execute on function private.native_rpc_catalogue_probe(text) to authenticated;
        set local role authenticated;
        ${statements.join("\n")}
        rollback;
    `);
  const gates = Object.fromEntries(
    result.split("\n").map((line) => {
      const { role, allowed } = JSON.parse(line);
      return [role, new Set(allowed)];
    }),
  );
  for (const role of roles) {
    assert.ok(
      gates[role]?.has("portal_access"),
      `REST gate probe could not authenticate a ${role} fixture`,
    );
  }
  return gates;
}

/** One deterministic line per routine keeps generated diff reviews narrow. */
function serialize(entries) {
  return (
    "{\n" +
    Object.entries(entries)
      .map(
        ([name, entry]) =>
          `  ${JSON.stringify(name)}: ${JSON.stringify(entry)}`,
      )
      .join(",\n") +
    "\n}\n"
  );
}

/** Standard SQL gate catches changes in calls, signatures, grants and gates. */
export async function assertNativeRpcCatalogue(sql, references) {
  const entries = await buildNativeRpcCatalogue(sql, references);
  assert.equal(
    await readFile(catalogue, "utf8"),
    serialize(entries),
    "Native Swagger catalogue is stale. Regenerate with node scripts/native-rpc-catalogue.mjs.",
  );
  return entries;
}

/** Match finite browser payload keys to a migrated PostgREST named-call signature. */
export function assertRpcArgumentShapes(entries, references) {
  for (const { name, file, line, argumentShapes } of references) {
    for (const shape of argumentShapes) {
      if (!shape) continue;
      assert.ok(
        entries[name].overloads.some(
          ({ request }) =>
            request.required.every((key) => shape.required.includes(key)) &&
            shape.possible.every((key) =>
              Object.hasOwn(request.properties, key),
            ),
        ),
        `${file}:${line} cannot call ${name} with these RPC arguments: ${shape.possible.join(", ") || "(none)"}`,
      );
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await withTestDatabase("native_rpc_catalogue", async ({ sql }) => {
    const entries = await buildNativeRpcCatalogue(sql);
    await writeFile(catalogue, serialize(entries));
    console.log(
      `Generated ${Object.keys(entries).length} browser RPC contracts from the migrated database.`,
    );
  });
}
