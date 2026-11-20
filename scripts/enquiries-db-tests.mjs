/** Real isolated PostgreSQL intake, permissions, idempotency and conversion. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {z} from "zod";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("enquiries_test", async (fixture) => {
    const {sql, actor, container, database} = fixture;
    /** Keep a real owned transaction open until the test explicitly releases it.
     * Readiness comes from a SQL marker, and wait assertions inspect actual lock
     * blockers; elapsed sleeps never stand in for a concurrency assertion. */
    const hold = async (text) => {
        const marker = `enquiry_gate_${randomUUID().replaceAll("-", "")}`;
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
                database,
                "-X",
                "-qAt",
                "-v",
                "ON_ERROR_STOP=1",
            ],
            {stdio: ["pipe", "pipe", "pipe"]},
        );
        let output = "",
            error = "",
            released = false;
        const closed = new Promise((resolve, reject) => {
            child.on("error", reject);
            child.on("close", (code) =>
                code === 0
                    ? resolve()
                    : reject(Error(error || "Owned enquiry lock transaction failed")),
            );
        });
        // Attach a rejection handler immediately while readiness is being awaited.
        void closed.catch(() => {
        });
        const ready = new Promise((resolve, reject) => {
            const timer = setTimeout(
                () =>
                    reject(Error("Owned enquiry lock transaction did not become ready")),
                10000,
            );
            child.stdout.on("data", (chunk) => {
                output += chunk;
                if (output.includes(marker)) {
                    clearTimeout(timer);
                    resolve();
                }
            });
            child.stderr.on("data", (chunk) => {
                error += chunk;
            });
            child.on("error", (value) => {
                clearTimeout(timer);
                reject(value);
            });
            child.once("close", () => {
                clearTimeout(timer);
                reject(
                    Error(
                        error || "Owned enquiry lock transaction exited before readiness",
                    ),
                );
            });
        });
        child.stdin.write(
            `begin;set local application_name=${q(marker)};${text};select ${q(marker)};\n`,
        );
        await ready;
        return {
            finish: async (beforeCommit = "") => {
                if (!released) {
                    released = true;
                    child.stdin.end(`${beforeCommit}\ncommit;\n\\q\n`);
                }
                await closed;
            },
        };
    };
    /** Poll a specific fixture statement until PostgreSQL proves it is blocked. */
    const waitBlocked = async (identifier) => {
        const until = Date.now() + 10000;
        while (Date.now() < until) {
            if (
                (await sql(
                    `select exists(select 1 from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and (application_name = ${q(identifier)} or position(${q(identifier)} in query) > 0) and cardinality(pg_blocking_pids(pid)) > 0)`,
                )) === "t"
            )
                return;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw Error(
            "Expected owned enquiry statement never reached a proven lock wait",
        );
    };
    const manager = randomUUID(),
        admin = randomUUID(),
        lecturer = randomUUID(),
        client = randomUUID();
    await sql(
        `insert into auth.users(id, email)
         values ${[manager, admin, lecturer, client].map((id) => `('${id}','${id}@example.invalid')`).join(",")};
        insert into public.user_roles
        values ('${manager}', 'management'),
               ('${admin}', 'admin'),
               ('${lecturer}', 'lecturer'),
               ('${client}', 'client')`,
    );
    const payload = {
        company_name: "Fictional Training Company",
        contact_name: "Fictional Contact",
        email: "contact@example.invalid",
        phone: "",
        topic: "Fictional network course",
        message: "Please review this fictional enquiry. <script>literal</script>",
        preferred_dates: "Next month",
        duration: "2 days",
        delivery_type: "online",
        time_zone: "Europe/Berlin",
        locale: "en",
        privacy_notice_version: "fictional-v1",
        consent: true,
    };
    const sender = "a".repeat(64),
        otherSender = "b".repeat(64),
        submission = randomUUID();
    const receive = (body = payload, key = submission, hash = sender) =>
        sql(
            `set role service_role;select public.receive_website_enquiry(${q(hash)},'${key}',${q(JSON.stringify(body))}::jsonb)`,
        );
    const detail = (who, id, aal = "aal1") =>
        actor(who, `select public.enquiry_detail('${id}')`, aal).then(JSON.parse);
    const manage = (
        who,
        id,
        action,
        body,
        version,
        key = randomUUID(),
        aal = "aal1",
    ) =>
        actor(
            who,
            `select public.manage_enquiry('${id}',${q(action)},${q(JSON.stringify(body))}::jsonb,${version},'${key}')`,
            aal,
        );
    let checks = 0;
    const check = async (name, fn) => {
        await fn();
        checks++;
        console.log(`PASS ${name}`);
    };
    let id;
    await check(
        "Only the server integration role can receive enquiries; anonymous/authenticated direct writes deny",
        async () => {
            for (const role of ["anon", "authenticated"])
                await assert.rejects(
                    sql(
                        `set role ${role};select public.receive_website_enquiry('${sender}','${submission}',${q(JSON.stringify(payload))})`,
                    ),
                    /permission denied/,
                );
            await assert.rejects(
                actor(lecturer, "select * from private.website_enquiries"),
                /permission denied/,
            );
        },
    );
    await check(
        "Simultaneous exact retries create one request, one receipt history and one notification per manager",
        async () => {
            const results = await Promise.all([receive(), receive(), receive()]);
            assert.equal(new Set(results).size, 1);
            id = results[0];
            assert.equal(
                await sql("select count(*) from private.website_enquiries"),
                "1",
            );
            assert.equal(
                await sql("select count(*) from private.website_enquiry_events"),
                "1",
            );
            assert.equal(
                await sql(
                    `select count(*)
                     from public.notifications
                     where resource_id = '${id}'`,
                ),
                "2",
            );
            await assert.rejects(
                receive({...payload, message: "Changed retry"}),
                /retry conflict/,
            );
        },
    );
    await check(
        "Accepted owner-only resolver and enquiry helper deny direct calls while the own inbox resolves enquiry links",
        async () => {
            for (const role of ["anon", "authenticated", "service_role"])
                for (const name of [
                    "notification_target",
                    "enquiry_notification_target",
                ])
                    await assert.rejects(
                        sql(
                            `set role ${role};select private.${name}('website_enquiry','${id}')`,
                        ),
                        /permission denied/,
                    );
            const inbox = JSON.parse(
                await actor(manager, "select public.notification_inbox()", "aal1"),
            );
            const notice = inbox.items.find(
                (item) => item.kind === "website_enquiry",
            );
            assert.ok(
                notice,
                "Committed enquiry notification is present in the manager's own inbox",
            );
            assert.equal(notice.href, `/enquiries/${id}`);
            assert.equal(notice.title, "");
            const denied = JSON.parse(
                await actor(lecturer, "select public.notification_inbox()", "aal1"),
            );
            assert.ok(!denied.items.some((item) => item.kind === "website_enquiry"));
        },
    );
    await check(
        "Validation rejects unknown identity fields, malformed contacts, missing consent and invalid time zones",
        async () => {
            for (const body of [
                {...payload, role: "admin"},
                {...payload, consent: false},
                {...payload, company_name: ""},
                {...payload, email: "x\n@bad.invalid"},
                {...payload, email: 'bad"@example.invalid'},
                {...payload, email: "first..last@example.invalid"},
                {...payload, email: ".first@example.invalid"},
                {...payload, time_zone: "not-a-zone"},
                {...payload, message: []},
            ])
                await assert.rejects(
                    receive(body, randomUUID()),
                    /Invalid website enquiry/,
                );
        },
    );
    await check(
        "Every acknowledged conventional email remains readable by the frontend consumer schema",
        async () => {
            for (const email of [
                "first.last+training@example.invalid",
                "o'brien@example.invalid",
                "member_name-2@example.invalid",
                "CAPITAL@EXAMPLE.INVALID",
            ]) {
                const current = await receive(
                    {
                        ...payload,
                        email,
                        company_name: "Fictional Email Consumer Company",
                    },
                    randomUUID(),
                    "c".repeat(64),
                );
                const received = await detail(manager, current);
                assert.equal(
                    z.email().safeParse(received.payload.email).success,
                    true,
                    email,
                );
            }
        },
    );
    await check(
        "Read/search/triage require current management capability and permission; clients cannot query internal intake",
        async () => {
            for (const who of [lecturer, client]) {
                await assert.rejects(detail(who, id), /management.*required/i);
                await assert.rejects(
                    actor(who, "select public.enquiry_inbox()", "aal1"),
                    /management.*required/i,
                );
            }
            assert.equal(
                (await detail(manager, id)).payload.message,
                payload.message,
            );
            const page = JSON.parse(
                await actor(
                    manager,
                    "select public.enquiry_inbox('Fictional Training Company')",
                    "aal1",
                ),
            );
            assert.equal(page.items[0].id, id);
            assert.equal(JSON.stringify(page).includes(payload.email), false);
        },
    );
    await check(
        "Sender-scoped persisted limits survive retries and do not trust submitted network headers",
        async () => {
            for (let index = 1; index < 10; index++)
                await receive(
                    {...payload, topic: `Fictional ${index}`},
                    randomUUID(),
                );
            await assert.rejects(
                receive({...payload, topic: "Overflow"}, randomUUID()),
                /rate limit/,
            );
            assert.equal(
                await receive(),
                id,
                "Exact retries do not consume another rate slot",
            );
            assert.ok(
                await receive(
                    {...payload, topic: "Independent integration sender"},
                    randomUUID(),
                    otherSender,
                ),
            );
        },
    );
    await check(
        "Management can create one explicit customer/contact without replacing original enquiry input",
        async () => {
            const key = randomUUID();
            await manage(manager, id, "create_customer", {}, 1, key);
            await manage(manager, id, "create_customer", {}, 1, key);
            const enquiry = await detail(manager, id);
            assert.ok(enquiry.organisation_id);
            assert.deepEqual(enquiry.payload, payload);
            assert.equal(
                await sql(
                    `select count(*)
                     from public.organisation_contacts
                     where organisation_id = '${enquiry.organisation_id}'`,
                ),
                "1",
            );
            await assert.rejects(
                manage(manager, id, "create_customer", {}, 2),
                /already linked/,
            );
            await assert.rejects(
                manage(manager, id, "assign", {user_id: lecturer}, 2),
                /assignee unavailable/,
            );
            await manage(manager, id, "assign", {user_id: admin}, 2);
            await manage(
                manager,
                id,
                "status",
                {status: "reviewing", reason: "Fictional triage accepted"},
                3,
            );
        },
    );
    const starts = new Date(Date.now() + 60 * 86400000).toISOString(),
        ends = new Date(Date.now() + 60 * 86400000 + 3600000).toISOString();
    const conversion = {
        template_id: "",
        time_zone: "Europe/Berlin",
        delivery_type: "online",
        venue: "",
        sessions: [{starts_at: starts, ends_at: ends}],
    };
    await check(
        "Failed conversion is transactional and cannot leave a template, run or changed enquiry",
        async () => {
            const templates = await sql(
                    "select count(*) from public.course_templates",
                ),
                runs = await sql("select count(*) from public.course_runs");
            await assert.rejects(
                manage(
                    manager,
                    id,
                    "convert",
                    {
                        ...conversion,
                        sessions: [
                            {starts_at: starts, ends_at: ends},
                            {starts_at: starts, ends_at: ends},
                        ],
                    },
                    4,
                ),
                /overlapping/,
            );
            assert.equal(
                await sql("select count(*) from public.course_templates"),
                templates,
            );
            assert.equal(await sql("select count(*) from public.course_runs"), runs);
            assert.equal((await detail(manager, id)).version, 4);
        },
    );
    await check(
        "Concurrent conversions produce one complete existing course run and reject the stale approver",
        async () => {
            const firstKey = randomUUID();
            const results = await Promise.allSettled([
                manage(manager, id, "convert", conversion, 4, firstKey),
                manage(admin, id, "convert", conversion, 4),
            ]);
            assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
            assert.equal(
                results.filter(
                    (r) =>
                        r.status === "rejected" && /Enquiry changed/.test(r.reason.message),
                ).length,
                1,
            );
            const enquiry = await detail(manager, id);
            assert.equal(enquiry.status, "converted");
            assert.ok(enquiry.course_run_id);
            assert.equal(
                await sql(
                    `select count(*)
                     from public.course_sessions
                     where course_run_id = '${enquiry.course_run_id}'`,
                ),
                "1",
            );
            assert.equal(
                await sql(
                    `select published
                     from public.course_runs
                     where id = '${enquiry.course_run_id}'`,
                ),
                "f",
            );
            assert.deepEqual(enquiry.payload, payload);
            assert.equal(await receive(), id);
            assert.equal(
                await sql(`select count(*)
                           from private.client_course_requests`),
                "0",
                "No invented commercial quote or accepted client request",
            );
            await assert.rejects(
                manage(
                    manager,
                    id,
                    "link_customer",
                    {organisation_id: enquiry.organisation_id},
                    5,
                ),
                /preserved/,
            );
        },
    );
    await check(
        "Reasoned closure/reopening and append-only notes retain full management history",
        async () => {
            const second = await receive(
                {...payload, topic: "Fictional follow-up"},
                randomUUID(),
                otherSender,
            );
            await manage(
                manager,
                second,
                "status",
                {status: "closed", reason: "Fictional duplicate reviewed"},
                1,
            );
            await manage(
                manager,
                second,
                "status",
                {status: "reviewing", reason: "Fictional reopening requested"},
                2,
            );
            await manage(
                manager,
                second,
                "note",
                {note: "Fictional clarification captured."},
                3,
            );
            const enquiry = await detail(admin, second);
            assert.equal(enquiry.history.length, 4);
            assert.equal(
                enquiry.history[3].reason,
                "Fictional clarification captured.",
            );
            await assert.rejects(
                actor(
                    manager,
                    "update private.website_enquiry_events set reason='overwrite'",
                    "aal1",
                ),
                /permission denied/,
            );
        },
    );
    await check(
        "An enquiry decision holding authority serializes a concurrent role/activity revocation before its commit",
        async () => {
            const request = randomUUID(),
                revokeTag = `enquiry_revoke_${randomUUID()}`;
            const current = await receive(
                {...payload, topic: "Fictional authority lock order"},
                randomUUID(),
                otherSender,
            );
            const gate = await hold(
                `select id
                 from private.website_enquiries
                 where id = '${current}' for update`,
            );
            try {
                const mutation = manage(
                    manager,
                    current,
                    "note",
                    {note: "Authorised before revocation commits"},
                    1,
                    request,
                );
                await waitBlocked(request);
                const revoked = sql(
                    `begin;set local application_name=${q(revokeTag)};delete from public.user_roles where user_id='${manager}';update public.profiles set active=false where id='${manager}';commit;`,
                );
                await waitBlocked(revokeTag);
                await gate.finish();
                await Promise.all([mutation, revoked]);
                assert.equal(
                    await sql(
                        `select version
                         from private.website_enquiries
                         where id = '${current}'`,
                    ),
                    "2",
                );
                await assert.rejects(
                    manage(
                        manager,
                        current,
                        "note",
                        {note: "Authorised before revocation commits"},
                        1,
                        request,
                    ),
                    /management.*required/i,
                );
                assert.equal(
                    await sql(
                        `select count(*)
                         from private.website_enquiry_events
                         where enquiry_id = '${current}' and action ='note'`,
                    ),
                    "1",
                );
            } finally {
                await gate.finish();
            }
            await sql(
                `update public.profiles
                 set active= true
                 where id = '${manager}';
                insert into public.user_roles
                values ('${manager}', 'management')`,
            );
        },
    );
    await check(
        "A revocation holding the profile first denies a blocked mutation without an event, receipt or version increment",
        async () => {
            const request = randomUUID();
            const current = await receive(
                {...payload, topic: "Fictional revocation wins"},
                randomUUID(),
                otherSender,
            );
            const gate = await hold(
                `select id
                 from public.profiles
                 where id = '${manager}' for update`,
            );
            try {
                const denied = assert.rejects(
                    manage(
                        manager,
                        current,
                        "note",
                        {note: "Must never be committed"},
                        1,
                        request,
                    ),
                    /management.*required/i,
                );
                await waitBlocked(request);
                await gate.finish(
                    `delete
                     from public.user_roles
                     where user_id = '${manager}';
                    update public.profiles
                    set active= false
                    where id = '${manager}';`,
                );
                await denied;
                assert.equal(
                    await sql(
                        `select version
                         from private.website_enquiries
                         where id = '${current}'`,
                    ),
                    "1",
                );
                assert.equal(
                    await sql(
                        `select count(*)
                         from private.website_enquiry_events
                         where enquiry_id = '${current}' and action ='note'`,
                    ),
                    "0",
                );
                assert.equal(
                    await sql(
                        `select count(*)
                         from private.website_enquiry_requests
                         where request_id = '${request}'`,
                    ),
                    "0",
                );
            } finally {
                await gate.finish();
            }
            await sql(
                `update public.profiles
                 set active= true
                 where id = '${manager}';
                insert into public.user_roles
                values ('${manager}', 'management')`,
            );
        },
    );
    await check(
        "A capability change committed during an enquiry-row wait is rechecked before any mutation",
        async () => {
            const request = randomUUID();
            const current = await receive(
                {...payload, topic: "Fictional post-wait authority"},
                randomUUID(),
                otherSender,
            );
            const gate = await hold(
                `select id
                 from private.website_enquiries
                 where id = '${current}' for update`,
            );
            try {
                const denied = assert.rejects(
                    manage(
                        manager,
                        current,
                        "note",
                        {note: "Must not pass a stale capability check"},
                        1,
                        request,
                    ),
                    /management.*required/i,
                );
                await waitBlocked(request);
                await sql(
                    "delete from public.role_permissions where role='management' and permission='organisations.manage'",
                );
                await gate.finish();
                await denied;
                assert.equal(
                    await sql(
                        `select version
                         from private.website_enquiries
                         where id = '${current}'`,
                    ),
                    "1",
                );
                assert.equal(
                    await sql(
                        `select count(*)
                         from private.website_enquiry_requests
                         where request_id = '${request}'`,
                    ),
                    "0",
                );
            } finally {
                await gate.finish();
                await sql(
                    "insert into public.role_permissions values('management','organisations.manage') on conflict do nothing",
                );
            }
        },
    );
    await check(
        "A conversion receipt cannot be reused after its separate course capability is revoked",
        async () => {
            const current = await receive(
                {...payload, topic: "Fictional conversion receipt authority"},
                randomUUID(),
                otherSender,
            );
            const organisation = (await detail(manager, id)).organisation_id;
            await manage(
                manager,
                current,
                "link_customer",
                {organisation_id: organisation},
                1,
            );
            const request = randomUUID();
            await manage(manager, current, "convert", conversion, 2, request);
            await sql(
                "delete from public.role_permissions where role='management' and permission='courses.manage'",
            );
            await assert.rejects(
                manage(manager, current, "convert", conversion, 2, request),
                /Course management.*required/i,
            );
            await sql(
                "insert into public.role_permissions values('management','courses.manage')",
            );
        },
    );
    await check(
        "Current permission revocation and suspension deny retained-token enquiry reads and mutations",
        async () => {
            await sql(`delete
                       from public.user_roles
                       where user_id = '${manager}'`);
            await assert.rejects(detail(manager, id), /management.*required/i);
            await assert.rejects(
                manage(manager, id, "note", {note: "Denied"}, 5),
                /management.*required/i,
            );
            await sql(`update public.profiles
                       set active= false
                       where id = '${admin}'`);
            await assert.rejects(detail(admin, id), /management.*required/i);
            for (const table of [
                "website_enquiries",
                "website_enquiry_events",
                "website_enquiry_requests",
            ])
                assert.equal(
                    await sql(
                        `select relrowsecurity
                         from pg_class
                         where oid = 'private.${table}'::regclass`,
                    ),
                    "t",
                );
        },
    );
    await check(
        "Strict PL/pgSQL diagnostics include every new implementation with no warnings or errors",
        async () => {
            await sql("create extension plpgsql_check with schema extensions");
            const functions = JSON.parse(
                await sql(
                    "select jsonb_agg(p.oid::regprocedure::text order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('receive_website_enquiry','enquiry_context','enquiry_inbox','enquiry_detail','manage_enquiry')",
                ),
            );
            assert.equal(functions.length, 5);
            for (const signature of functions) {
                const diagnostics = JSON.parse(
                    await sql(
                        `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
                         from extensions.plpgsql_check_function_tb(${q(signature)}::regprocedure) t`,
                    ),
                );
                assert.deepEqual(
                    diagnostics,
                    [],
                    `${signature}: ${JSON.stringify(diagnostics)}`,
                );
            }
        },
    );
    console.log(`\n${checks} website-enquiry PostgreSQL groups passed.`);
});