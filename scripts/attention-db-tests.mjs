/** Real disposable PostgreSQL: daily quiet hours affect attention, not receipts. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("attention_test", async ({sql, actor}) => {
    const [teacher, peer, administrator] = Array.from({length: 3}, randomUUID);
    await sql(`insert into auth.users(id, email)
               values ${[teacher, peer, administrator].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
    insert into public.user_roles(user_id, role)
    values (${q(teacher)}, 'lecturer'),
           (${q(peer)}, 'lecturer'),
           (${q(administrator)}, 'admin');
    update public.profiles
    set time_zone='Australia/Brisbane'
    where id = ${q(teacher)};`);
    const rpc = async (who, name, args = []) =>
        JSON.parse(await actor(who, `select public.${name}(${args.join(",")})`));
    const defaults = (enabled = true) => ({
        enabled,
        start_time: "22:00",
        end_time: "07:00",
        time_zone: "UTC",
    });
    const save = (who, payload, version) =>
        rpc(who, "save_attention_preferences", [
            q(JSON.stringify(payload)) + "::jsonb",
            String(version),
        ]);
    let checks = 0;
    const check = async (label, run) => {
        await run();
        console.log("PASS " + label);
        checks++;
    };

    await check(
        "Unconfigured quiet hours follow the own profile zone without writing or changing category preferences",
        async () => {
            assert.deepEqual(await rpc(teacher, "attention_preferences"), {
                enabled: false,
                start_time: "22:00",
                end_time: "07:00",
                time_zone: "Australia/Brisbane",
                version: 0,
            });
            assert.equal(
                await sql("select count(*) from private.attention_preferences"),
                "0",
            );
            assert.deepEqual(await rpc(teacher, "notification_preferences"), {
                chat: true,
                forum: true,
                job_updates: true,
                reminders: true,
                version: 1,
            });
        },
    );
    await check(
        "Real IANA wall-clock boundaries handle overnight, day windows and both DST folds",
        async () => {
            const cases = [
                ["2026-11-15T12:00:00Z", "Australia/Brisbane", 1320, 420, true],
                ["2026-11-15T21:00:00Z", "Australia/Brisbane", 1320, 420, false],
                ["2026-11-15T02:00:00Z", "Australia/Brisbane", 1320, 420, false],
                ["2026-11-15T10:00:00Z", "UTC", 600, 720, true],
                ["2026-11-15T12:00:00Z", "UTC", 600, 720, false],
                ["2026-03-29T00:59:00Z", "Europe/Berlin", 120, 180, false],
                ["2026-03-29T01:00:00Z", "Europe/Berlin", 120, 180, false],
                ["2026-03-29T01:00:00Z", "Europe/Berlin", 90, 210, true],
                ["2026-10-25T00:30:00Z", "Europe/Berlin", 135, 165, true],
                ["2026-10-25T01:30:00Z", "Europe/Berlin", 135, 165, true],
                ["2026-10-25T01:45:00Z", "Europe/Berlin", 135, 165, false],
            ];
            for (const [at, zone, start, end, expected] of cases)
                assert.equal(
                    await sql(
                        `select private.attention_is_quiet(${q(at)},${q(zone)},${start},${end})`,
                    ),
                    expected ? "t" : "f",
                );
            await assert.rejects(
                sql("select private.attention_is_quiet('infinity','UTC',0,60)"),
                /22023/,
            );
        },
    );
    await check(
        "Closed typed payloads reject forged owners, invalid clocks/zones and equal endpoints atomically",
        async () => {
            for (const payload of [
                {...defaults(), user_id: peer},
                {...defaults(), enabled: "true"},
                {...defaults(), start_time: "24:00"},
                {...defaults(), end_time: "7:00"},
                {...defaults(), time_zone: "Not/AZone"},
                {...defaults(), end_time: "22:00"},
                {...defaults(), time_zone: null},
            ])
                await assert.rejects(save(teacher, payload, 0), /22023/);
            await assert.rejects(save(teacher, defaults(), -1), /22023/);
            await assert.rejects(save(teacher, defaults(), 99), /40001/);
            assert.equal((await rpc(teacher, "attention_preferences")).version, 0);
            assert.equal(
                await sql("select count(*) from private.attention_preferences"),
                "0",
            );
        },
    );
    await check(
        "Concurrent first saves have one winner instead of a missing-row lock race",
        async () => {
            const results = await Promise.allSettled([
                save(teacher, defaults(), 0),
                save(teacher, {...defaults(), end_time: "06:00"}, 0),
            ]);
            assert.equal(results.filter((v) => v.status === "fulfilled").length, 1);
            const rejected = results.find((v) => v.status === "rejected");
            assert.match(rejected.reason.message, /40001/);
            assert.equal((await rpc(teacher, "attention_preferences")).version, 1);
            assert.equal((await rpc(peer, "attention_preferences")).version, 0);
        },
    );
    await check(
        "Private preference ledgers are not directly writable/readable; admin still only reads own settings",
        async () => {
            for (const who of [teacher, peer, administrator]) {
                await assert.rejects(
                    actor(who, "select * from private.attention_preferences"),
                    /permission denied/,
                );
                await assert.rejects(
                    actor(who, `select private.attention_is_quiet(now(),'UTC',0,60)`),
                    /permission denied/,
                );
            }
            assert.equal(
                (await rpc(administrator, "attention_preferences")).version,
                0,
            );
            assert.equal(
                await sql(
                    "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and has_function_privilege('anon',p.oid,'EXECUTE') and p.oid not in(to_regprocedure('public.require_portal_access()'),to_regprocedure('private.require_portal_access()'))",
                ),
                "0",
            );
        },
    );
    const critical = Array.from({length: 3}, randomUUID);
    await check(
        "Quiet attention excludes optional badges while preserving every inbox item and critical receipt",
        async () => {
            const room = randomUUID();
            const messages = Array.from({length: 17}, randomUUID);
            const optional = messages.map((id) => `(${q(teacher)},'chat_message',${q(id)})`);
            await sql(`insert into public.chat_rooms(id,kind,owner_id,dm_key)
      values(${q(room)},'dm',${q(teacher)},${q([teacher, peer].sort().join(":"))});
      insert into public.chat_members(room_id,user_id)
      values(${q(room)},${q(teacher)}),(${q(room)},${q(peer)});
      insert into public.messages(id,room_id,sender_id,body,client_id,request_hash)
      values${messages.map((id) => `(${q(id)},${q(room)},${q(teacher)},'Fictional optional chat',${q(randomUUID())},'fixture')`).join(",")};
      insert into public.notifications(user_id,kind,resource_id) values${optional.join(",")};
      insert into public.notifications(id,user_id,kind,resource_id) values${critical.map((id, i) => `(${q(id)},${q(teacher)},${q(["claim_confirmed", "claim_cancelled", "contract_available"][i])},${q(randomUUID())})`).join(",")};
      insert into public.notifications(user_id,kind,resource_id) values(${q(peer)},'claim_confirmed',${q(randomUUID())});`);
            const minute = Number(
                await sql(
                    "select extract(hour from now() at time zone 'UTC')::integer*60+extract(minute from now() at time zone 'UTC')::integer",
                ),
            );
            const clock = (value) =>
                `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
            const current = await save(
                teacher,
                {
                    ...defaults(),
                    start_time: clock((minute + 1435) % 1440),
                    end_time: clock((minute + 5) % 1440),
                },
                1,
            );
            assert.equal(current.version, 2);
            const inbox = await rpc(teacher, "notification_inbox", [
                "false",
                "null",
                "null",
                "8",
            ]);
            assert.equal(inbox.items.length, 8);
            assert.equal(inbox.unread_count, 20);
            assert.equal(inbox.quiet_active, true);
            assert.equal(inbox.attention_count, 3);
            assert.equal(
                await sql(
                    `select count(*) from public.notifications where user_id=${q(teacher)}`,
                ),
                "20",
            );
            await rpc(teacher, "mark_notifications", [
                `array[${q(critical[0])}::uuid]`,
                "null",
                "true",
            ]);
            const read = await rpc(teacher, "notification_inbox");
            assert.equal(read.attention_count, 2);
            assert.equal(read.unread_count, 19);
            assert.equal(
                (await rpc(administrator, "notification_inbox")).unread_count,
                0,
            );
        },
    );
    await check(
        "The original four-flag API keeps its own version and still suppresses chat but retains mandatory receipts",
        async () => {
            await rpc(teacher, "save_notification_preferences", [
                q(
                    JSON.stringify({
                        chat: false,
                        forum: true,
                        job_updates: true,
                        reminders: true,
                    }),
                ) + "::jsonb",
                "1",
            ]);
            assert.equal((await rpc(teacher, "attention_preferences")).version, 2);
            await sql(
                `insert into public.notifications(user_id,kind,resource_id) values(${q(teacher)},'chat_message',${q(randomUUID())}),(${q(teacher)},'contract_available',${q(randomUUID())})`,
            );
            const inbox = await rpc(teacher, "notification_inbox");
            assert.equal(inbox.attention_count, 3);
            assert.equal(inbox.unread_count, 20);
            assert.equal(
                await sql(
                    `select count(*) from public.notifications where user_id=${q(teacher)}`,
                ),
                "21",
            );
            assert.equal((await rpc(teacher, "notification_preferences")).version, 2);
        },
    );
    await check(
        "Stale later writes leave the saved zone/window untouched and disabling restores the complete counter",
        async () => {
            const current = await rpc(teacher, "attention_preferences");
            await assert.rejects(save(teacher, defaults(false), 1), /40001/);
            assert.deepEqual(await rpc(teacher, "attention_preferences"), current);
            await save(
                teacher,
                {...defaults(false), time_zone: "Australia/Brisbane"},
                2,
            );
            const inbox = await rpc(teacher, "notification_inbox");
            assert.equal(inbox.quiet_active, false);
            assert.equal(inbox.attention_count, undefined);
            assert.equal(inbox.unread_count, 20);
        },
    );
    await check(
        "Existing-token suspension removes all attention reads/writes immediately",
        async () => {
            await sql(
                `update public.profiles set active=false where id=${q(teacher)}`,
            );
            await assert.rejects(rpc(teacher, "attention_preferences"), /42501/);
            await assert.rejects(rpc(teacher, "notification_inbox"), /42501/);
            await assert.rejects(save(teacher, defaults(), 3), /42501/);
            assert.equal((await rpc(peer, "attention_preferences")).version, 0);
        },
    );
    console.log(
        `${checks} attention PostgreSQL checks passed (actual timezone/DST, privacy, CAS and retained inbox).`,
    );
});
