/** Real PostgreSQL exact-version grants, legacy history, ownership and lock races. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {portalOpenApi} from "../src/features/developer-api/contract.ts";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

let checks = 0;
await withTestDatabase("qualification", async ({sql, actor}) => {
    const manager = randomUUID(),
        teacher = randomUUID(),
        peer = randomUUID(),
        topic = randomUUID(),
        second = randomUUID();
    await sql(
        `insert into auth.users(id, email)
         values (${q(manager)}, 'q-manager@example.invalid'),
                (${q(teacher)}, 'q-teacher@example.invalid'),
                (${q(peer)}, 'q-peer@example.invalid');
        insert into public.user_roles(user_id, role)
        values (${q(manager)}, 'management'),
               (${q(teacher)}, 'lecturer'),
               (${q(peer)}, 'lecturer');
        insert into public.topics(id, label_de, label_en, kind)
        values (${q(topic)}, 'Belegthema', 'Evidence topic', 'topic'),
               (${q(second)}, 'Belegthema 2', 'Evidence topic 2', 'topic');
        insert into public.lecturer_topics(user_id, topic_id)
        values (${q(teacher)}, ${q(topic)}),
               (${q(teacher)}, ${q(second)}),
               (${q(peer)}, ${q(topic)})`,
    );

    async function document(owner, kind = "certificate", status = "clean") {
        const doc = randomUUID(),
            v1 = randomUUID(),
            v2 = randomUUID();
        await sql(
            `insert into public.documents(id, owner_id, uploaded_by, scope, kind, original_name, mime_type, size_bytes, status, client_id)
             values (${q(doc)}, ${q(owner)}, ${q(owner)}, 'personal', ${q(kind)}, 'Latest.txt', 'text/plain', 3, ${q(status)}, ${q(randomUUID())});
            insert into public.document_versions(id, document_id, uploaded_by, client_id, version, object_path, original_name, mime_type, size_bytes, status, sha256)
            values (${q(v1)}, ${q(doc)}, ${q(owner)}, ${q(randomUUID())}, 1, ${q(doc + "/v1")}, 'Original.txt', 'text/plain', 3, ${q(status)}, repeat('a', 64)),
                   (${q(v2)}, ${q(doc)}, ${q(owner)}, ${q(randomUUID())}, 2, ${q(doc + "/v2")}, 'Latest.txt', 'text/plain', 3, ${q(status)}, repeat('b', 64));
            update public.documents
            set current_version_id=${q(v2)}
            where id = ${q(doc)}`,
        );
        return {doc, v1, v2};
    }

    const cert = await document(teacher),
        foreign = await document(peer),
        cv = await document(teacher, "cv"),
        rejected = await document(teacher, "certificate", "rejected");
    const {paths} = portalOpenApi("https://portal.example.invalid");
    const schema = (name) => z.fromJSONSchema(
        paths[`/rest/v1/rpc/${name}`].post.responses["200"].content["application/json"].schema,
    );
    const parse = (name) => {
        const response = schema(name);
        return (data) => response.parse(JSON.parse(data));
    };
    const recordResponse = parse("qualification_review");
    const saveResponse = parse("save_qualification_evidence");
    const attestResponse = parse("attest_qualification");
    const historyResponse = parse("qualification_history");
    const certificatesResponse = parse("own_qualification_certificates");
    const record = (who = teacher, t = topic) =>
        actor(
            who,
            `select public.qualification_review(${q(teacher)},${q(t)})`,
            "aal1",
        ).then(recordResponse);
    const save = (
        version,
        expected,
        key = randomUUID(),
        who = teacher,
        t = topic,
    ) =>
        actor(
            who,
            `select public.save_qualification_evidence(${q(t)},${version ? q(version) : "null"},${expected},${q(key)})`,
        ).then(saveResponse);
    const access = (id, who = manager, aal = "aal1") =>
        actor(
            who,
            `select public.qualification_evidence_access(${q(id)})`,
            aal,
        ).then(JSON.parse);
    const attest = (evidence, expected, key = randomUUID(), who = manager) =>
        actor(
            who,
            `select public.attest_qualification(${q(teacher)},${q(topic)},true,'2045-01-01T00:00Z',${evidence ? q(evidence) : "null"},${expected},${q(key)})`,
            "aal1",
        ).then(attestResponse);
    const history = (who = manager, limit = 20, cursor = null) =>
        actor(
            who,
            `select public.qualification_history(${q(teacher)},${q(topic)},${cursor ? q(cursor.at) : "null"},${cursor ? q(cursor.id) : "null"},${limit})`,
            "aal1",
        ).then(historyResponse);
    const check = async (name, run) => {
        await run();
        checks++;
        console.log("PASS " + name);
    };
    await check(
        "Foreign certificate blanket removed; independent permission CV policy retained",
        async () => {
            assert.equal(
                await actor(
                    manager,
                    `select count(*)
                     from public.documents
                     where id = ${q(cert.doc)}`,
                    "aal1",
                ),
                "0",
            );
            assert.equal(
                await actor(
                    manager,
                    `select count(*)
                     from public.document_versions
                     where document_id = ${q(cert.doc)}`,
                    "aal1",
                ),
                "0",
            );
            assert.equal(
                await actor(
                    manager,
                    `select count(*)
                     from public.documents
                     where id = ${q(cv.doc)}`,
                    "aal1",
                ),
                "1",
            );
            assert.equal(
                await actor(
                    manager,
                    `select count(*)
                     from public.documents
                     where id = ${q(cv.doc)}`,
                ),
                "1",
            );
            const page = certificatesResponse(
                await actor(
                    teacher,
                    `select public.own_qualification_certificates('Original',null,null,1)`,
                ),
            );
            assert.equal(page.items.length, 1);
            assert.equal(page.items[0].version_id, cert.v1);
            assert.equal(page.has_more, false);
        },
    );
    await check(
        "Delegated certificates retain the lecturer owner and the authorised uploader",
        async () => {
            const request = randomUUID();
            const reserve = (owner, client) =>
                `select public.reserve_document('Proof.txt','text/plain',3,'personal','certificate',null,null,${q(client)},null,${q(owner)})`;
            const first = JSON.parse(await actor(manager, reserve(teacher, request), "aal1"));
            assert.equal(first.status, "quarantined");
            assert.deepEqual(JSON.parse(await actor(manager, reserve(teacher, request), "aal1")), first);
            assert.equal(await sql(`select owner_id || ':' || uploaded_by from public.documents where id=${q(first.document_id)}`), `${teacher}:${manager}`);
            assert.equal(await actor(manager, `select count(*) from public.document_versions where id=${q(first.version_id)}`), "1");
            assert.equal(await actor(teacher, `select count(*) from public.documents where id=${q(first.document_id)}`), "1");
            assert.equal(await actor(peer, `select count(*) from public.documents where id=${q(first.document_id)}`), "0");
            await assert.rejects(actor(peer, reserve(teacher, randomUUID())), /42501/);
            await assert.rejects(actor(manager, reserve(randomUUID(), randomUUID())), /42501/);
        },
    );
    await check(
        "Only own clean personal certificates for a selected topic can be shared",
        async () => {
            for (const id of [foreign.v1, cv.v1])
                await assert.rejects(save(id, 0), /42501/);
            await assert.rejects(save(rejected.v1, 0), /22023/);
            await assert.rejects(
                save(cert.v1, 0, randomUUID(), teacher, randomUUID()),
                /22023/,
            );
            await assert.rejects(
                actor(
                    peer,
                    `select public.qualification_review(${q(teacher)},${q(topic)})`,
                ),
                /42501/,
            );
            assert.deepEqual(await record(manager), await record(teacher));
        },
    );
    let linked;
    await check(
        "Explicit binding pins V1 while document current metadata points at V2; retries deduplicate",
        async () => {
            const key = randomUUID();
            linked = await save(cert.v1, 0, key);
            assert.equal(linked.version, 1);
            assert.equal(linked.evidence.name, "Original.txt");
            assert.equal(linked.evidence.version_id, cert.v1);
            assert.deepEqual(await save(cert.v1, 0, key), linked);
            await assert.rejects(save(cert.v2, 0, key), /22023/);
            await assert.rejects(save(cert.v2, 0), /40001/);
            assert.equal((await access(linked.evidence.id)).version_id, cert.v1);
            assert.equal(
                await actor(
                    manager,
                    `select count(*)
                     from public.document_versions
                     where document_id = ${q(cert.doc)}`,
                    "aal1",
                ),
                "0",
            );
            assert.equal((await history()).items.length, 1);
        },
    );
    await check(
        "Legacy manual validation preserves documented expertise, expiry and target messages",
        async () => {
            await assert.rejects(
                actor(
                    manager,
                    `select public.verify_lecturer_topic(${q(teacher)},${q(randomUUID())},true,null)`,
                    "aal1",
                ),
                /select this expertise first/,
            );
            await assert.rejects(
                actor(
                    manager,
                    `select public.verify_lecturer_topic(${q(teacher)},${q(topic)},true,'2020-01-01T00:00Z')`,
                    "aal1",
                ),
                /in the future/,
            );
            await assert.rejects(
                actor(
                    manager,
                    `select public.verify_lecturer_topic(${q(manager)},${q(topic)},true,null)`,
                    "aal1",
                ),
                /active lecturer/,
            );
        },
    );
    await check(
        "Legacy manual attestation shares the new immutable history core and keeps its signature",
        async () => {
            await actor(
                manager,
                `select public.verify_lecturer_topic(${q(teacher)},${q(topic)},true,'2045-01-01T00:00Z')`,
                "aal1",
            );
            const r = await record(manager);
            assert.equal(r.version, 2);
            assert.equal(r.verified, true);
            assert.equal(r.evidence.id, linked.evidence.id);
            assert.equal((await history()).items[0].basis, "management_attestation");
            await assert.rejects(
                actor(
                    manager,
                    `select public.verify_lecturer_topic(${q(teacher)},${q(topic)},true,'2020-01-01T00:00Z')`,
                    "aal1",
                ),
                /22023/,
            );
        },
    );
    await check(
        "Evidence attestation checks current binding, version, permission and active lecturer",
        async () => {
            await assert.rejects(attest(randomUUID(), 2), /42501/);
            await assert.rejects(attest(linked.evidence.id, 1), /40001/);
            const key = randomUUID();
            const verified = await attest(linked.evidence.id, 2, key);
            assert.equal(verified.version, 3);
            assert.deepEqual(await attest(linked.evidence.id, 2, key), verified);
            assert.equal((await history()).items[0].basis, "document_evidence");
            assert.equal(
                (await access(linked.evidence.id, manager, "aal1")).user_id,
                teacher,
            );
            await assert.rejects(access(linked.evidence.id, peer, "aal1"), /42501/);
        },
    );
    await check(
        "Stable bounded certificate cursor and literal search never spill other kinds/owners",
        async () => {
            const page = JSON.parse(
                await actor(
                    teacher,
                    "select public.own_qualification_certificates('',null,null,1)",
                ),
            );
            assert.equal(page.has_more, true);
            const next = JSON.parse(
                await actor(
                    teacher,
                    `select public.own_qualification_certificates('',${q(page.next_cursor.at)},${q(page.next_cursor.id)},1)`,
                ),
            );
            assert.equal(next.has_more, false);
            assert.deepEqual(
                new Set([...page.items, ...next.items].map((v) => v.version_id)),
                new Set([cert.v1, cert.v2]),
            );
            assert.equal(
                JSON.parse(
                    await actor(
                        teacher,
                        "select public.own_qualification_certificates('%',null,null,20)",
                    ),
                ).items.length,
                0,
            );
            await assert.rejects(
                actor(
                    teacher,
                    "select public.own_qualification_certificates('',null,null,51)",
                ),
                /22023/,
            );
        },
    );
    await check(
        "Committed retry after withdrawal neither reattests nor returns historical certificate metadata",
        async () => {
            const bindKey = randomUUID(),
                attestKey = randomUUID();
            const r = await save(cert.v1, 0, bindKey, teacher, second);
            const args = `${q(teacher)},${q(second)},true,null,${q(r.evidence.id)},1,${q(attestKey)}`;
            await actor(
                manager,
                `select public.attest_qualification(${args})`,
                "aal1",
            );
            const removed = await save(null, 2, randomUUID(), teacher, second);
            assert.equal(removed.evidence, null);
            assert.equal(removed.verified, true);
            assert.deepEqual(
                await save(cert.v1, 0, bindKey, teacher, second),
                removed,
            );
            assert.deepEqual(
                JSON.parse(
                    await actor(
                        manager,
                        `select public.attest_qualification(${args})`,
                        "aal1",
                    ),
                ),
                removed,
            );
            assert.equal(
                await sql(
                    `select count(*)
                     from private.qualification_events
                     where user_id = ${q(teacher)}
                       and topic_id = ${q(second)}`,
                ),
                "3",
            );
        },
    );
    const job = randomUUID();
    const snapshot = () =>
        sql(
            `select jsonb_build_object('claims', (select jsonb_agg(to_jsonb(c)) from public.job_claims c where c.job_id = ${q(job)}), 'allocations', (select jsonb_agg(to_jsonb(a) order by a.id)
                                                                                                                                                      from public.assignment_sessions a
                                                                                                                                                               join public.job_claims c on c.id = a.claim_id
                                                                                                                                                      where c.job_id = ${q(job)}))`,
        );
    let accepted;
    await check(
        "Evidence-reviewed eligibility confirms a real whole-block claim with immutable accepted snapshot",
        async () => {
            await sql(
                `insert into public.jobs(id, title, customer_name, delivery_type, time_zone, status, amount, currency, rate_unit, total_amount, terms, created_by)
                 values (${q(job)}, 'Evidence offer', 'Fictional customer', 'online', 'Europe/Berlin', 'published', 100, 'EUR', 'fixed_total', 100, 'Fictional accepted terms', ${q(manager)});
                insert into public.job_sessions(job_id, starts_at, ends_at)
                values (${q(job)}, '2040-01-02T08:00Z', '2040-01-02T10:00Z'),
                       (${q(job)}, '2040-01-03T08:00Z', '2040-01-03T10:00Z');
                insert into public.job_requirements(job_id, topic_id)
                values (${q(job)}, ${q(topic)})`,
            );
            const claim = JSON.parse(
                await actor(
                    teacher,
                    `select public.claim_job(${q(job)},${q(randomUUID())},1)`,
                ),
            );
            assert.equal(claim.status, "confirmed");
            accepted = await snapshot();
            assert.equal(JSON.parse(accepted).allocations.length, 2);
        },
    );
    await check(
        "Withdraw/replacement revoke old-version download without changing verified expertise",
        async () => {
            const withdrawn = await save(null, 3);
            assert.equal(withdrawn.verified, true);
            assert.equal(withdrawn.evidence, null);
            await assert.rejects(access(linked.evidence.id), /42501/);
            linked = await save(cert.v2, 4);
            assert.equal(linked.evidence.name, "Latest.txt");
            assert.equal(linked.verified, true);
            assert.equal(await snapshot(), accepted);
        },
    );
    await check(
        "Rollback leaves no grant, event or request; bounded history cursor has no duplicates",
        async () => {
            const before = await record(),
                key = randomUUID();
            await assert.rejects(
                actor(
                    teacher,
                    `select public.save_qualification_evidence(${q(topic)},${q(cert.v1)},5,${q(key)});select 1/0`,
                ),
                /22012/,
            );
            assert.deepEqual(await record(), before);
            assert.equal(
                await sql(
                    `select count(*)
                     from private.qualification_requests
                     where request_id = ${q(key)}`,
                ),
                "0",
            );
            const first = await history(manager, 2);
            assert.equal(first.items.length, 2);
            assert.equal(first.has_more, true);
            const next = await history(manager, 2, first.next_cursor);
            assert.equal(next.items.length, 2);
            assert.equal(
                new Set([...first.items, ...next.items].map((e) => e.id)).size,
                4,
            );
        },
    );
    await check(
        "Topic removal revokes grants; re-add cannot resurrect evidence or verification",
        async () => {
            await actor(
                teacher,
                `delete
                 from public.lecturer_topics
                 where user_id = ${q(teacher)}
                   and topic_id = ${q(topic)}`,
            );
            await assert.rejects(access(linked.evidence.id), /42501/);
            await actor(
                teacher,
                `insert into public.lecturer_topics(user_id, topic_id)
                 values (${q(teacher)}, ${q(topic)})`,
            );
            const r = await record();
            assert.equal(r.evidence, null);
            assert.equal(r.verified, false);
            assert.equal((await history()).items[0].action, "deselect");
            assert.equal(
                await snapshot(),
                accepted,
                "Removing current qualification cannot mutate an accepted claim",
            );
        },
    );
    await check(
        "Role withdrawal committed ahead of waiting legacy/new review denies exact42501 with unchanged history",
        async () => {
            for (const legacy of [true, false]) {
                const before = await record(),
                    tag = "qualification_revoke_" + randomUUID(),
                    writeTag = "qualification_write_" + randomUUID();
                const revoke = sql(
                    `set application_name=${q(tag)};begin;select 1 from public.profiles where id=${q(manager)} for update;delete from public.user_roles where user_id=${q(manager)};insert into public.user_roles values(${q(manager)},'lecturer');select pg_sleep(2);commit;`,
                );

                async function barrier(name, condition) {
                    for (let i = 0; i < 60; i++) {
                        if (
                            (await sql(
                                `select count(*)
                                 from pg_stat_activity
                                 where application_name = ${q(name)}
                                   and ${condition}`,
                            )) === "1"
                        )
                            return;
                        await new Promise((resolve) => setTimeout(resolve, 10));
                    }
                    throw new Error("Actual lock barrier not observed");
                }

                let writer;
                try {
                    await barrier(tag, "wait_event='PgSleep'");
                    const query = legacy
                        ? `select public.verify_lecturer_topic(${q(teacher)},${q(topic)},true,null)`
                        : `select public.attest_qualification(${q(teacher)},${q(topic)},true,null,null,${before.version},${q(randomUUID())})`;
                    writer = actor(
                        manager,
                        `set local application_name=${q(writeTag)};${query}`,
                        "aal1",
                    );
                    const settled = Promise.allSettled([revoke, writer]);
                    await barrier(writeTag, "wait_event_type='Lock'");
                    const result = await settled;
                    assert.equal(result[1].status, "rejected");
                    assert.match(result[1].reason.message, /42501/);
                } finally {
                    await Promise.allSettled([revoke, ...(writer ? [writer] : [])]);
                }
                assert.deepEqual(await record(), before);
                await sql(
                    `delete
                     from public.user_roles
                     where user_id = ${q(manager)};
                    insert into public.user_roles
                    values (${q(manager)}, 'management')`,
                );
            }
        },
    );
    await check(
        "Self-binding waits behind current-role withdrawal and cannot use its former lecturer role",
        async () => {
            const before = await sql(
                    `select row_to_json(s)
                     from private.qualification_states s
                     where user_id = ${q(teacher)}
                       and topic_id = ${q(second)}`,
                ),
                tag = "qualification_self_" + randomUUID(),
                writeTag = "qualification_bind_" + randomUUID();
            const revoke = sql(
                `set application_name=${q(tag)};begin;select 1 from public.profiles where id=${q(teacher)} for update;delete from public.user_roles where user_id=${q(teacher)};insert into public.user_roles values(${q(teacher)},'client');select pg_sleep(2);commit;`,
            );

            async function wait(name, event) {
                for (let i = 0; i < 60; i++) {
                    if (
                        (await sql(
                            `select count(*)
                             from pg_stat_activity
                             where application_name = ${q(name)}
                               and ${event}`,
                        )) === "1"
                    )
                        return;
                    await new Promise((r) => setTimeout(r, 10));
                }
                throw new Error("Self binding lock barrier not observed");
            }

            let writer;
            try {
                await wait(tag, "wait_event='PgSleep'");
                writer = actor(
                    teacher,
                    `set local application_name=${q(writeTag)};select public.save_qualification_evidence(${q(second)},${q(cert.v1)},3,${q(randomUUID())})`,
                );
                const done = Promise.allSettled([revoke, writer]);
                await wait(writeTag, "wait_event_type='Lock'");
                const results = await done;
                assert.equal(results[1].status, "rejected");
                assert.match(results[1].reason.message, /42501/);
            } finally {
                await Promise.allSettled([revoke, ...(writer ? [writer] : [])]);
            }
            assert.equal(
                await sql(
                    `select row_to_json(s)
                     from private.qualification_states s
                     where user_id = ${q(teacher)}
                       and topic_id = ${q(second)}`,
                ),
                before,
            );
            await sql(
                `delete
                 from public.user_roles
                 where user_id = ${q(teacher)};
                insert into public.user_roles
                values (${q(teacher)}, 'lecturer')`,
            );
            assert.equal(await snapshot(), accepted);
        },
    );
    await check(
        "No private table DML or helper entry for browser; service-only fixture purge remains possible",
        async () => {
            assert.equal(
                await sql(
                    `select has_table_privilege('authenticated','private.qualification_events','UPDATE')`,
                ),
                "f",
            );
            assert.equal(
                await sql(
                    `select has_function_privilege('authenticated','private.lock_qualification_actor(uuid,boolean)','EXECUTE')`,
                ),
                "f",
            );
            await actor(
                manager,
                `select public.verify_lecturer_topic(${q(peer)},${q(topic)},true,null)`,
                "aal1",
            );
            await save(foreign.v1, 1, randomUUID(), peer);
            await sql(
                `delete
                 from public.notifications
                 where user_id = ${q(peer)};
                update public.documents
                set current_version_id=null
                where owner_id = ${q(peer)};
                delete
                from public.document_versions
                where document_id in (select id from public.documents where owner_id = ${q(peer)});
                delete
                from public.documents
                where owner_id = ${q(peer)};
                delete
                from auth.users
                where id = ${q(peer)}`,
            );
            assert.equal(
                await sql(
                    `select count(*)
                     from private.qualification_events
                     where user_id = ${q(peer)}`,
                ),
                "0",
            );
        },
    );
});
console.log(`${checks} qualification PostgreSQL groups passed.`);