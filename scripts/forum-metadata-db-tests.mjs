import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("forum_metadata", async ({sql, actor}) => {
    const owner = randomUUID(),
        peer = randomUUID(),
        admin = randomUUID();
    await sql(
        `insert into auth.users(id)
         values ('${owner}'),
                ('${peer}'),
                ('${admin}');
        insert into public.user_roles(user_id, role)
        values ('${owner}', 'lecturer'),
               ('${peer}', 'senior_lecturer'),
               ('${admin}', 'admin');`,
    );
    const call = (who, fn, args = [], aal) =>
        actor(
            who,
            `select public.${fn}(${args.map((x) => (x === null ? "null" : typeof x === "number" || typeof x === "boolean" ? String(x) : quoteSql(x))).join(",")})`,
            aal,
        );
    const categories = JSON.parse(
        await actor(
            owner,
            "select json_agg(x) from public.knowledge_categories('forum') x",
        ),
    );
    const cat = categories[0].id;
    const wiki = JSON.parse(
        await actor(
            owner,
            "select json_agg(x) from public.knowledge_categories('wiki') x",
        ),
    )[0].id;
    const doc = JSON.stringify({
        type: "doc",
        content: [
            {type: "paragraph", content: [{type: "text", text: "Question"}]},
        ],
    });
    const thread = await call(owner, "create_forum_thread", [
        cat,
        "Original",
        doc,
    ]);
    const edit = (who, title, category, version, aal) =>
        call(
            who,
            "edit_forum_thread_metadata",
            [thread, title, category, version],
            aal,
        );
    const reply = await call(peer, "add_forum_post", [thread, doc, randomUUID()]);
    await call(owner, "accept_forum_answer", [thread, reply]);
    await call(peer, "subscribe_forum_thread", [thread, true]);
    await assert.rejects(edit(peer, "Forbidden", cat, 1), /42501/);
    assert.equal(await edit(admin, "Admin edit", cat, 1), "2");
    await assert.rejects(edit(owner, "", cat, 1), /22023/);
    await assert.rejects(edit(owner, "Wrong category", wiki, 1), /22023/);
    assert.equal(await edit(owner, "  Revised  ", cat, 2), "3");
    await assert.rejects(edit(owner, "Stale", cat, 2), /40001/);
    const race = await Promise.allSettled([
        edit(owner, "Concurrent A", cat, 3),
        edit(owner, "Concurrent B", cat, 3),
    ]);
    assert.equal(race.filter((x) => x.status === "fulfilled").length, 1);
    assert.match(
        race.find((x) => x.status === "rejected").reason.message,
        /40001/,
    );
    const before = JSON.parse(await call(owner, "forum_thread", [thread]));
    assert.equal(before.metadata_version, 4);
    assert.equal(before.accepted_post_id, reply);
    await call(admin, "moderate_forum_thread", [thread, true, true, null]);
    await assert.rejects(edit(owner, "Locked", cat, 4), /42501/);
    assert.equal(await edit(admin, "Moderator", cat, 4), "5");
    const after = JSON.parse(await call(owner, "forum_thread", [thread]));
    assert.equal(after.accepted_post_id, reply);
    assert.equal(after.locked, true);
    assert.equal(after.pinned, true);
    assert.equal(
        await sql(
            `select count(*)
             from public.forum_posts
             where thread_id = '${thread}'`,
        ),
        "2",
    );
    assert.equal(
        await sql(
            `select count(*)
             from public.forum_subscriptions
             where thread_id = '${thread}'
               and user_id = '${peer}'`,
        ),
        "1",
    );
    await sql(`update public.profiles
               set active= false
               where id = '${owner}'`);
    await assert.rejects(edit(owner, "Suspended", cat, 4), /42501/);
    await assert.rejects(
        sql(
            `set role anon; select public.edit_forum_thread_metadata('${thread}','x','${cat}',4)`,
        ),
        /permission denied/,
    );
    console.log(
        "PASS forum metadata authorization, validation, concurrent conflicts and preserved thread state",
    );
});