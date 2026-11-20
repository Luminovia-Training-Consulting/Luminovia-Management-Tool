/** Real request-brief authorization/history with a separately configured fictional role-pricing policy. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("client_request_brief", async ({sql, actor}) => {
    const [client, peer, foreign, learner, admin, org, other] = Array.from(
        {length: 7},
        randomUUID,
    );
    const users = [client, peer, foreign, learner, admin];
    await sql(
        `insert into auth.users(id,email) values ${users.map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};insert into public.user_roles(user_id,role)values(${q(client)},'client'),(${q(peer)},'client'),(${q(foreign)},'client'),(${q(learner)},'participant'),(${q(admin)},'admin');insert into public.organisations(id,name)values(${q(org)},'Fictional request academy'),(${q(other)},'Foreign academy');insert into public.client_organisation_memberships(user_id,organisation_id)values(${q(client)},${q(org)}),(${q(peer)},${q(org)}),(${q(foreign)},${q(other)});`,
    );
    const payload = {
        title: "Fictional course brief",
        description: "Safe authored description",
        delivery_type: "online",
        location: "https://example.invalid/teaching",
        time_zone: "Europe/Berlin",
        sessions: [
            {
                starts_at: new Date(Date.now() + 7 * 86400000).toISOString(),
                ends_at: new Date(Date.now() + 7 * 86400000 + 3600000).toISOString(),
            },
        ],
        topic_ids: [],
        gross_amount: 800,
        gross_total_amount: 800,
        currency: "EUR",
        rate_unit: "fixed_total",
    };
    const brief = {
        teaching_units: 1,
        unit_minutes: 45,
        instructions: "Prepare a fictional lab",
        required_documents: ["Course outline", "Accessible handout"],
        documents: [],
    };
    const rpc = async (who, name, args = []) =>
        JSON.parse(
            await actor(
                who,
                `select to_jsonb(public.${name}(${args.join(",")}))`,
                "aal1",
            ),
        );
    const create = (who, body = brief, key = randomUUID()) =>
        rpc(who, "create_client_request_with_brief", [
            q(org),
            q(JSON.stringify(payload)),
            q(key),
            q(JSON.stringify(body)),
        ]);
    const creationKey = randomUUID();
    let request,
        version = 1,
        count = 0;
    const check = async (name, fn) => {
        await fn();
        console.log("PASS " + name);
        count++;
    };
    const read = (who = client) => rpc(who, "client_request_brief", [q(request)]);
    const save = (body, expected = version, who = client) =>
        rpc(who, "save_client_request_brief", [
            q(request),
            q(JSON.stringify(body)),
            String(expected),
        ]);
    await check(
        "Atomic teaching-unit validation and independent unchanged original-currency commercial snapshot",
        async () => {
            await assert.rejects(
                create(client, {...brief, teaching_units: 2}),
                /22023/,
            );
            await assert.rejects(
                create(client, {...brief, teaching_units: 1.5}),
                /22023/,
            );
            await assert.rejects(
                create(client, {...brief, unit_minutes: 30}),
                /22023/,
            );
            assert.equal(
                await sql("select count(*) from private.client_course_requests"),
                "0",
            );
            const key = creationKey;
            request = await create(client, brief, key);
            assert.equal(await create(client, brief, key), request);
            await assert.rejects(
                create(client, {...brief, instructions: "Changed retry"}, key),
                /22023/,
            );
            assert.equal((await read()).brief.teaching_units, 1);
            assert.equal(
                await sql(
                    `select payload->>'gross_total_amount' from private.client_course_requests where id=${q(request)}`,
                ),
                "800",
            );
        },
    );
    await check(
        "Exact organisation/current-role access; no learner or administrator-without-permission bypass",
        async () => {
            assert.equal((await read(peer)).version, 1);
            for (const user of [foreign, learner]) {
                await assert.rejects(read(user), /42501/);
                await assert.rejects(save(brief, 1, user), /42501/);
                await assert.rejects(
                    rpc(user, "client_request_history", [q(request)]),
                    /42501/,
                );
            }
            assert.equal((await read(admin)).version, 1);
        },
    );
    await check(
        "Real concurrent compare-and-swap permits one revision and retains both older snapshots",
        async () => {
            const result = await Promise.allSettled([
                save({...brief, instructions: "First concurrent revision"}, 1),
                save({...brief, instructions: "Second concurrent revision"}, 1, peer),
            ]);
            assert.equal(result.filter((x) => x.status === "fulfilled").length, 1);
            assert.match(
                String(result.find((x) => x.status === "rejected").reason),
                /40001/,
            );
            version = 2;
            const history = await rpc(client, "client_request_history", [q(request)]);
            assert.equal(history.length, 3);
            assert.equal(history.at(-1).event, "submitted");
            assert.equal(history[1].snapshot.brief.instructions, brief.instructions);
            const committed = await read();
            assert.equal(await create(client, brief, creationKey), request);
            assert.deepEqual(await read(), committed);
            assert.equal(
                (await rpc(client, "client_request_history", [q(request)])).length,
                history.length,
            );
        },
    );
    const [
        doc,
        original,
        newer,
        contract,
        contractVersion,
        foreignDoc,
        foreignVersion,
        pendingDoc,
        pendingVersion,
    ] = Array.from({length: 9}, randomUUID);
    await sql(
        `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)values ${[
            [doc, client, "material"],
            [contract, client, "contract"],
            [foreignDoc, foreign, "material"],
            [pendingDoc, client, "material"],
        ]
            .map(
                ([id, owner, kind]) =>
                    `(${q(id)},${q(owner)},${q(owner)},'personal',${q(kind)},'Fictional.pdf','application/pdf',10,'clean',${q(randomUUID())})`,
            )
            .join(
                ",",
            )};insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)values ${[
            [original, doc, client, "clean"],
            [contractVersion, contract, client, "clean"],
            [foreignVersion, foreignDoc, foreign, "clean"],
            [pendingVersion, pendingDoc, client, "quarantined"],
        ]
            .map(
                ([id, d, owner, status]) =>
                    `(${q(id)},${q(d)},${q(owner)},${q(randomUUID())},1,${q("fictional/" + id + ".pdf")},'Fictional.pdf','application/pdf',10,${q(status)},${q("a".repeat(64))})`,
            )
            .join(
                ",",
            )};update public.documents set current_version_id=${q(original)} where id=${q(doc)};`,
    );
    await check(
        "Explicit exact scanned own-material sharing rejects contracts, foreign files and quarantine; private RLS remains unchanged",
        async () => {
            for (const id of [contractVersion, foreignVersion, pendingVersion])
                await assert.rejects(
                    save({
                        ...brief,
                        documents: [{version_id: id, category: "material"}],
                    }),
                    /42501/,
                );
            await assert.rejects(
                save({
                    ...brief,
                    documents: [{version_id: original, category: "contract"}],
                }),
                /22023/,
            );
            version = await save({
                ...brief,
                documents: [{version_id: original, category: "report"}],
            });
            const view = await read(peer);
            assert.equal(view.documents[0].version_id, original);
            assert.equal(view.documents[0].category, "report");
            assert.ok(!JSON.stringify(view).includes("object_path"));
            assert.equal(
                await actor(
                    peer,
                    `select count(*) from public.documents where id=${q(doc)}`,
                ),
                "0",
            );
        },
    );
    await check(
        "Replacement does not change shared bytes/version; removing the exact share denies further access",
        async () => {
            await sql(
                `insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)values(${q(newer)},${q(doc)},${q(client)},${q(randomUUID())},2,'fictional/newer.pdf','Newer.pdf','application/pdf',10,'clean',${q("b".repeat(64))});update public.documents set current_version_id=${q(newer)} where id=${q(doc)};`,
            );
            const access = await rpc(peer, "client_request_document_access", [
                q(request),
                q(original),
            ]);
            assert.equal(access.sha256, "a".repeat(64));
            await assert.rejects(
                rpc(peer, "client_request_document_access", [q(request), q(newer)]),
                /42501/,
            );
            await assert.rejects(
                rpc(foreign, "client_request_document_access", [
                    q(request),
                    q(original),
                ]),
                /42501/,
            );
            version = await save({...brief, documents: []});
            await assert.rejects(
                rpc(peer, "client_request_document_access", [q(request), q(original)]),
                /42501/,
            );
        },
    );
    await check(
        "History is append-only through authenticated APIs with stable non-overlapping cursor pages",
        async () => {
            await assert.rejects(
                actor(
                    client,
                    `update private.client_request_revisions set event='forged' where request_id=${q(request)}`,
                ),
                /42501/,
            );
            for (let i = 0; i < 26; i++)
                version = await save({...brief, instructions: "Revision " + i});
            const first = await rpc(client, "client_request_history", [q(request)]),
                second = await rpc(client, "client_request_history", [
                    q(request),
                    String(first.at(-1).id),
                ]);
            assert.equal(first.length, 25);
            assert.ok(second.length > 0);
            assert.ok(second.every((row) => row.id < first.at(-1).id));
            assert.ok(!JSON.stringify(first).includes("object_path"));
        },
    );
    let job;
    await check(
        "Published requests are atomically read-only and publication is in revision history",
        async () => {
            // Policy setup is a separate permission-gated operation; publishing cannot
            // inject a new percentage or bypass the captured role-pricing contract.
            await rpc(admin, "configure_compensation_policy", ["17", "31", "0"]);
            await assert.rejects(
                rpc(admin, "publish_client_request", [
                    q(request),
                    "50",
                    q("Fictional accepted terms"),
                    "false",
                ]),
                /22023.*Compensation policy is configured separately/s,
            );
            job = await rpc(admin, "publish_client_request", [
                q(request),
                "null",
                q("Fictional accepted terms"),
                "false",
            ]);
            assert.equal((await read()).editable, false);
            await assert.rejects(save(brief), /55000/);
            assert.equal(
                (await rpc(client, "client_request_history", [q(request)]))[0].event,
                "published",
            );
        },
    );
    await check(
        "Repeat booking copies requirements/time only; new shorter sessions are rejected",
        async () => {
            await sql(
                `update public.job_sessions set starts_at=now()-interval '2 days 1 hour',ends_at=now()-interval '2 days' where job_id=${q(job)}`,
            );
            const repeated = await rpc(client, "repeat_client_request", [
                q(request),
                q(JSON.stringify(payload.sessions)),
                q(randomUUID()),
            ]);
            const view = await rpc(client, "client_request_brief", [q(repeated)]);
            assert.equal(view.brief.teaching_units, 1);
            assert.equal(view.brief.required_documents.length, 2);
            assert.equal(view.brief.documents.length, 0);
            const short = [
                {
                    starts_at: payload.sessions[0].starts_at,
                    ends_at: new Date(
                        Date.parse(payload.sessions[0].starts_at) + 15 * 60000,
                    ).toISOString(),
                },
            ];
            await assert.rejects(
                rpc(client, "repeat_client_request", [
                    q(request),
                    q(JSON.stringify(short)),
                    q(randomUUID()),
                ]),
                /22023/,
            );
        },
    );
    await check(
        "Removed membership and inactive identity immediately revoke brief, history and download rights",
        async () => {
            await sql(
                `update public.client_organisation_memberships set removed_at=now() where user_id=${q(peer)}`,
            );
            await assert.rejects(read(peer), /42501/);
            await sql(
                `update public.profiles set active=false where id=${q(client)}`,
            );
            await assert.rejects(read(client), /42501/);
            await assert.rejects(
                rpc(client, "client_request_history", [q(request)]),
                /42501/,
            );
        },
    );
    console.log(`${count} real client-request brief PostgreSQL groups passed.`);
});