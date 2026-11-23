/**
 * Binds compiler-discovered frontend RPCs to a freshly migrated test database.
 * Checks execution grants, RLS and separation of the public API from private implementations.
 */
import assert from "node:assert/strict";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {scanFrontendRpcReferences} from "./code-integrity.mjs";
import {assertNativeRpcCatalogue, assertRpcArgumentShapes} from "./native-rpc-catalogue.mjs";
import {quoteSql, withTestDatabase} from "./testing/database.mjs";
import {portalHttpActions, portalHttpMethods, portalHttpPutTargets, portalHttpPutVersions} from "../supabase/functions/_shared/portal-http-methods.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await withTestDatabase("api_surface", async ({sql}) => {
    const references = scanFrontendRpcReferences(root);
    assert.ok(
        references.length > 25,
        "Reference scan must cover the delivered application, not an empty subset",
    );
    // Catalogue generation requires an authenticated invoker signature for each
    // reference before comparing the generated contracts or checking payloads.
    const catalogue = await assertNativeRpcCatalogue(sql, references);
    console.log(
        `PASS All ${references.length} finite delivered frontend RPC references resolve to executable migrated APIs`,
    );
    console.log("PASS Native OpenAPI requests, responses and REST role gates match the migration replay");
    const methodRows = [
        ...Object.entries(portalHttpMethods).map(([name, method]) =>
            [name, method, portalHttpPutTargets[name], portalHttpPutVersions[name], null, null]),
        ...Object.entries(portalHttpActions).flatMap(([name, methods]) =>
            Object.entries(methods).map(([method, action]) =>
                [name, method, action.target, action.version, action.argument,
                    typeof action.values[0] === "boolean" ? "boolean" : "text"])),
    ].map((row) => `(${row.map((value) => value ? quoteSql(value) : "null").join(",")})`).join(",");
    assert.equal(await sql(`
        with aliases(name,method,target,version,action,action_type) as (values ${methodRows}),
        reviewed as (
          select alias.*, p.oid, p.provolatile, p.prosecdef, p.proargnames, p.proargtypes
          from aliases alias left join pg_proc p on p.pronamespace='public'::regnamespace
            and p.proname=alias.name and p.prokind='f'
            and has_function_privilege('authenticated',p.oid,'execute')
        )
        select coalesce(string_agg(distinct name, ', ' order by name),'') from reviewed
        where oid is null or prosecdef or
          (method='GET' and provolatile not in ('i','s')) or
          (method<>'GET' and provolatile<>'v') or
          (target is not null and not coalesce(proargtypes[array_position(proargnames,target)-1]='uuid'::regtype,false)) or
          (version is not null and not coalesce(proargtypes[array_position(proargnames,version)-1]='integer'::regtype,false)) or
          (action is not null and not coalesce(proargtypes[array_position(proargnames,action)-1]=action_type::regtype,false))
    `), "", "HTTP aliases must keep their authenticated invoker, read/write and version boundaries");
    assert.ok(!Object.hasOwn(portalHttpMethods, "deletion_confirm"), "Permanent delete uses its protected account facade");
    console.log(`PASS Reviewed HTTP aliases match ${Object.keys(portalHttpMethods).length + Object.keys(portalHttpActions).length} migrated RPC names and their argument types`);

    assertRpcArgumentShapes(catalogue, references);
    const verifiedPayloads = references.filter(({argumentShapes}) => argumentShapes.some(Boolean));
    assert.ok(verifiedPayloads.length > 25, "Payload checks must exercise the delivered frontend");
    console.log(`PASS Named arguments in ${verifiedPayloads.length} frontend RPC references fit migrated signatures`);
    assert.equal(
        await sql(`select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.proname), '')
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.prosecdef`),
        "",
        "Privileged implementations must remain in the unexposed schema",
    );
    console.log(
        "PASS Exposed application functions retain invoker security; no public definer bypass",
    );
    assert.equal(
        await sql(
            "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity",
        ),
        "0",
    );
    console.log("PASS Every current exposed application table enforces RLS");
    assert.equal(
        await sql(
            "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind in ('r','p') and not c.relrowsecurity",
        ),
        "0",
        "Private application ledgers also require RLS as defense in depth",
    );
    console.log(
        "PASS Every private application table retains RLS defense in depth",
    );
    // A view otherwise evaluates underlying relations with its owner's access.
    assert.equal(
        await sql(`select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
             from pg_class c join pg_namespace n on n.oid=c.relnamespace
             where n.nspname='public' and c.relkind='v'
               and not coalesce(c.reloptions @> array['security_invoker=true'], false)`),
        "",
        "Public views must preserve the caller's privileges",
    );
    console.log("PASS Public application views use invoker rights");
    // Effective privileges capture both direct grants and inherited column grants.
    // The reviewed bootstrap view is the sole anonymous relation read.
    assert.equal(
        await sql(`select coalesce(string_agg(n.nspname || '.' || c.relname, ', ' order by n.nspname, c.relname), '')
             from pg_class c join pg_namespace n on n.oid=c.relnamespace
             where n.nspname in ('public','private') and c.relkind in ('r','p','v','m','f')
               and (has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                 or has_any_column_privilege('anon', c.oid, 'INSERT,UPDATE,REFERENCES')
                 or ((n.nspname, c.relname) <> ('public', 'installation_capability_state')
                   and has_any_column_privilege('anon', c.oid, 'SELECT')))`),
        "",
        "Anonymous relation privileges are limited to reading installation capabilities",
    );
    console.log("PASS Anonymous relation privileges allow only the reviewed bootstrap read");
    assert.equal(
        await sql(`select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by n.nspname, p.proname), '')
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname in ('public','private') and has_function_privilege('anon', p.oid, 'EXECUTE')
               and not exists (select 1 from unnest(array[
                 'public.require_portal_access()', 'private.require_portal_access()',
                 'public.installation_capabilities()', 'private.installation_capability_projection()',
                 'public.academy_public_branding()', 'private.academy_public_branding()',
                 'public.academy_public_brand_links()', 'private.academy_public_brand_links()',
                 'public.academy_public_logo()', 'private.academy_public_logo()',
                 'public.academy_pwa_icon()', 'private.academy_pwa_icon()'
               ]) allowed(signature) where p.oid = to_regprocedure(allowed.signature))`),
        "",
        "Anonymous actors can only read the public installation bootstrap and Academy branding and run the Data API pre-request hook",
    );
    console.log(
        "PASS Anonymous execution is limited to the installation bootstrap, public branding and pre-request hook",
    );
    assert.equal(
        await sql(
            `select count(*)
             from pg_proc p
                      join pg_namespace n on n.oid = p.pronamespace
             where n.nspname in ('public', 'private')
               and p.prosecdef
               and not exists(select 1 from unnest(p.proconfig) setting where setting = 'search_path=""')`,
        ),
        "0",
        "Every privileged implementation must fix its search path explicitly",
    );
    console.log(
        "PASS Every privileged application implementation has an explicitly empty search path",
    );
    // The migration retires historical implementations while current entry
    // points and their live fallback routines remain registered.
    assert.deepEqual(
        JSON.parse(await sql(`
          select jsonb_build_object(
            'retained_obsolete', array(
              select signature from unnest(array[
                'private.course_workspace_action_obsolete(uuid,text,jsonb,integer)',
                'private.notification_target_before_extensions(text,uuid)',
                'private.course_document_access_obsolete(text,uuid)',
                'private.manage_course_enrolment_before_origins(uuid,uuid,text)',
                'private.job_lifecycle_before_withdrawals(uuid)'
              ]) routine(signature) where to_regprocedure(signature) is not null
            ),
            'missing_active', array(
              select signature from unnest(array[
                'public.course_workspace_action(uuid,text,jsonb,integer)',
                'private.course_workspace_action_before_premium(uuid,text,jsonb,integer)',
                'private.notification_target(text,uuid)',
                'private.notification_target_integrated_fallback(text,uuid)',
                'public.course_document_access(text,uuid)',
                'private.course_document_access(text,uuid)',
                'public.manage_course_enrolment(uuid,uuid,text)',
                'private.manage_course_enrolment(uuid,uuid,text)',
                'public.job_lifecycle(uuid)',
                'private.job_lifecycle(uuid)'
              ]) routine(signature) where to_regprocedure(signature) is null
            )
          )`)),
        {
            retained_obsolete: [],
            missing_active: [],
        },
    );
    console.log("PASS Five obsolete private routines are absent and their active entry points remain registered");
    console.log(
        "\n11 API-surface PostgreSQL checks passed (source binding, OpenAPI catalogue, payload keys, invoker boundaries, public/private RLS, anonymous grants, definer search paths and routine cleanup).",
    );
});
