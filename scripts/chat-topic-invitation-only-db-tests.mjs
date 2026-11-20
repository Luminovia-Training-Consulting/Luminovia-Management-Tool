/** Isolated PostgreSQL policy, creation, bypass and concurrency coverage for strict topic invitations. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

let checks = 0;
await withTestDatabase(
    "topic_invite_only",
    async ({sql, actor, container, database}) => {
        const [owner, peer, other, outsider] = Array.from(
            {length: 4},
            randomUUID,
        );
        await sql(
            `insert into auth.users(id, email)
             values ${[owner, peer, other, outsider].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
            insert into public.user_roles(user_id, role)
            values (${q(owner)}, 'lecturer'),
                   (${q(peer)}, 'lecturer'),
                   (${q(other)}, 'lecturer'),
                   (${q(outsider)}, 'participant');`,
        );
        const call = (who, name, args) =>
            actor(who, `select public.${name}(${args})`);
        const list = (who) =>
            actor(
                who,
                "select coalesce(json_agg(x),'[]') from public.topic_invitation_inbox() x",
            ).then(JSON.parse);
        const check = async (name, run) => {
            await run();
            checks++;
            console.log(`PASS ${name}`);
        };
        let strict, invitation;
        await check(
            "Strict group creation sends invitations atomically without adding invitees",
            async () => {
                strict = await call(
                    owner,
                    "create_invitation_only_topic",
                    `${q("Fictional strict")},array[${q(peer)}]::uuid[]`,
                );
                assert.equal(
                    await call(owner, "topic_invitation_only", q(strict)),
                    "t",
                );
                assert.equal(
                    await sql(
                        `select count(*)
                         from public.chat_members
                         where room_id = ${q(strict)}
                           and user_id = ${q(peer)}
                           and removed_at is null`,
                    ),
                    "0",
                );
                invitation = (await list(peer))[0].id;
                await assert.rejects(
                    call(
                        owner,
                        "create_invitation_only_topic",
                        `${q("Fictional invalid")},array[${q(peer)},${q(outsider)}]::uuid[]`,
                    ),
                    /denied/i,
                );
                assert.equal(
                    await sql(
                        "select count(*) from public.chat_rooms where title='Fictional invalid'",
                    ),
                    "0",
                );
            },
        );
        await check(
            "Direct add and forged direct table writes fail; consent is required and retry is idempotent",
            async () => {
                await assert.rejects(
                    call(owner, "manage_chat_member", `${q(strict)},${q(peer)},false`),
                    /Invitation acceptance required/,
                );
                await assert.rejects(
                    actor(
                        peer,
                        `insert into public.chat_members(room_id, user_id)
                         values (${q(strict)}, ${q(peer)})`,
                    ),
                    /permission|row.level/i,
                );
                assert.equal(
                    await call(peer, "respond_topic_invitation", `${q(invitation)},true`),
                    strict,
                );
                assert.equal(
                    await call(peer, "respond_topic_invitation", `${q(invitation)},true`),
                    strict,
                );
                assert.equal(await call(peer, "topic_invitation_only", q(strict)), "t");
                await call(owner, "manage_chat_member", `${q(strict)},${q(peer)},true`);
                await assert.rejects(
                    call(owner, "manage_chat_member", `${q(strict)},${q(peer)},false`),
                    /Invitation acceptance required/,
                );
                await assert.rejects(
                    call(peer, "respond_topic_invitation", `${q(invitation)},true`),
                    /unavailable/i,
                );
            },
        );
        await check(
            "Only current owner changes mode and stale changes cannot silently overwrite it",
            async () => {
                const room = await call(
                    owner,
                    "create_chat_group",
                    `${q("Fictional ordinary")},array[${q(other)}]::uuid[],'topic',null`,
                );
                await assert.rejects(
                    call(other, "set_topic_invitation_only", `${q(room)},false,true`),
                    /denied/i,
                );
                await assert.rejects(
                    call(outsider, "topic_invitation_only", q(room)),
                    /denied/i,
                );
                assert.equal(
                    await call(
                        owner,
                        "set_topic_invitation_only",
                        `${q(room)},false,true`,
                    ),
                    "t",
                );
                await assert.rejects(
                    call(owner, "set_topic_invitation_only", `${q(room)},false,true`),
                    /changed/i,
                );
                assert.equal(
                    await sql(
                        `select count(*)
                         from public.chat_members
                         where room_id = ${q(room)}
                           and user_id = ${q(other)}
                           and removed_at is null`,
                    ),
                    "1",
                );
                await assert.rejects(
                    call(owner, "manage_chat_member", `${q(room)},${q(peer)},false`),
                    /Invitation acceptance required/,
                );
                assert.equal(
                    await call(
                        owner,
                        "set_topic_invitation_only",
                        `${q(room)},true,false`,
                    ),
                    "f",
                );
                await call(owner, "manage_chat_member", `${q(room)},${q(peer)},false`);
                assert.equal(
                    await sql(
                        `select count(*)
                         from public.chat_members
                         where room_id = ${q(room)}
                           and user_id = ${q(peer)}
                           and removed_at is null`,
                    ),
                    "1",
                );
            },
        );
        await check(
            "Concurrent direct add rechecks the committed mode after the real room lock",
            async () => {
                const room = await call(
                    owner,
                    "create_chat_group",
                    `${q("Fictional race")},'{}'::uuid[],'topic',null`,
                );
                const tag = `strict_add_${randomUUID().replaceAll("-", "")}`;
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
                holder.stdout.on("data", (c) => (output += c));
                holder.stderr.on("data", (c) => (errors += c));
                const ended = new Promise((resolve, reject) => {
                    holder.on("error", reject);
                    holder.on("close", (code) =>
                        code === 0 ? resolve() : reject(new Error(errors)),
                    );
                });
                const holdOutcome = Promise.allSettled([ended]);
                let add;
                try {
                    holder.stdin.write(
                        `begin;select id from public.chat_rooms where id=${q(room)} for update;select 'READY';\n`,
                    );
                    const readyBy = Date.now() + 15000;
                    while (!output.includes("READY") && Date.now() < readyBy)
                        await new Promise((r) => setTimeout(r, 10));
                    assert.match(output, /READY/);
                    add = actor(
                        owner,
                        `set local application_name=${q(tag)};select public.manage_chat_member(${q(room)},${q(peer)},false)`,
                    );
                    const addOutcome = Promise.allSettled([add]);
                    let blocked = false;
                    const waitBy = Date.now() + 15000;
                    while (Date.now() < waitBy) {
                        blocked =
                            (await sql(
                                `select exists(select 1 from pg_stat_activity where datname = current_database() and application_name = ${q(tag)} and wait_event_type = 'Lock')`,
                            )) === "t";
                        if (blocked) break;
                        await new Promise((r) => setTimeout(r, 20));
                    }
                    assert.equal(blocked, true);
                    holder.stdin.end(
                        `set local role authenticated;set local request.jwt.claims=${q(JSON.stringify({sub: owner, aal: "aal1", role: "authenticated"}))};select public.set_topic_invitation_only(${q(room)},false,true);commit;\\q\n`,
                    );
                    assert.equal((await holdOutcome)[0].status, "fulfilled");
                    const result = (await addOutcome)[0];
                    assert.equal(result.status, "rejected");
                    assert.match(result.reason.message, /Invitation acceptance required/);
                    assert.equal(
                        await sql(
                            `select count(*)
                             from public.chat_members
                             where room_id = ${q(room)}
                               and user_id = ${q(peer)}
                               and removed_at is null`,
                        ),
                        "0",
                    );
                } finally {
                    if (!holder.stdin.destroyed) holder.stdin.end("rollback;\\q\n");
                    await holdOutcome;
                    if (add) await Promise.allSettled([add]);
                }
            },
        );
    },
);
console.log(`${checks} invitation-only SQL checks passed`);