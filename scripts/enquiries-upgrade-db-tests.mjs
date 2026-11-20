/** Replay accepted main first, then prove the unpublished enquiry addition
 * preserves the real owner-only notification function, ACL and fallback body.
 * Uses a UUID disposable database, never an ordinary or hosted schema. */
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {withTestDatabase} from "./testing/database.mjs";

await withTestDatabase(
    "enquiry_upgrade",
    async ({sql}) => {
        const resolver = () =>
            sql(
                `select jsonb_build_object('oid', oid, 'source', prosrc, 'acl', proacl, 'definer', prosecdef, 'config', proconfig)
                 from pg_proc
                 where oid = 'private.notification_target(text,uuid)'::regprocedure`,
            );
        const before = await resolver();
        await sql(
            await readFile(
                new URL(
                    "../supabase/migrations/20261116143242_website_enquiry_intake.sql",
                    import.meta.url,
                ),
                "utf8",
            ),
        );
        assert.equal(
            await resolver(),
            before,
            "Enquiry installation must preserve accepted resolver identity, body, ACL and configuration",
        );
        assert.equal(
            await sql(
                "select to_regprocedure('private.enquiry_notification_target(text,uuid)') is not null",
            ),
            "t",
        );
        assert.equal(
            await sql(
                "select to_regprocedure('private.notification_target_before_enquiries(text,uuid)') is null",
            ),
            "t",
        );
        for (const role of ["anon", "authenticated", "service_role"])
            for (const name of ["notification_target", "enquiry_notification_target"])
                assert.equal(
                    await sql(
                        `select has_function_privilege('${role}','private.${name}(text,uuid)','EXECUTE')`,
                    ),
                    "f",
                );
        console.log(
            "PASS enquiry upgrade preserves accepted notification resolver OID/body/ACL/config and keeps both private helpers owner-only",
        );
    },
    {migrationsThrough: "20261116121605"},
);