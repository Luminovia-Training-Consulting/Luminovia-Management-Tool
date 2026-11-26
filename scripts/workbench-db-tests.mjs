import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("workbench_test", async ({sql, actor}) => {
    const [owner, peer, admin] = Array.from({length: 3}, randomUUID);
    const j = (v) => `${q(JSON.stringify(v))}::jsonb`;
    const rpc = (id, name, args = [], aal = "aal1") =>
        actor(
            id,
            `select coalesce(to_jsonb(public.${name}(${args.join(",")})),'null'::jsonb)`,
            aal,
        ).then(JSON.parse);
    await sql(
        `insert into auth.users(id,email) values(${q(owner)},'work-owner@example.invalid'),(${q(peer)},'work-peer@example.invalid'),(${q(admin)},'work-admin@example.invalid');insert into public.user_roles(user_id,role) values(${q(owner)},'lecturer'),(${q(peer)},'lecturer'),(${q(admin)},'admin')`,
    );
    const payload = (extra = {}) => ({
        title: "Fictional task",
        description: "Authored private description",
        state: "open",
        due_at: null,
        time_zone: "Europe/Berlin",
        scope: "private",
        assignee_id: owner,
        source_message_id: null,
        ...extra,
    });
    const create = (id = owner, p = payload(), request = randomUUID()) =>
        rpc(id, "save_work_task", ["null", j(p), 0, q(request)]);
    let checks = 0;
    const check = async (name, fn) => {
        await fn();
        console.log(`PASS ${name}`);
        checks++;
    };
    let first;
    await check(
        "Private tasks stay hidden from peers and administrator; identity is server-owned",
        async () => {
            first = await create();
            assert.equal((await rpc(owner, "work_tasks")).items.length, 1);
            assert.deepEqual((await rpc(peer, "work_tasks")).items, []);
            assert.deepEqual((await rpc(admin, "work_tasks", [], "aal1")).items, []);
            await assert.rejects(
                actor(admin, "select * from private.work_tasks", "aal1"),
                /permission denied/,
            );
            await assert.rejects(
                create(owner, payload({assignee_id: peer})),
                /42501/,
            );
            await assert.rejects(
                create(owner, payload({creator_id: admin})),
                /22023/,
            );
        },
    );
    await check(
        "Create retries are idempotent; changed payload with same request is rejected",
        async () => {
            const key = randomUUID();
            const a = await create(owner, payload({title: "Retry task"}), key);
            const b = await create(owner, payload({title: "Retry task"}), key);
            assert.equal(a.id, b.id);
            await assert.rejects(
                create(owner, payload({title: "Changed retry"}), key),
                /22023/,
            );
        },
    );
    await check(
        "Concurrent task revisions choose one committed winner and preserve history",
        async () => {
            const results = await Promise.allSettled(
                ["doing", "done"].map((state) =>
                    rpc(owner, "save_work_task", [
                        q(first.id),
                        j(payload({state})),
                        first.version,
                        "null",
                    ]),
                ),
            );
            assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
            assert.match(
                results.find((r) => r.status === "rejected").reason.message,
                /40001/,
            );
            assert.equal(
                (await rpc(owner, "work_task_history", [q(first.id)])).length,
                2,
            );
            await assert.rejects(
                rpc(peer, "work_task_history", [q(first.id)]),
                /42501/,
            );
        },
    );
    await check(
        "Atomic bulk update rolls back earlier items on a stale later revision",
        async () => {
            const a = await create(owner, payload({title: "Bulk A"})),
                b = await create(owner, payload({title: "Bulk B"}));
            await assert.rejects(
                rpc(owner, "bulk_work_task_state", [
                    j([
                        {id: a.id, version: a.version},
                        {id: b.id, version: 999},
                    ]),
                    q("done"),
                ]),
                /40001/,
            );
            const items = (await rpc(owner, "work_tasks")).items;
            assert.equal(items.find((t) => t.id === a.id).state, "open");
            assert.equal(items.find((t) => t.id === b.id).state, "open");
            assert.equal(
                await rpc(owner, "bulk_work_task_state", [
                    j([
                        {id: a.id, version: a.version},
                        {id: b.id, version: b.version},
                    ]),
                    q("done"),
                ]),
                2,
            );
        },
    );
    await check(
        "Operations delegation needs current management permission; assignee can change status only",
        async () => {
            await assert.rejects(
                create(owner, payload({scope: "operations", assignee_id: peer})),
                /42501/,
            );
            const operation = await create(
                admin,
                payload({scope: "operations", assignee_id: peer}),
            );
            assert.equal((await rpc(peer, "work_tasks")).items[0].id, operation.id);
            await assert.rejects(
                rpc(peer, "save_work_task", [
                    q(operation.id),
                    j(
                        payload({
                            title: "Forged title",
                            scope: "operations",
                            assignee_id: peer,
                        }),
                    ),
                    operation.version,
                    "null",
                ]),
                /42501/,
            );
            assert.equal(
                (
                    await rpc(peer, "save_work_task", [
                        q(operation.id),
                        j(
                            payload({
                                state: "doing",
                                scope: "operations",
                                assignee_id: peer,
                            }),
                        ),
                        operation.version,
                        "null",
                    ])
                ).state,
                "doing",
            );
        },
    );
    await check(
        "Linked message task is own/private and hidden after room revocation",
        async () => {
            const room = await rpc(owner, "create_dm", [q(peer)]);
            const message = await rpc(owner, "send_message", [
                q(room),
                q("PRIVATE CHAT BODY"),
                q(randomUUID()),
            ]);
            const messageId = typeof message === "string" ? message : message.id;
            const linked = await create(
                owner,
                payload({title: "Follow up", source_message_id: messageId}),
            );
            assert.equal(linked.source_room_id, room);
            assert.equal(linked.source_message_id, messageId);
            assert.ok(!JSON.stringify(linked).includes("PRIVATE CHAT BODY"));
            await assert.rejects(
                rpc(
                    admin,
                    "save_work_task",
                    [
                        "null",
                        j(payload({assignee_id: admin, source_message_id: messageId})),
                        0,
                        q(randomUUID()),
                    ],
                    "aal1",
                ),
                /42501/,
            );
            await sql(
                `update public.chat_members set removed_at=now() where room_id=${q(room)} and user_id=${q(owner)}`,
            );
            assert.ok(
                !(await rpc(owner, "work_tasks")).items.some((t) => t.id === linked.id),
            );
            await assert.rejects(
                rpc(owner, "work_task_history", [q(linked.id)]),
                /42501/,
            );
        },
    );
    await check(
        "Workflow applies an immutable revision exactly once per request",
        async () => {
            const template = await rpc(owner, "save_work_template", [
                "null",
                j({
                    title: "Fictional preparation",
                    shared: false,
                    archived: false,
                    items: [
                        {title: "Check files", days: 0},
                        {title: "Contact customer", days: 2},
                    ],
                }),
                0,
            ]);
            const request = randomUUID();
            const a = await rpc(owner, "apply_work_template", [
                    q(template.id),
                    template.version,
                    q(request),
                ]),
                b = await rpc(owner, "apply_work_template", [
                    q(template.id),
                    template.version,
                    q(request),
                ]);
            assert.deepEqual(a, b);
            assert.equal(a.length, 2);
            await assert.rejects(
                rpc(peer, "apply_work_template", [
                    q(template.id),
                    template.version,
                    q(randomUUID()),
                ]),
                /42501/,
            );
            await assert.rejects(
                rpc(owner, "save_work_template", [
                    q(template.id),
                    j({
                        title: "Stale",
                        shared: false,
                        archived: false,
                        items: [{title: "x", days: 0}],
                    }),
                    0,
                ]),
                /40001/,
            );
        },
    );
    await check(
        "Topic favourites stay private, reject inaccessible customers and revoked resources",
        async () => {
            const topic = randomUUID(),
                organisation = randomUUID();
            await sql(
                `insert into public.topics(id,label_de,label_en,kind) values(${q(topic)},'Fictional favourite','Fictional favourite','topic');insert into public.organisations(id,name) values(${q(organisation)},'PRIVATE CUSTOMER')`,
            );
            assert.equal(
                await rpc(owner, "set_favourite", [q("topic"), q(topic), "true"]),
                true,
            );
            assert.equal((await rpc(owner, "my_favourites")).items.length, 1);
            assert.deepEqual((await rpc(peer, "my_favourites")).items, []);
            await assert.rejects(
                rpc(owner, "set_favourite", [
                    q("organisation"),
                    q(organisation),
                    "true",
                ]),
                /42501/,
            );
            await sql(
                `update public.topics set archived_at=now() where id=${q(topic)}`,
            );
            assert.deepEqual((await rpc(owner, "my_favourites")).items, []);
            assert.equal(
                await rpc(owner, "set_favourite", [q("topic"), q(topic), "false"]),
                false,
            );
        },
    );
    await check(
        "Organisation suggestions keep course, customer and management scope and exclude archives",
        async () => {
            const [client, visible, customer, hidden, archived, template, run, job, claim] =
                Array.from({length: 9}, randomUUID);
            await sql(`
                insert into auth.users(id,email) values(${q(client)},'work-client@example.invalid');
                insert into public.user_roles(user_id,role) values(${q(client)},'client');
                insert into public.organisations(id,name,archived_at) values
                    (${q(visible)},'Workbench suggestion A',null),
                    (${q(customer)},'Workbench suggestion B',null),
                    (${q(hidden)},'Workbench suggestion C',null),
                    (${q(archived)},'Workbench suggestion D',now());
                insert into public.client_organisation_memberships(user_id,organisation_id) values(${q(client)},${q(customer)});
                insert into public.course_templates(id,title) values(${q(template)},'Fictional workbench catalogue');
                insert into public.course_runs(id,template_id,organisation_id)
                    values(${q(run)},${q(template)},${q(visible)});
                insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms)
                    values(${q(job)},${q(run)},'Fictional teaching offer','Workbench suggestion A','online','published',100,'EUR','fixed_total',100,'Fictional teaching terms');
            `);
            const suggestions = async (id, search = "WORKBENCH SUGGESTION") =>
                (await rpc(id, "my_favourites", [q(search)])).organisations.map(
                    (row) => row.id,
                );
            assert.deepEqual(await suggestions(owner), []);
            assert.deepEqual(await suggestions(client), [customer]);
            assert.deepEqual(await suggestions(admin), [visible, customer, hidden]);
            await sql(`insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,status,amount,currency,rate_unit,total_amount,terms,terms_version)
                values(${q(claim)},${q(job)},${q(owner)},${q(randomUUID())},'confirmed',100,'EUR','fixed_total',100,'Fictional teaching terms',1)`);
            assert.deepEqual(await suggestions(owner), [visible]);
            assert.deepEqual(await suggestions(owner, "suggestion B"), []);
            await sql(
                `update public.job_claims set status='cancelled' where id=${q(claim)}`,
            );
            assert.deepEqual(await suggestions(owner), []);
        },
    );
    await check(
        "Recommendations rank self-selected subject area and recheck scheduling conflicts",
        async () => {
            const topic = randomUUID(),
                preferred = randomUUID(),
                general = randomUUID();
            await sql(`insert into public.topics(id,label_de,label_en,kind) values(${q(topic)},'Recommendation test','Recommendation test','topic');insert into public.lecturer_topics(user_id,topic_id,verified) values(${q(owner)},${q(topic)},true);
      insert into public.jobs(id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms) values(${q(preferred)},'Preferred recommendation','Fictional academy','online','published',100,'EUR','fixed_total',100,'Fictional immutable terms'),(${q(general)},'General recommendation','Fictional academy','online','published',100,'EUR','fixed_total',100,'Fictional immutable terms');
      insert into public.job_sessions(job_id,starts_at,ends_at) values(${q(preferred)},now()+interval '2 days',now()+interval '2 days 1 hour'),(${q(general)},now()+interval '4 days',now()+interval '4 days 1 hour');insert into public.job_requirements(job_id,topic_id) values(${q(preferred)},${q(topic)});`);
            await rpc(owner, "set_favourite", [q("topic"), q(topic), "true"]);
            const rows = await rpc(owner, "recommended_jobs");
            assert.equal(rows[0].id, preferred);
            assert.equal(rows[0].topic_matches, 1);
            assert.equal(rows[0].favourite_topic, true);
            await sql(
                `update public.lecturer_topics
                 set valid_until=now() + interval '1 day'
                 where user_id=${q(owner)}
                   and topic_id=${q(topic)}`,
            );
            assert.ok(
                (await rpc(owner, "recommended_jobs")).some(
                    (row) => row.id === preferred,
                ),
                "self-selected subject areas do not depend on verification expiry",
            );
            await sql(
                `update public.lecturer_topics
                 set valid_until=null
                 where user_id = ${q(owner)}
                   and topic_id = ${q(topic)};
                insert into public.personal_events(user_id, title, starts_at, ends_at)
                select ${q(owner)}, 'Private conflict', starts_at, ends_at
                from public.job_sessions
                where job_id = ${q(preferred)}`,
            );
            assert.ok(
                !(await rpc(owner, "recommended_jobs")).some(
                    (row) => row.id === preferred,
                ),
            );
            assert.ok(
                (await rpc(owner, "recommended_jobs")).some(
                    (row) => row.id === general,
                ),
            );
        },
    );
    await check(
        "Finite cursors and filters reject invalid pairing and return stable pages",
        async () => {
            const page = await rpc(owner, "work_tasks", ["null", "null", 2, q("")]);
            assert.equal(page.items.length, 2);
            const last = page.items.at(-1),
                next = await rpc(owner, "work_tasks", [
                    q(last.created_at),
                    q(last.id),
                    2,
                    q(""),
                ]);
            assert.equal(
                new Set([...page.items, ...next.items].map((t) => t.id)).size,
                4,
            );
            await assert.rejects(
                rpc(owner, "work_tasks", [q(last.created_at), "null", 50, q("")]),
                /22023/,
            );
        },
    );
    await check(
        "Direct task lookup reaches beyond the first50 and preserves foreign/source revocation",
        async () => {
            await sql(
                `insert into private.work_tasks(creator_id,assignee_id,scope,title,description,client_id,request_payload,created_at) select ${q(owner)},${q(owner)},'private','Fictional page padding '||n,'',gen_random_uuid(),'{}'::jsonb,now()+make_interval(secs=>n) from generate_series(1,55) n`,
            );
            const page = await rpc(owner, "work_tasks");
            assert.equal(page.items.length, 50);
            assert.ok(!page.items.some((item) => item.id === first.id));
            assert.equal(
                (await rpc(owner, "work_task_detail", [q(first.id)])).id,
                first.id,
            );
            assert.equal(await rpc(peer, "work_task_detail", [q(first.id)]), null);
            assert.equal(
                await rpc(admin, "work_task_detail", [q(first.id)], "aal1"),
                null,
            );
            assert.equal(
                await rpc(owner, "work_task_detail", [q(randomUUID())]),
                null,
            );
            const hidden = await sql(
                `select id from private.work_tasks where creator_id=${q(owner)} and source_message_id is not null limit 1`,
            );
            assert.equal(await rpc(owner, "work_task_detail", [q(hidden)]), null);
        },
    );
    console.log(`${checks} workbench PostgreSQL groups passed`);
});
