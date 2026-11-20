/** Bounded actual PostgreSQL discovery, private calendar checks and saved-view CAS. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {withTestDatabase, quoteSql as q} from "./testing/database.mjs";

let checks = 0;
await withTestDatabase("job_discovery", async ({sql, actor}) => {
    const manager = randomUUID(),
        teacher = randomUUID(),
        peer = randomUUID(),
        client = randomUUID(),
        learner = randomUUID(),
        topic = randomUUID();
    const people = [manager, teacher, peer, client, learner];
    await sql(
        `insert into auth.users(id,email)values${people.map((id, i) => `('${id}','discovery-${i}@example.invalid')`).join(",")};insert into public.user_roles(user_id,role)values('${manager}','admin'),('${teacher}','lecturer'),('${peer}','lecturer'),('${client}','client'),('${learner}','participant');insert into public.topics(id,label_de,label_en,kind,aliases)values('${topic}','Fiktives Werkzeug','Fictional tool','tool',array['Exact%_Alias'])`,
    );
    const check = async (name, run) => {
        await run();
        checks++;
        console.log("PASS " + name);
    };
    const rpc = async (
        who,
        filters = {},
        cursor = null,
        limit = 50,
        aal = "aal1",
    ) =>
        JSON.parse(
            await actor(
                who,
                `select public.job_discovery(${q(JSON.stringify(filters))}::jsonb,${cursor ? q(JSON.stringify(cursor)) + "::jsonb" : "null"},${limit})`,
                aal,
            ),
        );
    const detail = async (who, id, aal = "aal1") =>
        JSON.parse(await actor(who, `select public.job_detail('${id}')`, aal));
    await sql(
        `begin;insert into public.jobs(id,title,description,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms,requires_contract,created_at,created_by)select ('d7000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Discovery item '||lpad(n::text,4,'0'),'Fictional literal %_ description','Fictional [same] academy','online','published',25,100,'EUR','per_hour','Fictional immutable terms',false,'2040-01-01T00:00:00Z','${manager}'from generate_series(1,1057)n;insert into public.job_sessions(job_id,starts_at,ends_at)select id,'2060-01-01T23:30:00Z','2060-01-02T01:30:00Z'from public.jobs;commit`,
    );
    const all = async (sort, extra = {}) => {
        let cursor = null,
            ids = [];
        do {
            const page = await rpc(teacher, {sort, ...extra}, cursor, 100);
            assert.ok(page.items.length <= 100);
            ids.push(...page.items.map((i) => i.id));
            cursor = page.next_cursor;
            assert.equal(page.has_more, Boolean(cursor));
        } while (cursor);
        return ids;
    };
    await check(
        "More than one thousand same-timestamp offers page completely with stable total ordering",
        async () => {
            const ids = await all("newest");
            assert.equal(ids.length, 1057);
            assert.equal(new Set(ids).size, 1057);
            assert.deepEqual(ids, [...ids].sort().reverse());
            assert.deepEqual(await all("oldest"), [...ids].reverse());
            assert.deepEqual(await all("soonest"), [...ids].sort());
            assert.deepEqual(await all(undefined), [...ids].sort());
            assert.deepEqual(
                await all("total_asc", {currency: "EUR"}),
                [...ids].sort(),
            );
            assert.equal(
                (await detail(teacher, ids.at(-1))).title,
                "Discovery item 0001",
            );
            assert.equal(
                Number(
                    JSON.parse(await actor(teacher, "select public.job_dashboard()"))
                        .open_count,
                ),
                1057,
            );
        },
    );
    await check(
        "Actor scope, direct-ID access and aggregates preserve current role/permission and hidden gross boundaries",
        async () => {
            for (const who of [client, learner])
                await assert.rejects(rpc(who), /42501/);
            await sql(
                `insert into public.jobs(title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)values('Private draft','Fictional restricted','online','draft',1,1,'EUR','fixed_total','Private terms')`,
            );
            const hidden = await sql(
                "select id from public.jobs where title='Private draft'",
            );
            await assert.rejects(detail(teacher, hidden), /42501/);
            assert.equal((await detail(manager, hidden, "aal1")).status, "draft");
            assert.equal((await detail(manager, hidden)).status, "draft");
            const page = await rpc(teacher, {}, null, 2);
            assert.ok(
                page.items.every(
                    (j) => !("gross_amount" in j) && !("platform_percent" in j),
                ),
            );
            const summary = JSON.parse(
                await actor(teacher, "select public.job_dashboard()"),
            );
            assert.equal(summary.management, null);
            assert.equal(summary.suggestions.length, 2);
        },
    );
    await check(
        "Filters are literal, combine real session dates/topics/units and never compare currencies implicitly",
        async () => {
            const id = "d7000000-0000-4000-8000-000000000001";
            await sql(
                `insert into public.job_requirements(job_id,topic_id)values('${id}','${topic}')`,
            );
            let p = await rpc(teacher, {
                q: "Exact%_Alias",
                customer: "[same]",
                topic_ids: [topic],
                delivery: "online",
                currency: "EUR",
                unit: "per_hour",
                min_rate: 25,
                max_rate: 25,
                min_total: 100,
                max_total: 100,
                min_hours: 2,
                max_hours: 2,
                from: "2060-01-02",
                to: "2060-01-02",
                zone: "Europe/Berlin",
            });
            assert.deepEqual(
                p.items.map((j) => j.id),
                [id],
            );
            assert.equal((await rpc(teacher, {q: "Exact%XAlias"})).items.length, 0);
            assert.equal(
                (
                    await rpc(teacher, {
                        topic_ids: [topic],
                        from: "2060-01-01",
                        to: "2060-01-01",
                        zone: "Europe/Berlin",
                    })
                ).items.length,
                0,
            );
            assert.equal(
                (
                    await rpc(teacher, {
                        topic_ids: [topic],
                        from: "2060-01-02",
                        to: "2060-01-02",
                        zone: "UTC",
                    })
                ).items.length,
                1,
                "Overnight sessions match both actually attended local dates",
            );
            for (const filters of [
                {min_total: 1},
                {sort: "total_asc"},
                {sort: "rate_asc", currency: "EUR"},
                {user_id: peer},
                {from: "2060-02-31"},
                {from: "2061-01-01", to: "2060-01-01"},
                {topic_ids: [topic, topic]},
                {q: "x".repeat(161)},
            ])
                await assert.rejects(rpc(teacher, filters), /22023/);
            const first = await rpc(teacher, {}, null, 1);
            await assert.rejects(
                rpc(teacher, {q: "changed"}, first.next_cursor),
                /22023/,
            );
            await assert.rejects(rpc(teacher, {}, null, 101), /22023/);
        },
    );
    await check(
        "Default marketplace is upcoming-only and sorts by next session; subject selection ORs within its group",
        async () => {
            const marker = `Fictional history matrix ${randomUUID()}`,
                topicA = randomUUID(),
                topicB = randomUUID();
            await sql(
                `insert into public.topics(id, label_de, label_en, kind)
                 values ('${topicA}', 'Fictional subject A', 'Fictional subject A', 'topic'),
                        ('${topicB}', 'Fictional subject B', 'Fictional subject B', 'topic')`,
            );
            const cases = [
                {key: "soon", status: "published", start: "2060-06-01T08:00:00Z", topics: []},
                {key: "both", status: "published", start: "2060-06-02T08:00:00Z", topics: [topicA, topicB]},
                {key: "subject-b", status: "published", start: "2060-06-03T08:00:00Z", topics: [topicB]},
                {key: "subject-a", status: "published", start: "2060-06-04T08:00:00Z", topics: [topicA]},
                {key: "expired", status: "published", start: "2060-06-05T08:00:00Z", topics: [topicA], deadline: "2060-05-01T00:00:00Z"},
                {key: "draft", status: "draft", start: "2060-06-06T08:00:00Z", topics: []},
                {key: "filled", status: "filled", start: "2060-06-07T08:00:00Z", topics: []},
                {key: "archived", status: "archived", start: "2060-06-08T08:00:00Z", topics: []},
                {key: "past", status: "filled", start: "2020-06-01T08:00:00Z", topics: []},
            ].map((item) => ({...item, id: randomUUID()}));
            for (const item of cases) {
                await sql(
                    `insert into public.jobs(id, title, customer_name, delivery_type, status, amount, total_amount, currency, rate_unit, terms, requires_contract, created_at, created_by, claim_deadline)
                     values ('${item.id}', 'Fictional ${item.key}', '${marker}', 'online', '${item.status}', 100, 100, 'EUR', 'fixed_total', 'Fictional history terms', false, '2040-01-01T00:00:00Z', '${manager}', ${item.deadline ? `'${item.deadline}'` : "null"});
                    insert into public.job_sessions(job_id, starts_at, ends_at)
                    values ('${item.id}', '${item.start}'::timestamptz, '${item.start}'::timestamptz+interval '1 hour')`,
                );
                if (item.topics.length)
                    await sql(
                        `insert into public.job_requirements(job_id, topic_id) values ${item.topics.map((id) => `('${item.id}','${id}')`).join(",")}`,
                    );
            }

            const open = await rpc(manager, {customer: marker});
            assert.equal(open.filters.sort, "soonest");
            assert.equal(open.filters.include_history, false);
            assert.deepEqual(
                open.items.map((item) => item.title),
                ["Fictional soon", "Fictional both", "Fictional subject-b", "Fictional subject-a"],
            );
            const byEitherSubject = await rpc(manager, {
                customer: marker,
                topic_ids: [topicA, topicB],
            });
            assert.deepEqual(
                byEitherSubject.items.map((item) => item.title),
                ["Fictional both", "Fictional subject-b", "Fictional subject-a"],
            );
            const history = await rpc(manager, {
                customer: marker,
                include_history: true,
            });
            assert.equal(history.items.length, cases.length);
            assert.equal(history.filters.include_history, true);
            assert.ok(history.items.some((item) => item.title === "Fictional archived"));
            assert.ok(history.items.some((item) => item.title === "Fictional expired"));
            assert.equal(
                (await rpc(manager, {customer: marker, include_history: true, topic_ids: [topicA, topicB]})).items.length,
                4,
            );
        },
    );
    await check(
        "Availability filtering reads only own private events and blocks every session without reserving anything",
        async () => {
            const id = "d7000000-0000-4000-8000-000000000001";
            await actor(
                peer,
                "insert into public.personal_events(user_id,title,starts_at,ends_at)values(auth.uid(),'Fictional peer private','2060-01-01T23:00:00Z','2060-01-02T02:00:00Z')",
            );
            assert.equal(
                (await rpc(teacher, {topic_ids: [topic], available_only: true})).items
                    .length,
                1,
            );
            await actor(
                teacher,
                "insert into public.personal_events(user_id,title,starts_at,ends_at)values(auth.uid(),'Fictional own private','2060-01-01T23:00:00Z','2060-01-02T02:00:00Z')",
            );
            assert.equal(
                (await rpc(teacher, {topic_ids: [topic], available_only: true})).items
                    .length,
                0,
            );
            assert.equal(
                await sql(`select count(*)from public.job_claims where job_id='${id}'`),
                "0",
            );
            await sql(
                `delete from public.personal_events where user_id='${teacher}'`,
            );
            const block = randomUUID();
            await actor(
                teacher,
                `select public.save_lecturer_availability('${block}','{"kind":"unavailable","starts_at":"2060-01-01T23:00:00Z","ends_at":"2060-01-02T02:00:00Z","time_zone":"Europe/Berlin","notes":"Fictional own blockout","share_with_management":false}',0)`,
            );
            assert.equal(
                (await rpc(teacher, {topic_ids: [topic], available_only: true})).items
                    .length,
                0,
            );
            await actor(
                teacher,
                `select public.remove_lecturer_availability('${block}',1)`,
            );
        },
    );
    await check(
        "Saved views are private, canonical, retry safe and compare-and-swap concurrent changes",
        async () => {
            const id = randomUUID(),
                filters = {q: "%_", currency: "AUD", sort: "total_desc"};
            const save = (who, name, version = 0, values = filters) =>
                actor(
                    who,
                    `select public.save_job_view('${id}',${q(name)},${q(JSON.stringify(values))}::jsonb,${version})`,
                );
            const first = JSON.parse(await save(teacher, "Fictional personal view"));
            assert.equal(first.version, 1);
            assert.equal(
                JSON.parse(await save(teacher, "Fictional personal view")).id,
                id,
            );
            assert.deepEqual(
                JSON.parse(await actor(peer, "select public.saved_job_views()")),
                [],
            );
            await assert.rejects(save(peer, "Forged foreign view", 1), /42501/);
            await assert.rejects(
                actor(manager, `select public.remove_job_view('${id}',1)`, "aal1"),
                /42501/,
            );
            const writes = await Promise.allSettled([
                save(teacher, "Renamed A", 1),
                save(teacher, "Renamed B", 1),
            ]);
            assert.equal(writes.filter((r) => r.status === "fulfilled").length, 1);
            assert.match(
                writes.find((r) => r.status === "rejected").reason.message,
                /40001/,
            );
            await assert.rejects(
                save(teacher, "Bad filters", 2, {roles: ["admin"]}),
                /22023/,
            );
            await actor(teacher, `select public.remove_job_view('${id}',2)`);
            assert.deepEqual(
                JSON.parse(await actor(teacher, "select public.saved_job_views()")),
                [],
            );
        },
    );
    await check(
        "Saved view quotas and stale removals preserve twenty private bounded records",
        async () => {
            const ids = Array.from({length: 20}, randomUUID);
            for (const [id, index] of ids.map((id, index) => [id, index]))
                await actor(
                    teacher,
                    `select public.save_job_view('${id}','Fictional quota ${index}','{}',0)`,
                );
            assert.equal(
                JSON.parse(await actor(teacher, "select public.saved_job_views()"))
                    .length,
                20,
            );
            await assert.rejects(
                actor(
                    teacher,
                    `select public.save_job_view('${randomUUID()}','Fictional overflow','{}',0)`,
                ),
                /54000/,
            );
            await assert.rejects(
                actor(teacher, `select public.remove_job_view('${ids[0]}',2)`),
                /40001/,
            );
            assert.equal(
                JSON.parse(await actor(teacher, "select public.saved_job_views()"))
                    .length,
                20,
            );
            await actor(teacher, `select public.remove_job_view('${ids[0]}',1)`);
            await actor(
                teacher,
                `select public.save_job_view('${randomUUID()}','Fictional replacement quota','{}',0)`,
            );
            assert.equal(
                JSON.parse(await actor(teacher, "select public.saved_job_views()"))
                    .length,
                20,
            );
        },
    );
    await check(
        "Calendar titles come only from own confirmed allocations and declared expertise remains valid after attestation expiry",
        async () => {
            const id = "d7000000-0000-4000-8000-000000000002";
            const accepted = JSON.parse(
                await actor(
                    teacher,
                    `select public.claim_job('${id}','${randomUUID()}',1)`,
                ),
            );
            assert.equal(accepted.status, "confirmed");
            const titles = (who) =>
                actor(
                    who,
                    `select public.assignment_job_titles(array['${id}'::uuid,'d7000000-0000-4000-8000-000000000001'::uuid])`,
                ).then(JSON.parse);
            assert.deepEqual(await titles(teacher), [
                {id, title: "Discovery item 0002"},
            ]);
            assert.deepEqual(await titles(peer), []);
            assert.deepEqual(await titles(manager), []);
            let summary = JSON.parse(
                await actor(teacher, "select public.job_dashboard()"),
            );
            assert.equal(summary.assignment_count, 1);
            assert.equal(summary.next_session_count, 1);
            assert.equal(summary.next_assignments[0].job.id, id);
            await sql(
                `insert into public.lecturer_topics(user_id,topic_id,verified,valid_until)values('${teacher}','${topic}',true,'2061-01-01T00:00:00Z')`,
            );
            summary = JSON.parse(
                await actor(teacher, "select public.job_dashboard()"),
            );
            assert.equal(summary.matching, true);
            assert.equal(
                summary.suggestions[0].id,
                "d7000000-0000-4000-8000-000000000001",
            );
            await sql(
                `update public.lecturer_topics set valid_until='2059-01-01T00:00:00Z'where user_id='${teacher}'and topic_id='${topic}'`,
            );
            assert.equal(
                JSON.parse(await actor(teacher, "select public.job_dashboard()"))
                    .matching,
                true,
            );
            await sql(
                `insert into public.job_sessions(job_id,starts_at,ends_at)values('d7000000-0000-4000-8000-000000000001','2060-01-10T08:00:00Z','2060-01-10T10:00:00Z')`,
            );
            assert.equal(
                (
                    await rpc(teacher, {
                        topic_ids: [topic],
                        from: "2060-01-05",
                        to: "2060-01-06",
                        zone: "UTC",
                    })
                ).items.length,
                0,
                "A gap between sessions is not a matching teaching day",
            );
        },
    );
    await check(
        "Role removal commits before waiting saved-view creates or deletes, with fresh authorization after the profile lock",
        async () => {
            const subject = randomUUID();
            await sql(
                `insert into auth.users(id,email)values('${subject}','discovery-revocation@example.invalid')`,
            );
            const waitUntil = async (condition, message) => {
                for (let n = 0; n < 300; n++) {
                    if ((await sql(condition)) === "t") return;
                    await new Promise((resolve) => setTimeout(resolve, 50));
                }
                assert.fail(message);
            };
            for (const operation of ["save", "remove"]) {
                await actor(
                    manager,
                    `select public.set_account_roles('${subject}',array['lecturer'])`,
                    "aal1",
                );
                const id = randomUUID(),
                    label = `job_view_revocation_${operation}`;
                if (operation === "remove")
                    await actor(
                        subject,
                        `select public.save_job_view('${id}','Fictional retained revoked view','{}',0)`,
                    );
                // This transaction has already performed the REAL public role mutation,
                // holding the profile FOR UPDATE, but its revocation is not committed.
                const revocation = Promise.allSettled([
                    actor(
                        manager,
                        `select set_config('application_name','${label}',true);select public.set_account_roles('${subject}',array['guest']);select pg_sleep(3)`,
                        "aal1",
                    ),
                ]);
                await waitUntil(
                    `select exists(select 1 from pg_stat_activity where datname=current_database()and application_name='${label}'and wait_event='PgSleep')`,
                    "Role mutation reached its controlled pre-commit barrier",
                );
                assert.equal(
                    await sql(
                        `select exists(select 1 from public.user_roles where user_id='${subject}'and role='lecturer')`,
                    ),
                    "t",
                    "The mutation starts while the old role is still visible",
                );
                const mutation = Promise.allSettled([
                    actor(
                        subject,
                        `select set_config('application_name','${label}_waiting',true);select public.${operation === "save" ? `save_job_view('${id}','Fictional rejected revoked create','{}',0)` : `remove_job_view('${id}',1)`}`,
                    ),
                ]);
                await waitUntil(
                    `select exists(select 1 from pg_stat_activity where datname=current_database()and application_name='${label}_waiting'and wait_event_type='Lock')`,
                    "Saved-view mutation actually waits behind the profile revocation",
                );
                const [roleResult] = await revocation;
                assert.equal(roleResult.status, "fulfilled");
                const [result] = await mutation;
                assert.equal(result.status, "rejected");
                assert.match(result.reason.message, /42501/);
                assert.equal(
                    await sql(
                        `select string_agg(role,',')from public.user_roles where user_id='${subject}'`,
                    ),
                    "guest",
                );
                assert.equal(
                    await sql(
                        `select count(*)from private.saved_job_views where id='${id}'`,
                    ),
                    operation === "save" ? "0" : "1",
                    "Revoked creates write nothing and revoked removals preserve the observed view",
                );
                if (operation === "remove")
                    assert.equal(
                        await sql(
                            `select version from private.saved_job_views where id='${id}'`,
                        ),
                        "1",
                    );
            }
            assert.equal(
                await sql(
                    "select bool_and(p.provolatile='v')from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('private','public')and p.proname in('save_job_view','remove_job_view')",
                ),
                "t",
            );
            await actor(
                manager,
                `select public.set_account_roles('${subject}',array['lecturer'])`,
                "aal1",
            );
        },
    );
    await check(
        "Existing-token revocation and complete anonymous/helper grants remain authoritative",
        async () => {
            await sql(`delete from public.user_roles where user_id='${teacher}'`);
            await assert.rejects(rpc(teacher), /42501/);
            await assert.rejects(
                actor(teacher, "select public.saved_job_views()"),
                /42501/,
            );
            await sql(`update public.profiles set active=false where id='${peer}'`);
            await assert.rejects(rpc(peer), /42501/);
            assert.equal(
                await sql(
                    "select count(*)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')and has_function_privilege('anon',p.oid,'execute')and p.oid not in(to_regprocedure('public.require_portal_access()'),to_regprocedure('private.require_portal_access()'))",
                ),
                "0",
            );
            assert.equal(
                await sql(
                    "select count(*)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and p.proname in('job_discovery_filters','job_discovery_candidates','job_discovery_item')and has_function_privilege('authenticated',p.oid,'execute')",
                ),
                "0",
            );
        },
    );
});
console.log(`${checks} job-discovery PostgreSQL groups passed.`);