/** Actual Auth/REST: email channel ownership, compare-and-swap and worker ACLs. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {withApiFixture} from "./testing/api.mjs";
import {quoteSql as q} from "./testing/database.mjs";

await withApiFixture(
    async ({actor, service, checked, sql, defer, url, suffix}) => {
        const owner = await actor("delivery-owner", "lecturer");
        const peer = await actor("delivery-peer", "lecturer");
        const administrator = await actor("delivery-admin", "admin");
        const ids = [owner.id, peer.id, administrator.id];
        defer(async () => {
            await checked(
                service.from("notifications").delete().in("user_id", ids),
                "Remove only fictional delivery notifications and their private outbox",
            );
        });
        const prefs = (client) =>
            checked(
                client.rpc("delivery_preferences"),
                "Read own email delivery preferences",
            );
        const save = async (client, updates) => {
            const {version, ...previous} = await prefs(client);
            return checked(
                client.rpc("save_delivery_preferences", {
                    p_payload: {...previous, ...updates},
                    p_expected_version: version,
                }),
                "Save own email channel",
            );
        };
        const initial = await prefs(owner.client);
        assert.deepEqual(initial, {
            email_enabled: false,
            quiet_start: null,
            quiet_end: null,
            time_zone: "Europe/Berlin",
            version: 1,
        });
        const payload = {
            email_enabled: true,
            quiet_start: "22:00",
            quiet_end: "07:00",
            time_zone: "Australia/Brisbane",
        };
        const saves = await Promise.all(
            [1, 2].map(() =>
                owner.client.rpc("save_delivery_preferences", {
                    p_payload: payload,
                    p_expected_version: initial.version,
                }),
            ),
        );
        assert.equal(saves.filter((result) => !result.error).length, 1);
        assert.equal(saves.find((result) => result.error)?.error.code, "40001");
        assert.deepEqual(await prefs(owner.client), {...payload, version: 2});
        assert.equal((await prefs(peer.client)).email_enabled, false);
        assert.equal((await prefs(administrator.client)).email_enabled, false);
        assert.equal(
            (
                await owner.client.rpc("save_delivery_preferences", {
                    p_payload: {...payload, user_id: peer.id},
                    p_expected_version: 2,
                })
            ).error?.code,
            "22023",
        );
        for (const invalid of [
            {quiet_start: "24:00"},
            {quiet_start: null},
            {quiet_end: "22:00"},
            {time_zone: "Invalid/Unknown"},
            {email_enabled: "true"},
        ])
            assert.equal(
                (
                    await owner.client.rpc("save_delivery_preferences", {
                        p_payload: {...payload, ...invalid},
                        p_expected_version: 2,
                    })
                ).error?.code,
                "22023",
            );
        assert.equal((await prefs(owner.client)).version, 2);

        // A browser may edit its own user metadata, but that cannot grant worker
        // rights, choose another recipient or impersonate the actual service role.
        await checked(
            owner.client.auth.updateUser({
                data: {role: "service_role", user_id: administrator.id},
            }),
            "Set deliberately untrusted fixture metadata",
        );
        for (const client of [owner.client, administrator.client]) {
            for (const [name, args] of [
                ["lease_notification_emails", {p_limit: 1}],
                ["refresh_notification_reminders", {p_limit: 1}],
                [
                    "prepare_notification_email",
                    {p_id: randomUUID(), p_lease_token: randomUUID()},
                ],
                [
                    "finish_notification_email",
                    {
                        p_id: randomUUID(),
                        p_lease_token: randomUUID(),
                        p_outcome: "accepted",
                    },
                ],
            ]) {
                const denied = await client.rpc(name, args);
                assert.equal(
                    denied.error?.code,
                    "42501",
                    `${name} must be service-role only`,
                );
                assert.equal(denied.data, null);
            }
        }
        const anonymous = createClient(url, process.env.SUPABASE_ANON_KEY, {
            auth: {persistSession: false, autoRefreshToken: false},
        });
        assert.equal(
            (await anonymous.rpc("delivery_preferences")).error?.code,
            "42501",
        );
        assert.equal(
            (await anonymous.rpc("lease_notification_emails")).error?.code,
            "42501",
        );

        await save(owner.client, {quiet_start: null, quiet_end: null});
        const notification = randomUUID();
        await checked(
            service.from("notifications").insert({
                id: notification,
                user_id: owner.id,
                kind: "claim_cancelled",
                resource_id: randomUUID(),
            }),
            "Insert fictional committed cancellation receipt",
        );
        const outboxId = await sql(
            `select id
             from private.notification_email_outbox
             where notification_id = ${q(notification)}`,
        );
        assert.match(outboxId, /^[0-9a-f-]{36}$/);
        const leases = await checked(
            service.rpc("lease_notification_emails", {p_limit: 100}),
            "Lease real committed email delivery through REST",
        );
        assert.equal(leases.length, 1);
        assert.equal(leases[0].id, outboxId);
        const lease = leases[0];
        const address = `delivery-updated-${suffix}@example.invalid`;
        await checked(
            service.auth.admin.updateUserById(owner.id, {
                email: address,
                email_confirm: true,
            }),
            "Update fictional current Auth recipient",
        );
        const forged = await checked(
            service.rpc("prepare_notification_email", {
                p_id: lease.id,
                p_lease_token: randomUUID(),
            }),
            "Reject forged worker fencing token",
        );
        assert.equal(forged, null);
        const prepared = await checked(
            service.rpc("prepare_notification_email", {
                p_id: lease.id,
                p_lease_token: lease.lease_token,
            }),
            "Recheck current recipient immediately before SMTP",
        );
        assert.deepEqual(prepared, {
            ...lease,
            recipient: address,
            locale: "de",
            kind: "claim_cancelled",
            message_id: `<luminovia-notification.${lease.id}@luminovia.org>`,
        });
        assert.ok(!("title" in prepared));
        assert.ok(!("body" in prepared));
        const finishPayload = {
            p_id: lease.id,
            p_lease_token: lease.lease_token,
            p_outcome: "accepted",
            p_error_code: null,
        };
        // This records a synthetic protocol outcome only. No SMTP worker or real
        // recipient is contacted by the REST acceptance fixture.
        assert.equal(
            await checked(
                service.rpc("finish_notification_email", finishPayload),
                "Record synthetic accepted outcome",
            ),
            true,
        );
        assert.equal(
            await checked(
                service.rpc("finish_notification_email", finishPayload),
                "Idempotent synthetic completion",
            ),
            true,
        );
        assert.equal(
            await checked(
                service.rpc("finish_notification_email", {
                    ...finishPayload,
                    p_outcome: "retry",
                }),
                "Do not reopen accepted deliveries",
            ),
            false,
        );
        assert.deepEqual(
            await checked(
                service.rpc("lease_notification_emails"),
                "Accepted occurrence cannot be leased twice",
            ),
            [],
        );

        const cancelled = randomUUID();
        await checked(
            service.from("notifications").insert({
                id: cancelled,
                user_id: owner.id,
                kind: "claim_cancelled",
                resource_id: randomUUID(),
            }),
            "Insert second scoped delivery",
        );
        const pending = await checked(
            service.rpc("lease_notification_emails"),
            "Lease second scoped delivery",
        );
        assert.equal(pending.length, 1);
        await save(owner.client, {email_enabled: false});
        assert.equal(
            await checked(
                service.rpc("prepare_notification_email", {
                    p_id: pending[0].id,
                    p_lease_token: pending[0].lease_token,
                }),
                "Recheck opt-out after leasing",
            ),
            null,
        );
        assert.equal(
            await sql(
                `select state from private.notification_email_outbox where id=${q(pending[0].id)}`,
            ),
            "suppressed",
        );
        await checked(
            service.from("profiles").update({active: false}).eq("id", peer.id),
            "Suspend only owned fictional peer",
        );
        assert.equal(
            (await peer.client.rpc("delivery_preferences")).error?.code,
            "42501",
        );
        assert.equal(
            (
                await peer.client.rpc("save_delivery_preferences", {
                    p_payload: payload,
                    p_expected_version: 1,
                })
            ).error?.code,
            "42501",
        );
        console.log(
            "PASS actual Auth/REST email channel defaults/identity, CAS, quiet-hour validation, untrusted-metadata/admin/anonymous worker denial, committed outbox/current-recipient fencing, minimal payload, idempotent synthetic outcome and opt-out/suspension. No SMTP mail sent.",
        );
    },
);