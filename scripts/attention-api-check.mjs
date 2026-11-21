/** Auth/REST quiet hours change attention only; canonical disposable stack only. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {withApiFixture} from "./testing/api.mjs";

await withApiFixture(
    async ({actor, passwordOnly, service, checked, sql, defer, url}) => {
        const owner = await actor("attention-owner", "lecturer"),
            peer = await actor("attention-peer", "lecturer"),
            admin = await actor("attention-admin", "admin"),
            users = [owner.id, peer.id, admin.id],
            room = randomUUID();
        defer(async () => {
            await checked(
                service.from("notifications").delete().in("user_id", users),
                "Remove only own attention notices",
            );
            await sql(`delete from public.messages where room_id='${room}';
              delete from public.chat_members where room_id='${room}';
              delete from public.chat_rooms where id='${room}';`);
        });
        const preferences = async (who) =>
            checked(
                who.client.rpc("attention_preferences"),
                "Read own actual quiet settings",
            );
        const legacy = await checked(
            owner.client.rpc("notification_preferences"),
            "Snapshot unchanged four-category contract",
        );
        assert.deepEqual(legacy, {
            chat: true,
            forum: true,
            job_updates: true,
            reminders: true,
            version: 1,
        });
        assert.equal((await preferences(owner)).version, 0);
        assert.equal((await preferences(owner)).enabled, false);
        assert.equal((await preferences(peer)).version, 0);
        const base = {
            enabled: true,
            start_time: "22:00",
            end_time: "07:00",
            time_zone: "UTC",
        };
        const save = (who, payload, version) =>
            who.client.rpc("save_attention_preferences", {
                p_payload: payload,
                p_expected_version: version,
            });
        for (const payload of [
            {...base, user_id: peer.id},
            {...base, enabled: "true"},
            {...base, start_time: "24:00"},
            {...base, end_time: "22:00"},
            {...base, time_zone: "Invalid/Zone"},
            {...base, time_zone: null},
        ])
            assert.equal((await save(owner, payload, 0)).error?.code, "22023");
        assert.equal((await save(owner, base, -1)).error?.code, "22023");
        assert.equal((await preferences(owner)).version, 0);
        const simultaneous = await Promise.all([
            save(owner, base, 0),
            save(owner, {...base, end_time: "06:00"}, 0),
        ]);
        assert.equal(simultaneous.filter((result) => !result.error).length, 1);
        assert.equal(
            simultaneous.find((result) => result.error)?.error.code,
            "40001",
        );
        const saved = await preferences(owner);
        assert.equal(saved.version, 1);
        assert.equal((await preferences(peer)).version, 0);
        await passwordOnly(admin.client);
        assert.equal((await preferences(admin)).version, 0);
        for (const who of [owner, peer, admin]) {
            const direct = await who.client
                .schema("private")
                .from("attention_preferences")
                .select("*");
            assert.ok(direct.error);
            assert.equal(direct.data, null);
        }
        const foreignArgument = await admin.client.rpc("attention_preferences", {
            p_user_id: owner.id,
        });
        assert.ok(foreignArgument.error);
        assert.equal(foreignArgument.data, null);
        assert.equal(
            (await save(admin, {...base, user_id: owner.id}, 0)).error?.code,
            "22023",
        );
        assert.deepEqual(await preferences(owner), saved);
        // Use the actual database minute without changing any host/server clock.
        const minute = Number(
            await sql(
                "select extract(hour from now() at time zone 'UTC')::integer*60+extract(minute from now() at time zone 'UTC')::integer",
            ),
        );
        const time = (value) =>
            `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
        const current = {
            enabled: true,
            start_time: time((minute + 1410) % 1440),
            end_time: time((minute + 30) % 1440),
            time_zone: "UTC",
        };
        const active = await checked(
            save(owner, current, 1),
            "Enable actual current quiet window",
        );
        assert.equal(active.version, 2);
        assert.deepEqual(
            await checked(
                owner.client.rpc("notification_preferences"),
                "Four-flag contract unchanged by attention",
            ),
            legacy,
        );
        const critical = Array.from({length: 3}, (_, i) => ({
            id: randomUUID(),
            user_id: owner.id,
            kind: ["claim_confirmed", "claim_cancelled", "contract_available"][i],
            resource_id: randomUUID(),
        }));
        // Keep real chat membership and message visibility in the quiet-hours path.
        await checked(service.from("chat_rooms").insert({
            id: room, title: "Fictional attention room", kind: "topic", owner_id: peer.id,
        }));
        await checked(service.from("chat_members").insert(
            [owner.id, peer.id].map((user_id) => ({room_id: room, user_id})),
        ));
        const messages = Array.from({length: 18}, () => ({
            id: randomUUID(), room_id: room, sender_id: peer.id,
            client_id: randomUUID(), request_hash: "fictional-attention-resource",
            body: "Fictional chat update",
        }));
        await checked(service.from("messages").insert(messages));
        const optional = messages.slice(0, -1).map(({id}) => ({
                id: randomUUID(),
                user_id: owner.id,
                kind: "chat_message",
                resource_id: id,
            })),
            unavailable = randomUUID(),
            foreign = randomUUID();
        await checked(
            service.from("notifications").insert([
                ...optional,
                ...critical,
                {
                    id: unavailable,
                    user_id: owner.id,
                    kind: "chat_message",
                    resource_id: randomUUID(),
                },
                {
                    id: foreign,
                    user_id: peer.id,
                    kind: "claim_confirmed",
                    resource_id: randomUUID(),
                },
            ]),
            "Create actual own/foreign notification rows during quiet time",
        );
        const inbox = await checked(
            owner.client.rpc("notification_inbox", {p_limit: 40}),
            "Read unchanged full quiet inbox",
        );
        assert.equal(inbox.quiet_active, true);
        assert.equal(inbox.attention_count, 3);
        assert.equal(inbox.unread_count, 20);
        assert.equal(inbox.items.length, 20);
        assert.ok(
            inbox.items.every((item) =>
                item.read_at === null && item.id !== foreign && item.id !== unavailable,
            ),
        );
        assert.deepEqual(
            new Set(inbox.items.map((item) => item.id)),
            new Set([...optional, ...critical].map((item) => item.id)),
        );
        assert.equal(
            (
                await checked(
                    admin.client.rpc("notification_inbox"),
                    "Admin retains own inbox",
                )
            ).unread_count,
            0,
        );
        assert.equal(
            (
                await checked(
                    peer.client.rpc("notification_inbox"),
                    "Foreign receipt remains foreign",
                )
            ).unread_count,
            1,
        );
        await checked(
            owner.client.rpc("mark_notifications", {
                p_ids: [critical[0].id],
                p_read: true,
            }),
            "Explicitly acknowledge one own critical receipt",
        );
        const acknowledged = await checked(
            owner.client.rpc("notification_inbox"),
            "Quiet mode never auto-acknowledges",
        );
        assert.equal(acknowledged.attention_count, 2);
        assert.equal(acknowledged.unread_count, 19);
        assert.equal(
            acknowledged.items.filter((item) => item.read_at !== null).length,
            1,
        );
        const before = await preferences(owner);
        assert.equal(
            (await save(owner, {...current, enabled: false}, 1)).error?.code,
            "40001",
        );
        assert.deepEqual(await preferences(owner), before);
        await checked(
            save(owner, {...current, enabled: false}, 2),
            "Disable quiet mode",
        );
        const disabled = await checked(
            owner.client.rpc("notification_inbox"),
            "Restore complete bell counter",
        );
        assert.equal(disabled.quiet_active, false);
        assert.equal(Object.hasOwn(disabled, "attention_count"), false);
        assert.equal(disabled.unread_count, 19);
        assert.equal(disabled.items.length, 20);
        const changedLegacy = await checked(
            owner.client.rpc("save_notification_preferences", {
                p_payload: {
                    chat: false,
                    forum: true,
                    job_updates: true,
                    reminders: true,
                },
                p_expected_version: 1,
            }),
            "Original four-category API still works",
        );
        assert.equal(changedLegacy.version, 2);
        assert.equal((await preferences(owner)).version, 3);
        await checked(
            service.from("notifications").insert({
                user_id: owner.id,
                kind: "chat_message",
                resource_id: messages.at(-1).id,
            }),
            "Disabled legacy category suppresses an otherwise authorized message",
        );
        assert.equal(
            (
                await checked(
                    owner.client.rpc("notification_inbox"),
                    "Optional suppression unchanged",
                )
            ).items.length,
            20,
        );
        await checked(
            service.from("profiles").update({active: false}).eq("id", peer.id),
            "Suspend only own active-session fixture",
        );
        assert.equal(
            (await peer.client.rpc("attention_preferences")).error?.code,
            "42501",
        );
        assert.equal((await save(peer, base, 0)).error?.code, "42501");
        assert.equal(
            (await peer.client.rpc("notification_inbox")).error?.code,
            "42501",
        );
        const anonymous = createClient(url, process.env.SUPABASE_ANON_KEY, {
            auth: {persistSession: false, autoRefreshToken: false},
        });
        for (const name of ["attention_preferences", "notification_inbox"]) {
            const denied = await anonymous.rpc(name);
            assert.ok(denied.error);
            assert.equal(denied.data, null);
        }
        const deniedSave = await anonymous.rpc("save_attention_preferences", {
            p_payload: base,
            p_expected_version: 0,
        });
        assert.ok(deniedSave.error);
        assert.equal(deniedSave.data, null);
        console.log(
            "PASS actual Auth/password-only authentication/REST: own initial/versioned quiet settings, concurrent CAS, invalid/foreign/admin/anonymous/old-token boundaries, independent legacy four flags, current database-minute quiet counter3 of20, explicit read only, no deleted notifications and full counter after disabling. No email/push/scheduler claim.",
        );
    },
);