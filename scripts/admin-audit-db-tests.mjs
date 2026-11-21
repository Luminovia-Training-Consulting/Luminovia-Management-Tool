/** Real isolated PostgreSQL checks for the reduced, read-only audit projection. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";
import {rpcResponse} from "./testing/openapi-contract.mjs";

const auditPage = rpcResponse("admin_audit_events");

await withTestDatabase("admin_audit", async ({sql, actor}) => {
    const roles = [
            "admin",
            "owner",
            "management",
            "senior_lecturer",
            "lecturer",
            "client",
            "participant",
        ],
        users = Object.fromEntries(roles.map((role) => [role, randomUUID()]));
    await sql(
        `insert into auth.users(id, email)
         values ${roles.map((role) => `(${q(users[role])},${q(`audit-${role}@example.invalid`)})`).join(",")};
        insert into public.user_roles(user_id, role)
        values ${roles.map((role) => `(${q(users[role])},${q(role)})`).join(",")};
        update public.profiles
        set display_name='Fictional audit actor <script>literal</script>'
        where id = ${q(users.lecturer)}`,
    );
    let checks = 0;
    /** Counts and reports a case only after all of its assertions have completed successfully. */
    const check = async (name, run) => {
        await run();
        checks++;
        console.log(`PASS ${name}`);
    };
    /** Reads the business projection as a specific fixture identity to verify visibility and privacy. */
    const read = async (who = users.admin, args = "", aal = "aal1") =>
        auditPage(await actor(who, `select public.admin_audit_events(${args})`, aal));
    await check(
        "Current admin/owner permissions allow reads in password-only AAL1; every ordinary role and anonymous access is denied",
        async () => {
            for (const role of ["admin", "owner"])
                assert.deepEqual((await read(users[role])).items, []);
            for (const role of roles.slice(2))
                await assert.rejects(read(users[role]), /42501/);
            assert.equal(
                await sql(
                    "select has_function_privilege('anon','public.admin_audit_events(timestamptz,timestamptz,text,text,timestamptz,uuid,integer)','execute')",
                ),
                "f",
            );
            assert.equal(
                await sql(
                    "select has_function_privilege('authenticated','private.admin_audit_actions()','execute')",
                ),
                "f",
            );
        },
    );
    const safe = randomUUID(),
        resource = randomUUID(),
        secret = "PRIVATE-CALENDAR-DM-CONTRACT-INVOICE-PAYLOAD-DO-NOT-EXPOSE";
    await check(
        "Exact reviewed actions project only safe metadata; private and unknown actions fail closed",
        async () => {
            await sql(
                `insert into public.audit_events(id, actor_id, action, resource_id, details)
                 values (${q(safe)}, ${q(users.lecturer)}, 'job.lifecycle.published', ${q(resource)}, ${q(JSON.stringify({
                    private_note: secret,
                    gross_amount: 1000,
                    user_metadata: {role: "owner"}
                }))}::jsonb);
                insert into public.audit_events(actor_id, action, resource_id, details)
                select ${q(users.lecturer)}, action, gen_random_uuid(), ${q(JSON.stringify({body: secret}))}::jsonb
                from unnest(array['availability.created', 'profile.details.saved', 'profile.avatar_selected', 'chat.member_added', 'document.quarantined', 'contract.executed_version_registered', 'invoice.submitted', 'course.review.saved', 'calendar.created', 'job.lifecycle.private_future_action']) action`,
            );
            const result = await read();
            assert.equal(result.items.length, 1);
            assert.equal(result.items[0].id, safe);
            assert.deepEqual(Object.keys(result.items[0]).sort(), [
                "action",
                "actor_name",
                "created_at",
                "id",
                "resource_id",
            ]);
            assert.equal(result.items[0].resource_id, resource);
            assert.equal(
                result.items[0].actor_name,
                "Fictional audit actor <script>literal</script>",
            );
            assert.ok(!JSON.stringify(result).includes(secret));
            assert.ok(!JSON.stringify(result).includes("user_metadata"));
            assert.equal(result.actions.includes("invoice.submitted"), false);
            assert.equal(
                result.actions.includes("job.lifecycle.private_future_action"),
                false,
            );
        },
    );
    await check(
        "Literal metadata search and exact action filters never search private details",
        async () => {
            assert.equal(
                (await read(users.admin, `null,null,'',${q(secret)}`)).items.length,
                0,
            );
            assert.equal(
                (await read(users.admin, `null,null,'',${q("%_")}`)).items.length,
                0,
            );
            assert.equal(
                (await read(users.admin, `null,null,'',${q(resource.toUpperCase())}`))
                    .items[0].id,
                safe,
            );
            assert.equal(
                (
                    await read(
                        users.admin,
                        "null,null,'job.lifecycle.published','AUDIT ACTOR'",
                    )
                ).items[0].id,
                safe,
            );
            assert.deepEqual(
                (await read(users.admin, "null,null,'taxonomy.archived'")).items,
                [],
            );
            await assert.rejects(
                read(users.admin, "null,null,'invoice.submitted'"),
                /22023/,
            );
            await assert.rejects(
                read(users.admin, "null,null,'job.lifecycle'"),
                /22023/,
            );
        },
    );
    await check(
        "Default last 30 days and validated finite 93-day windows bound all pages and cursors",
        async () => {
            const result = await read();
            assert.equal(
                Date.parse(result.to) - Date.parse(result.from),
                30 * 86400000,
            );
            await sql(
                `insert into public.audit_events(actor_id, action, created_at)
                 values (${q(users.admin)}, 'taxonomy.created', now() - interval '31 days')`,
            );
            assert.equal((await read()).items.length, 1);
            for (const args of [
                "'infinity',now()",
                "now(),'infinity'",
                "now(),now()",
                "now()-interval '94 days',now()",
                "null,null,null",
                "null,null,'',null",
                `null,null,'',${q("a".repeat(161))}`,
                "null,null,'','',null,null,0",
                "null,null,'','',null,null,101",
                "null,null,'','',now(),null",
                `null,null,'','',null,${q(safe)}`,
                `null,null,'','',now()-interval '40 days',${q(safe)}`,
                `null,null,'','',now()+interval '1 day',${q(safe)}`,
            ])
                await assert.rejects(read(users.admin, args), /22023/);
            assert.ok(
                Array.isArray(
                    (await read(users.admin, "now()-interval '93 days 1 hour',now()"))
                        .items,
                ),
            );
        },
    );
    await check(
        "Concurrent equal-timestamp events page by timestamp plus UUID without duplicates or gaps",
        async () => {
            const at = await sql("select now()-interval '1 hour'"),
                ids = Array.from({length: 45}, randomUUID);
            await Promise.all(
                [ids.slice(0, 22), ids.slice(22)].map((part) =>
                    sql(
                        `insert into public.audit_events(id, actor_id, action, created_at)
                         values ${part.map((id) => `(${q(id)},${q(users.admin)},'taxonomy.created',${q(at)})`).join(",")}`,
                    ),
                ),
            );
            let page = await read(
                users.admin,
                "null,null,'taxonomy.created','',null,null,20",
            );
            const seen = [...page.items.map((item) => item.id)],
                from = page.from,
                to = page.to;
            assert.equal(page.has_more, true);
            // A genuinely later transaction is beyond the frozen first-page upper bound.
            const late = randomUUID();
            await sql(
                `insert into public.audit_events(id, actor_id, action)
                 values (${q(late)}, ${q(users.admin)}, 'taxonomy.created')`,
            );
            while (page.has_more) {
                page = await read(
                    users.admin,
                    `${q(from)},${q(to)},'taxonomy.created','',${q(page.next_cursor.at)},${q(page.next_cursor.id)},20`,
                );
                seen.push(...page.items.map((item) => item.id));
            }
            assert.deepEqual(seen, [...ids].sort().reverse());
            assert.equal(new Set(seen).size, 45);
            assert.equal(seen.includes(late), false);
            assert.equal(page.next_cursor, null);
        },
    );
    await check(
        "Client writes cannot append, rewrite or delete historical audit events",
        async () => {
            for (const statement of [
                `insert into public.audit_events(actor_id, action)
                 values (${q(users.admin)}, 'taxonomy.created')`,
                `update public.audit_events
                 set action='taxonomy.archived'
                 where id = ${q(safe)}`,
                `delete
                 from public.audit_events
                 where id = ${q(safe)}`,
            ])
                await assert.rejects(
                    actor(users.admin, statement, "aal1"),
                    /permission denied/,
                );
            assert.equal(
                await sql(`select action
                           from public.audit_events
                           where id=${q(safe)}`),
                "job.lifecycle.published",
            );
            assert.equal(
                await sql(
                    "select prosecdef from pg_proc where oid='public.admin_audit_events(timestamptz,timestamptz,text,text,timestamptz,uuid,integer)'::regprocedure",
                ),
                "f",
            );
        },
    );
    await check(
        "Explicit current permission grants work without role hierarchy and revoke against an existing token",
        async () => {
            await sql(
                "insert into public.role_permissions(role,permission) values('management','audit.read')",
            );
            assert.ok((await read(users.management)).items.length > 0);
            await sql(
                "delete from public.role_permissions where role='management' and permission='audit.read'",
            );
            await assert.rejects(read(users.management), /42501/);
            await sql(
                `delete
                 from public.user_roles
                 where user_id = ${q(users.owner)}`,
            );
            await assert.rejects(read(users.owner), /42501/);
            await sql(
                `update public.profiles
                 set active= false
                 where id = ${q(users.admin)}`,
            );
            await assert.rejects(read(users.admin), /42501/);
        },
    );
    console.log(`${checks} admin audit PostgreSQL checks passed.`);
});