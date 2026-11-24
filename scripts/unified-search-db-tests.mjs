/** Disposable PostgreSQL replay: actual resource ACLs, pagination and revocation. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {portalOpenApi} from "../src/features/developer-api/contract.ts";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

const searchResponse = z.fromJSONSchema(
    portalOpenApi("https://portal.example.invalid").paths["/rest/v1/rpc/unified_search"]
        .post.responses["200"].content["application/json"].schema,
);

await withTestDatabase("unified_search", async ({sql, actor}) => {
    const [owner, peer, admin, learner] = Array.from({length: 4}, randomUUID);
    await sql(
        `insert into auth.users(id,email)values${[owner, peer, admin, learner].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};insert into public.user_roles(user_id,role)values(${q(owner)},'lecturer'),(${q(peer)},'lecturer'),(${q(admin)},'admin'),(${q(learner)},'participant');`,
    );
    const search = async (
        who,
        text = "Needle",
        kind = "",
        cursor = null,
        aal = "aal1",
    ) =>
        searchResponse.parse(JSON.parse(
            await actor(
                who,
                `select public.unified_search(${q(text)},${q(kind)},${cursor ? q(cursor.kind) : "null"},${cursor ? q(cursor.title) : "null"},${cursor ? q(cursor.id) : "null"},40)`,
                aal,
            ),
        ));
    const [ownFile, foreignFile, room, msg, task, template, run, otherRun] =
        Array.from({length: 8}, randomUUID);
    await sql(`insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)values(${q(ownFile)},${q(owner)},${q(owner)},'personal','material','Needle file ä %_&?#.pdf','application/pdf',1,'clean',${q(randomUUID())}),(${q(foreignFile)},${q(peer)},${q(peer)},'personal','material','Needle private peer.pdf','application/pdf',1,'clean',${q(randomUUID())});
 insert into public.chat_rooms(id,kind,title,owner_id,dm_key)values(${q(room)},'dm','Needle private DM',${q(owner)},${q([owner, peer].sort().join(":"))});insert into public.chat_members(room_id,user_id)values(${q(room)},${q(owner)}),(${q(room)},${q(peer)});
 insert into public.messages(id,room_id,sender_id,body,client_id,request_hash)values(${q(msg)},${q(room)},${q(owner)},'Needle private body',${q(randomUUID())},'fictional-search-hash');
 insert into private.work_tasks(id,creator_id,assignee_id,scope,title,client_id,request_payload)values(${q(task)},${q(owner)},${q(owner)},'private','Needle own task',${q(randomUUID())},'{}');
 insert into public.course_templates(id,title)values(${q(template)},'Needle enrolled course');insert into public.course_runs(id,template_id)values(${q(run)},${q(template)}),(${q(otherRun)},${q(template)});insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)values(${q(run)},${q(learner)},'enrolled',${q(admin)});`);
    assert.deepEqual(
        (await search(owner, "%_", "files")).items.map(({id}) => id),
        [ownFile],
    );
    let result = await search(owner);
    const serialized = JSON.stringify(result);
    assert.ok(result.items.some((row) => row.id === ownFile));
    assert.ok(result.items.some((row) => row.id === msg));
    assert.ok(!result.items.some((row) => row.id === task));
    assert.ok(
        !result.items.some(
            (row) => row.kind === "tasks" || row.url.startsWith("/workbench"),
        ),
    );
    await assert.rejects(search(owner, "Needle", "tasks"), /Invalid search page/);
    await assert.rejects(
        search(owner, "Needle", "", {kind: "tasks", title: "needle", id: task}),
        /Invalid search page/,
    );
    assert.ok(!serialized.includes(foreignFile));
    const file = result.items.find((row) => row.id === ownFile);
    assert.equal(
        new URL(file.url, "https://example.invalid").searchParams.get("q"),
        "Needle file ä %_&?#.pdf",
    );
    assert.ok(!/[\s\\]/.test(file.url));
    const privileged = JSON.stringify(
        await search(admin, "Needle", "", null, "aal1"),
    );
    assert.ok(!privileged.includes(ownFile));
    assert.ok(!privileged.includes(msg));
    assert.ok(!privileged.includes(task));
    console.log(
        "PASS Universal search preserves own file and private DM boundaries, excludes retired tasks, including permission administrators; exact Unicode URL escaping",
    );
    // This is a security-definer projection, so direct-table RLS alone cannot
    // filter hidden messages. Exercise both identities and the p_limit boundary.
    const visibleMessage = randomUUID();
    await sql(
        `insert into public.messages(id, room_id, sender_id, body, client_id, request_hash)
         values (${q(visibleMessage)}, ${q(room)}, ${q(owner)}, 'Needle visible message', ${q(randomUUID())}, 'fixture');`,
    );
    await actor(owner, `select public.hide_chat_message(${q(msg)})`);
    const personal = await search(owner, "Needle", "chats");
    assert.ok(!personal.items.some((row) => row.id === msg));
    assert.ok(personal.items.some((row) => row.id === visibleMessage));
    const other = await search(peer, "Needle", "chats");
    assert.ok(other.items.some((row) => row.id === msg));
    assert.ok(other.items.some((row) => row.id === visibleMessage));
    const singlePage = searchResponse.parse(JSON.parse(
        await actor(
            owner,
            "select public.unified_search('Needle','chats',null,null,null,1)",
        ),
    ));
    assert.equal(singlePage.items.length, 1);
    assert.equal(singlePage.items[0].id, visibleMessage);
    assert.equal(singlePage.has_more, false);
    assert.equal(singlePage.next_cursor, null);
    assert.equal(
        await sql(
            "select has_function_privilege('anon','public.unified_search(text,text,text,text,uuid,integer)','execute')",
        ),
        "f",
    );
    assert.equal(
        await sql(
            "select has_function_privilege('authenticated','public.unified_search(text,text,text,text,uuid,integer)','execute')",
        ),
        "t",
    );
    assert.equal(
        await sql(
            "select has_function_privilege('service_role','public.unified_search(text,text,text,text,uuid,integer)','execute')",
        ),
        "f",
    );
    console.log(
        "PASS Personally hidden messages are excluded before universal-search pagination without changing peer visibility or grants",
    );
    const [literalMessage, nearMessage] = Array.from({length: 2}, randomUUID);
    const literal = "!%_" + String.fromCharCode(92) + "Ärger";
    await sql(`insert into public.messages(id,room_id,sender_id,body,client_id,request_hash)
      values (${q(literalMessage)},${q(room)},${q(owner)},${q("Fictional " + literal)},${q(randomUUID())},'fixture'),
             (${q(nearMessage)},${q(room)},${q(owner)},'Fictional !abcXaerger',${q(randomUUID())},'fixture');`);
    assert.deepEqual(
        (await search(owner, literal.toLowerCase(), "chats")).items.map(({id}) => id),
        [literalMessage],
    );
    assert.deepEqual((await search(admin, literal, "chats")).items, []);
    await assert.rejects(search(learner), /Active account required/);
    console.log(
        "PASS Participant portal access is denied even with legacy course enrolment",
    );
    await sql(
        `insert into public.documents(owner_id, uploaded_by, scope, kind, original_name, mime_type, size_bytes, status, client_id)
         select ${q(owner)},
                ${q(owner)},
                'personal',
                'material',
                'PageNeedle ' || lpad(i::text, 4, '0') || '.txt',
                'text/plain',
                1,
                'clean',
                gen_random_uuid()
         from generate_series(1, 1005) i;`,
    );
    const seen = new Set();
    let cursor = null;
    do {
        const page = await search(owner, "PageNeedle", "files", cursor);
        for (const row of page.items) {
            assert.ok(!seen.has(row.id));
            seen.add(row.id);
        }
        cursor = page.next_cursor;
        assert.equal(page.has_more, Boolean(cursor));
    } while (cursor);
    assert.equal(seen.size, 1005);
    console.log(
        "PASS Stable server cursor discovers all 1005 authorized records beyond REST cap without duplicates",
    );
    assert.equal((await search(owner, "%_", "files")).items.length, 1);
    await sql(
        `update public.chat_members
         set removed_at=now()
         where room_id = ${q(room)}
           and user_id = ${q(owner)};
        update public.documents
        set deleted_at=now()
        where id = ${q(ownFile)};`,
    );
    result = await search(owner);
    assert.ok(!result.items.some((row) => row.id === msg || row.id === ownFile));
    console.log(
        "PASS Literal wildcard characters stay literal; current file removal and chat revocation hide results immediately",
    );
    await assert.rejects(
        actor(owner, `select public.unified_search('N')`),
        /22023/,
    );
    await assert.rejects(
        actor(owner, `select public.unified_search('Needle','bogus')`),
        /22023/,
    );
    await assert.rejects(
        actor(
            owner,
            `select public.unified_search('Needle','',null,'partial',null,40)`,
        ),
        /22023/,
    );
    assert.equal(
        await sql(
            "select has_function_privilege('anon','public.unified_search(text,text,text,text,uuid,integer)','execute')",
        ),
        "f",
    );
    await sql(`update public.profiles
               set active= false
               where id = ${q(owner)}`);
    await assert.rejects(search(owner), /42501/);
    console.log(
        "PASS Strict queries/cursors, anonymous denial and immediate existing-identity suspension",
    );
    console.log("6 unified search PostgreSQL groups passed");
});