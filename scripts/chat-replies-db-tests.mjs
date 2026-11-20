/** Disposable PostgreSQL replay of actor-scoped, idempotent message replies. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase(
    "chat_replies",
    async ({sql, actor, container, database}) => {
        const [a, b, foreign] = Array.from({length: 3}, randomUUID);
        await sql(`insert into auth.users(id, email)
                   values ${[a, b, foreign].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
   insert into public.user_roles(user_id,role) values (${q(a)},'lecturer'),(${q(b)},'lecturer'),(${q(foreign)},'lecturer');
   update public.profiles set display_name='Fictional actor';`);
        const v = (id, body) => actor(id, body);
        const room = await v(
            a,
            `select public.create_chat_group('Fictional topic',array[${q(b)}]::uuid[])`,
        );
        const other = await v(
            foreign,
            `select public.create_chat_group('Other private',array[]::uuid[])`,
        );
        const send = (who, to, text, key = randomUUID()) =>
            v(who, `select public.send_message(${q(to)},${q(text)},${q(key)})`);
        const parent = await send(a, room, "Reply parent before edit");
        const outsiderParent = await send(foreign, other, "Foreign parent secret");
        const key = randomUUID();
        const reply = (who, target, request = key, text = "Reply content") =>
            v(
                who,
                `select public.send_chat_reply(${q(room)},${q(target)},${q(text)},${q(request)},null,array[]::uuid[])`,
            );
        const id = await reply(b, parent);
        assert.equal(await reply(b, parent), id);
        await assert.rejects(reply(b, outsiderParent), /22023/);
        await assert.rejects(reply(b, outsiderParent, randomUUID()), /42501/);
        const preview = async (who) =>
            JSON.parse(
                await v(
                    who,
                    `select public.chat_reply_previews(${q(room)},array[${q(id)}]::uuid[],array[1]::integer[])`,
                ),
            );
        assert.equal((await preview(b))[id].body, "Reply parent before edit");
        assert.equal((await preview(a))[id].id, parent);
        await assert.rejects(preview(foreign), /42501/);
        assert.equal(
            await sql(`select count(*) from public.messages where id=${q(id)}`),
            "1",
        );
        const prior = randomUUID();
        await send(b, room, "Legacy ordinary", prior);
        await assert.rejects(reply(b, parent, prior, "Legacy ordinary"), /22023/);
        await assert.rejects(
            v(b, "select * from private.chat_message_replies"),
            /42501/,
        );
        const concurrentKey = randomUUID();
        const withMention = () =>
            v(
                b,
                `select public.send_chat_reply(${q(room)},${q(parent)},'Mention reply',${q(concurrentKey)},null,array[${q(a)}]::uuid[])`,
            );
        const concurrent = await Promise.all([withMention(), withMention()]);
        assert.equal(concurrent[0], concurrent[1]);
        const projected = JSON.parse(
            await v(
                a,
                `select coalesce(json_agg(x),'[]') from public.chat_messages_with_mentions(${q(room)},null,null,'Mention reply',40) x`,
            ),
        );
        assert.equal(projected.length, 1);
        assert.equal(projected[0].mentions[0].user_id, a);
        await assert.rejects(
            v(
                b,
                `select public.send_chat_reply(${q(room)},${q(parent)},'Mention reply',${q(concurrentKey)},null,array[]::uuid[])`,
            ),
            /22023/,
        );
        assert.equal(
            await sql(
                "select has_function_privilege('anon','public.send_chat_reply(uuid,uuid,text,uuid,uuid,uuid[])','execute')",
            ),
            "f",
        );
        assert.equal(
            await sql(
                "select has_function_privilege('anon','public.chat_reply_previews(uuid,uuid[],integer[])','execute')",
            ),
            "f",
        );
        console.log(
            "PASS reply retries and parent are bound, foreign rooms and prior normal-send keys are rejected",
        );
        await v(
            a,
            `select public.edit_message(${q(parent)},'Edited parent no snapshot')`,
        );
        assert.equal((await preview(b))[id].body, "Edited parent no snapshot");
        // The history RPC may have returned the former child/page text just before
        // the edit committed; the second call must not certify that stale page.
        await assert.rejects(
            v(
                a,
                `select public.chat_reply_previews(${q(room)},array[${q(parent)}]::uuid[],array[1]::integer[])`,
            ),
            /40001/,
        );
        const oldParentVersion = Number(
            await sql(
                `select content_version from public.messages where id=${q(parent)}`,
            ),
        );
        await v(b, `select public.hide_chat_message(${q(parent)})`);
        await assert.rejects(
            v(
                b,
                `select public.chat_reply_previews(${q(room)},array[${q(parent)},${q(id)}]::uuid[],array[${oldParentVersion},1]::integer[])`,
            ),
            /40001/,
        );
        assert.equal((await preview(b))[id], null);
        assert.equal((await preview(a))[id].body, "Edited parent no snapshot");
        await assert.rejects(reply(b, parent, randomUUID()), /42501/);
        const scope = JSON.parse(
            await sql(`select private.deletion_snapshot('message',${q(parent)})`),
        );
        assert.equal(scope.counts["private.chat_message_replies"], 2);
        assert.ok(
            !scope.blockers.some(
                (entry) => entry.kind === "private.chat_message_replies",
            ),
        );
        await v(a, `select public.delete_message(${q(parent)})`);
        await assert.rejects(
            v(
                a,
                `select public.chat_reply_previews(${q(room)},array[${q(parent)}]::uuid[],array[${oldParentVersion}]::integer[])`,
            ),
            /40001/,
        );
        assert.equal((await preview(a))[id], null);
        assert.equal(await reply(b, parent), id);
        // A prior successful retry must not return its receipt after its advisory-lock
        // wait outlives membership revocation. Observe the actual blocked backend.
        const blocker = spawn(
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
        let blockerError = "";
        blocker.stderr.on("data", (chunk) => {
            blockerError += chunk.toString();
        });
        const exited = once(blocker, "exit");
        const ready = new Promise((resolve, reject) => {
            let output = "";
            const timer = setTimeout(
                () => reject(new Error("Advisory fixture did not become ready")),
                10000,
            );
            blocker.stdout.on("data", (chunk) => {
                output += chunk.toString();
                if (output.includes("LOCK_READY")) {
                    clearTimeout(timer);
                    resolve();
                }
            });
            blocker.once("error", reject);
        });
        blocker.stdin.write(
            `begin; select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chat-send:'||${q(b)}::text,0));\n\\echo LOCK_READY\n`,
        );
        await ready;
        // First page succeeds before revocation; a later preview request must fail
        // closed even if no Realtime event is delivered to this client.
        const earlierPage = JSON.parse(
            await v(
                b,
                `select coalesce(json_agg(x),'[]') from public.chat_messages_with_mentions(${q(room)},null,null,'',40) x`,
            ),
        );
        assert.ok(earlierPage.some((item) => item.id === id));
        const waiting = reply(b, parent).then(
            (value) => ({value}),
            (error) => ({error}),
        );
        try {
            let observed = false;
            for (let i = 0; i < 100; i++) {
                const count = await sql(
                    "select count(*) from pg_catalog.pg_stat_activity where wait_event_type='Lock' and wait_event='advisory' and query like '%send_chat_reply%'",
                );
                if (Number(count) > 0) {
                    observed = true;
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 30));
            }
            assert.ok(
                observed,
                "Reply retry must really be waiting on the advisory lock",
            );
            await v(a, `select public.manage_chat_member(${q(room)},${q(b)},true)`);
        } finally {
            blocker.stdin.end("commit;\n\\q\n");
        }
        const [exitCode] = await exited;
        assert.equal(exitCode, 0, blockerError);
        const result = await waiting;
        assert.ok(
            "error" in result,
            "Revoked retry must not return its former reply ID",
        );
        assert.match(String(result.error), /42501/);
        await assert.rejects(preview(b), /42501/);
        await assert.rejects(reply(b, parent), /42501/);
        console.log(
            "PASS previews re-read current edits, hide/deletion/revocation never return parent content, and deletion scope includes the edge",
        );
    },
);