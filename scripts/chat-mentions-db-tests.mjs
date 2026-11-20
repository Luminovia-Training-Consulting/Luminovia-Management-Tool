/** Real PostgreSQL mention/version/notification/ACL transactions in an owned UUID database. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

let checks = 0;
await withTestDatabase("chat_mentions", async ({sql, actor}) => {
    const author = randomUUID(),
        target = randomUUID(),
        third = randomUUID(),
        outsider = randomUUID(),
        admin = randomUUID();
    const ids = [author, target, third, outsider, admin];
    await sql(
        `insert into auth.users(id, email)
         values ${ids.map((id, i) => `(${q(id)},'mentions-${i}@example.invalid')`).join(",")};
        insert into public.user_roles(user_id, role)
        values ${ids.map((id) => `(${q(id)},'${id === admin ? "admin" : "lecturer"}')`).join(",")}`,
    );
    const room = await actor(
        author,
        `select public.create_chat_group('Fictional mention team',array[${q(target)},${q(third)}]::uuid[],'topic')`,
    );
    const list = async (who = author, which = room) =>
        JSON.parse(
            await actor(
                who,
                `select coalesce(jsonb_agg(to_jsonb(m)), '[]')
                 from public.chat_messages_with_mentions(${q(which)}) m`,
            ),
        );
    const candidates = async (who = author) =>
        JSON.parse(
            await actor(who, `select public.chat_mention_candidates(${q(room)})`),
        );
    const send = (
        body,
        targets = [],
        key = randomUUID(),
        who = author,
        which = room,
    ) =>
        actor(
            who,
            `select public.send_message_with_mentions(${q(which)},${q(body)},${q(key)},null,array[${targets.map(q).join(",")}]::uuid[])`,
        );
    const edit = async (
        id,
        body,
        version,
        targets = [],
        key = randomUUID(),
        who = author,
    ) =>
        JSON.parse(
            await actor(
                who,
                `select public.edit_message_with_mentions(${q(id)},${q(body)},${version},${q(key)},array[${targets.map(q).join(",")}]::uuid[])`,
            ),
        );
    const notice = async (id, who = target) =>
        JSON.parse(
            await sql(
                `select coalesce(jsonb_agg(to_jsonb(n)), '[]')
                 from public.notifications n
                 where resource_id = ${q(id)}
                   and user_id = ${q(who)}
                   and kind = 'chat_message'`,
            ),
        );
    const check = async (name, run) => {
        await run();
        checks++;
        console.log("PASS " + name);
    };
    await check(
        "Candidates are current authorized room members, never self or unrelated profiles",
        async () => {
            assert.deepEqual(
                new Set((await candidates()).map((x) => x.user_id)),
                new Set([target, third]),
            );
            await assert.rejects(candidates(outsider), /42501/);
            await assert.rejects(
                send("Forbidden guessed mention", [outsider]),
                /42501/,
            );
            await assert.rejects(send("Forbidden self mention", [author]), /22023/);
            await assert.rejects(
                send("Duplicate mention", [target, target]),
                /22023/,
            );
            assert.equal((await list()).length, 0);
        },
    );
    let message;
    await check(
        "Actual structured send is atomic and idempotent, including the mention target list",
        async () => {
            const key = randomUUID();
            message = await send("Fictional <script> lesson", [target], key);
            assert.equal(
                await send("Fictional <script> lesson", [target], key),
                message,
            );
            await assert.rejects(
                send("Fictional <script> lesson", [third], key),
                /idempotency conflict/,
            );
            const [row] = await list();
            assert.equal(row.id, message);
            assert.equal(row.content_version, 1);
            assert.equal(row.mentions.length, 1);
            assert.equal(row.mentions[0].user_id, target);
            assert.equal((await notice(message)).length, 1);
            assert.equal(
                await actor(
                    author,
                    `select count(*)
                     from public.messages
                     where room_id = ${q(room)}`,
                ),
                "1",
            );
        },
    );
    await check(
        "First mention renews an already-read general notice once, including a muted target",
        async () => {
            message = await actor(
                author,
                `select public.send_message(${q(room)},'Fictional ordinary message',${q(randomUUID())})`,
            );
            await sql(
                `update public.notifications
                 set read_at='2020-01-01T00:00:00Z',
                     created_at='2020-01-01T00:00:00Z'
                 where resource_id = ${q(message)}
                   and user_id = ${q(target)}`,
            );
            await actor(target, `select public.mark_chat_read(${q(room)},null,true)`);
            const before = (await notice(message))[0],
                key = randomUUID();
            const result = await edit(
                message,
                "Fictional first explicit mention",
                1,
                [target],
                key,
            );
            assert.equal(result.version, 2);
            let updated = (await notice(message))[0];
            assert.equal(updated.id, before.id);
            assert.equal(updated.read_at, null);
            assert.ok(updated.created_at > before.created_at);
            await sql(
                `update public.notifications
                 set read_at=clock_timestamp()
                 where id = ${q(updated.id)}`,
            );
            updated = (await notice(message))[0];
            assert.deepEqual(
                await edit(
                    message,
                    "Fictional first explicit mention",
                    1,
                    [target],
                    key,
                ),
                result,
            );
            assert.deepEqual((await notice(message))[0], updated);
            await edit(message, "Fictional same mention revised", 2, [target]);
            assert.deepEqual((await notice(message))[0], updated);
            await edit(message, "Fictional mention removed", 3, []);
            await edit(message, "Fictional mention re-added", 4, [target]);
            assert.deepEqual((await notice(message))[0], updated);
            assert.equal(
                await sql(
                    `select count(*)
                     from private.chat_mention_versions
                     where message_id = ${q(message)}
                       and user_id = ${q(target)}`,
                ),
                "3",
            );
        },
    );
    await check(
        "Room mute yields to explicit mentions, global chat preferences suppress insertion and renewal",
        async () => {
            const muted = await send("Fictional muted mention", [target]);
            assert.equal((await notice(muted)).length, 1);
            await sql(
                `update private.notification_preferences
                 set chat= false
                 where user_id = ${q(target)}`,
            );
            const off = await send("Fictional disabled mention", [target]);
            assert.deepEqual(await notice(off), []);
            await sql(
                `update private.notification_preferences
                 set chat= true
                 where user_id = ${q(target)};
                update public.chat_members
                set muted= false
                where room_id = ${q(room)}
                  and user_id = ${q(target)}`,
            );
            const ordinary = await actor(
                author,
                `select public.send_message(${q(room)},'Fictional preference renewal',${q(randomUUID())})`,
            );
            await sql(
                `update public.notifications
                 set read_at=clock_timestamp()
                 where resource_id = ${q(ordinary)}
                   and user_id = ${q(target)};
                update private.notification_preferences
                set chat= false
                where user_id = ${q(target)}`,
            );
            const previous = (await notice(ordinary))[0];
            await edit(ordinary, "Fictional mention blocked by preferences", 1, [
                target,
            ]);
            assert.deepEqual((await notice(ordinary))[0], previous);
            await sql(
                `update private.notification_preferences
                 set chat= true
                 where user_id = ${q(target)}`,
            );
        },
    );
    await check(
        "Edits enforce sender, optimistic version, valid current targets and existing edit-window rules",
        async () => {
            await assert.rejects(
                edit(
                    message,
                    "Fictional foreign edit",
                    5,
                    [target],
                    randomUUID(),
                    third,
                ),
                /42501/,
            );
            await assert.rejects(
                edit(message, "Fictional stale edit", 1, [target]),
                /40001/,
            );
            await assert.rejects(
                edit(message, "Fictional forged target", 5, [outsider]),
                /42501/,
            );
            assert.equal(
                (await list()).find((x) => x.id === message).content_version,
                5,
            );
            const expired = await send("Fictional expired edit", []);
            await sql(
                `update public.messages
                 set created_at=clock_timestamp() - interval '16 minutes'
                 where id=${q(expired)}`,
            );
            await assert.rejects(
                edit(expired, "Fictional too late", 1, [target]),
                /edit window has closed/,
            );
        },
    );
    await check(
        "Legacy edits create a new version without silently retaining old mentions",
        async () => {
            await actor(
                author,
                `select public.edit_message(${q(message)},'Fictional legacy edit still supported')`,
            );
            const row = (await list()).find((x) => x.id === message);
            assert.equal(row.content_version, 6);
            assert.deepEqual(row.mentions, []);
            const legacy = await actor(
                author,
                `select public.chat_messages(${q(room)})`,
            );
            assert.ok(legacy.includes("Fictional legacy edit still supported"));
        },
    );
    await check(
        "Removal and role changes revoke candidates, reads and retries with existing tokens",
        async () => {
            const key = randomUUID(),
                id = await send("Fictional revoked retry", [third], key);
            await actor(
                author,
                `select public.manage_chat_member(${q(room)},${q(third)},true)`,
            );
            assert.ok(!(await candidates()).some((x) => x.user_id === third));
            assert.deepEqual((await list()).find((x) => x.id === id).mentions, []);
            await assert.rejects(
                send("Fictional revoked retry", [third], key),
                /42501/,
            );
            await assert.rejects(list(third), /42501/);
            await actor(
                author,
                `select public.manage_chat_member(${q(room)},${q(third)},false)`,
            );
            await sql(
                `delete
                 from public.user_roles
                 where user_id = ${q(third)};
                insert into public.user_roles(user_id, role)
                values (${q(third)}, 'participant')`,
            );
            assert.ok(!(await candidates()).some((x) => x.user_id === third));
            await assert.rejects(send("Fictional wrong role", [third]), /42501/);
        },
    );
    await check(
        "Deleting a message retains version history but exposes no current mentions or body",
        async () => {
            const id = await send("Fictional tombstone mention", [target]);
            await actor(author, `select public.delete_message(${q(id)})`);
            const row = (await list()).find((x) => x.id === id);
            assert.equal(row.body, "");
            assert.deepEqual(row.mentions, []);
            assert.ok(row.deleted_at);
            assert.equal(row.content_version, 2);
            assert.equal(
                await sql(
                    `select count(*)
                     from private.chat_mention_versions
                     where message_id = ${q(id)}`,
                ),
                "1",
            );
        },
    );
    await check(
        "Moderation metadata follows actual membership and never grants an administrator access to foreign DMs",
        async () => {
            const dm = await actor(author, `select public.create_dm(${q(target)})`);
            await send("Fictional private DM", [], randomUUID(), author, dm);
            assert.ok(
                (await list(author, dm)).every((x) => x.can_moderate === false),
            );
            await assert.rejects(list(admin, dm), /42501/);
            const row = (await list()).find((x) => x.id === message);
            assert.equal(row.can_moderate, true);
            assert.equal(
                (await list(target)).find((x) => x.id === message).can_moderate,
                false,
            );
        },
    );
    await check(
        "Concurrent different edits have exactly one committed version and first-mention notice",
        async () => {
            const id = await send("Fictional concurrent edit baseline", []);
            const results = await Promise.allSettled([
                edit(id, "Fictional competing edit A", 1, [target]),
                edit(id, "Fictional competing edit B", 1, [target]),
            ]);
            assert.equal(
                results.filter((result) => result.status === "fulfilled").length,
                1,
            );
            const rejection = results.find((result) => result.status === "rejected");
            assert.ok(rejection);
            assert.match(rejection.reason.message, /40001/);
            const row = (await list()).find((message) => message.id === id);
            assert.equal(row.content_version, 2);
            assert.equal(row.mentions.length, 1);
            assert.equal((await notice(id)).length, 1);
            assert.equal(
                await sql(
                    `select count(*)
                     from private.chat_mention_versions
                     where message_id = ${q(id)}`,
                ),
                "1",
            );
        },
    );
    await check(
        "Internal helpers and private mention history have no browser execution or table grants",
        async () => {
            for (const signature of [
                "private.bump_chat_content_version()",
                "private.record_chat_content_version()",
                "private.chat_mention_member(uuid,uuid)",
                "private.prepare_chat_mentions(uuid,uuid[])",
                "private.record_chat_mentions(uuid,integer,uuid[])",
            ])
                assert.equal(
                    await sql(
                        `select has_function_privilege('authenticated',${q(signature)},'EXECUTE')`,
                    ),
                    "f",
                );
            await assert.rejects(
                actor(author, "select * from private.chat_mention_versions"),
                /permission denied/,
            );
            assert.equal(
                await sql(
                    `select has_function_privilege('anon','public.send_message_with_mentions(uuid,text,uuid,uuid,uuid[])','EXECUTE')`,
                ),
                "f",
            );
        },
    );
});
console.log(`${checks} structured mention PostgreSQL groups passed.`);