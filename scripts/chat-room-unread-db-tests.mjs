/** Real actor-scoped unread state and read/mark race on an isolated PostgreSQL database. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

let checks = 0;
await withTestDatabase(
    "chat_room_unread",
    async ({sql, actor, container, database}) => {
        const [a, b, outsider] = Array.from({length: 3}, randomUUID);
        await sql(
            `insert into auth.users(id, email)
             values ${[a, b, outsider].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
            insert into public.user_roles(user_id, role)
            values (${q(a)}, 'lecturer'),
                   (${q(b)}, 'lecturer'),
                   (${q(outsider)}, 'lecturer');`,
        );
        const room = await actor(
            b,
            `select public.create_chat_group('Fictional topic',array[${q(a)}::uuid],'topic',null)`,
        );
        const rows = (who) =>
            actor(
                who,
                "select coalesce(json_agg(x),'[]') from public.chat_rooms_with_manual_unread() x",
            ).then(JSON.parse);
        const call = (who, name, args) =>
            actor(who, `select public.${name}(${args})`);
        const check = async (name, run) => {
            await run();
            checks++;
            console.log(`PASS ${name}`);
        };
        await check(
            "Only own membership is marked, without changing the read cursor or another actor",
            async () => {
                const before = await sql(
                    `select last_read_at || ':' || last_read_message_id
                     from public.chat_members
                     where room_id = ${q(room)}
                       and user_id = ${q(a)}`,
                );
                await call(a, "mark_chat_unread", q(room));
                assert.equal((await rows(a))[0].manual_unread, true);
                assert.equal((await rows(a))[0].unread_count, 0);
                assert.equal((await rows(b))[0].manual_unread, false);
                assert.equal(
                    await sql(
                        `select last_read_at || ':' || last_read_message_id
                         from public.chat_members
                         where room_id = ${q(room)}
                           and user_id = ${q(a)}`,
                    ),
                    before,
                );
                await assert.rejects(
                    call(outsider, "mark_chat_unread", q(room)),
                    /denied/,
                );
                await assert.rejects(
                    sql(`set role anon;select public.mark_chat_unread(${q(room)})`),
                    /permission denied/,
                );
            },
        );
        await check(
            "Mute-only preserves the manual marker; explicit read clears it even in an empty room",
            async () => {
                await call(a, "mark_chat_read", `${q(room)},null,true`);
                assert.equal((await rows(a))[0].manual_unread, true);
                await call(a, "mark_chat_read", `${q(room)},null,null`);
                assert.equal((await rows(a))[0].manual_unread, false);
            },
        );
        await check(
            "Clearing a previously empty room never acknowledges a message that arrived after its empty page",
            async () => {
                await call(a, "mark_chat_unread", q(room));
                const before = await sql(
                    `select last_read_at || ':' || last_read_message_id
                     from public.chat_members
                     where room_id = ${q(room)}
                       and user_id = ${q(a)}`,
                );
                await call(
                    b,
                    "send_message",
                    `${q(room)},'Fictional message arrived after empty page',${q(randomUUID())},null`,
                );
                assert.equal((await rows(a))[0].unread_count, 1);
                await call(a, "clear_chat_manual_unread", q(room));
                const after = (await rows(a))[0];
                assert.equal(after.manual_unread, false);
                assert.equal(after.unread_count, 1);
                assert.equal(
                    await sql(
                        `select last_read_at || ':' || last_read_message_id
                         from public.chat_members
                         where room_id = ${q(room)}
                           and user_id = ${q(a)}`,
                    ),
                    before,
                );
                await call(a, "mark_chat_read", `${q(room)},null,null`);
            },
        );
        await check(
            "Actual unread counts remain accurate independently of the manual flag",
            async () => {
                await call(
                    b,
                    "send_message",
                    `${q(room)},'Fictional first',${q(randomUUID())},null`,
                );
                assert.equal((await rows(a))[0].unread_count, 1);
                await call(a, "mark_chat_unread", q(room));
                const marked = (await rows(a))[0];
                assert.equal(marked.unread_count, 1);
                assert.equal(marked.manual_unread, true);
                await call(a, "mark_chat_read", `${q(room)},null,null`);
                assert.equal((await rows(a))[0].unread_count, 0);
                assert.equal((await rows(a))[0].manual_unread, false);
            },
        );
        await check(
            "A read or empty-room clear already waiting cannot erase a later committed unread mark",
            async () => {
                for (const method of ["mark_chat_read", "clear_chat_manual_unread"]) {
                    const tag = `unread_reader_${randomUUID().replaceAll("-", "")}`;
                    const holder = spawn(
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
                        errors = "";
                    holder.stdout.on("data", (chunk) => {
                        output += chunk;
                    });
                    holder.stderr.on("data", (chunk) => {
                        errors += chunk;
                    });
                    const ended = new Promise((resolve, reject) => {
                        holder.on("error", reject);
                        holder.on("close", (code) =>
                            code === 0 ? resolve() : reject(new Error(errors)),
                        );
                    });
                    // Attach immediately, so unexpected termination cannot become an unhandled rejection.
                    const holderOutcome = Promise.allSettled([ended]);
                    let reader;
                    try {
                        holder.stdin.write(
                            `begin;select 1 from public.chat_members where room_id=${q(room)} and user_id=${q(a)} for update;select 'READY';\n`,
                        );
                        const readyBy = Date.now() + 15000;
                        while (!output.includes("READY") && Date.now() < readyBy)
                            await new Promise((r) => setTimeout(r, 10));
                        assert.match(
                            output,
                            /READY/,
                            "Controlled database transaction acquired the membership lock",
                        );
                        reader = actor(
                            a,
                            `set local application_name=${q(tag)};select public.${method}(${q(room)}${method === "mark_chat_read" ? ",null,null" : ""})`,
                        );
                        const readerOutcome = Promise.allSettled([reader]);
                        const waitBy = Date.now() + 15000;
                        let locked = false;
                        while (Date.now() < waitBy) {
                            locked =
                                (await sql(
                                    `select exists(select 1 from pg_stat_activity where datname = current_database() and application_name = ${q(tag)} and wait_event_type = 'Lock')`,
                                )) === "t";
                            if (locked) break;
                            await new Promise((r) => setTimeout(r, 20));
                        }
                        assert.equal(
                            locked,
                            true,
                            `The prior ${method} statement is genuinely blocked on the membership row`,
                        );
                        holder.stdin.end(
                            `set local role authenticated;set local request.jwt.claims=${q(JSON.stringify({sub: a, aal: "aal1", role: "authenticated"}))};select public.mark_chat_unread(${q(room)});commit;\\q\n`,
                        );
                        const h = await holderOutcome;
                        assert.equal(h[0].status, "fulfilled");
                        const r = await readerOutcome;
                        assert.equal(r[0].status, "fulfilled");
                        assert.equal((await rows(a))[0].manual_unread, true);
                        await call(a, "mark_chat_read", `${q(room)},null,null`);
                        assert.equal((await rows(a))[0].manual_unread, false);
                    } finally {
                        if (!holder.stdin.destroyed) holder.stdin.end("rollback;\\q\n");
                        await holderOutcome;
                        if (reader) await Promise.allSettled([reader]);
                    }
                }
            },
        );
        await check(
            "Revoked members immediately lose the list and both mutations",
            async () => {
                await call(b, "manage_chat_member", `${q(room)},${q(a)},true`);
                assert.deepEqual(await rows(a), []);
                await assert.rejects(call(a, "mark_chat_unread", q(room)), /denied/);
                await assert.rejects(
                    call(a, "mark_chat_read", `${q(room)},null,null`),
                    /denied/,
                );
            },
        );
    },
);
console.log(`${checks} chat room unread SQL groups passed`);