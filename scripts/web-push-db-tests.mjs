import assert from "node:assert/strict";
import {createECDH, randomBytes, randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";
import {assertLmsResponse} from "./testing/premium-lms-contract.mjs";

const key = () => {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    return ecdh.getPublicKey().toString("base64url");
};
await withTestDatabase("web_push_test", async ({sql, actor}) => {
    const owner = randomUUID(),
        peer = randomUUID(),
        admin = randomUUID();
    await sql(
        `insert into auth.users(id, email)
         values (${q(owner)}, 'push-owner@example.invalid'),
                (${q(peer)}, 'push-peer@example.invalid'),
                (${q(admin)}, 'push-admin@example.invalid');
        insert into public.user_roles(user_id, role)
        values (${q(owner)}, 'lecturer'),
               (${q(peer)}, 'lecturer'),
               (${q(admin)}, 'admin')`,
    );
    const service = (name, args = "") =>
        sql(
            `begin;set local role service_role;select coalesce(to_jsonb(public.${name}(${args})),'null'::jsonb);commit;`,
        ).then(JSON.parse);
    const own = async (id, name, args = "") => {
        const result = JSON.parse(await actor(id,
            `select coalesce(to_jsonb(public.${name}(${args})),'null'::jsonb)`,
        ));
        assertLmsResponse(name, result);
        return result;
    };
    const subscription = {
        endpoint: "https://fcm.googleapis.com/fcm/send/fictional-provider-token",
        keys: {p256dh: key(), auth: randomBytes(16).toString("base64url")},
    };
    const register = (id = owner, sub = subscription) =>
        own(
            id,
            "register_push_device",
            `${q(JSON.stringify(sub))}::jsonb,${q(randomUUID())},'Fictional device'`,
        );
    assert.deepEqual(await own(owner, "my_push_devices"), {
        enabled: false,
        public_key: null,
        devices: [],
    });
    await assert.rejects(register(), /55000/);
    await service("configure_web_push", `${q(key())},true`);
    await assert.rejects(
        actor(owner, `select public.configure_web_push(${q(key())},true)`),
        /permission denied/,
    );
    for (const endpoint of [
        "http://127.0.0.1/private",
        "https://fcm.googleapis.com.evil.invalid/token",
        "https://user:pass@fcm.googleapis.com/token",
        "https://fcm.googleapis.com:8443/token",
        "https://fcm.googleapis.com/token?secret=x",
    ]) {
        await assert.rejects(
            register(owner, {...subscription, endpoint}),
            /22023/,
        );
    }
    const id = await register();
    assert.equal((await own(owner, "my_push_devices")).devices.length, 1);
    await assert.rejects(register(peer), /42501/);
    assert.deepEqual((await own(admin, "my_push_devices")).devices, []);
    assert.equal(await own(peer, "remove_push_device", q(id)), false);
    await assert.rejects(
        actor(admin, "select * from private.push_subscriptions"),
        /permission denied/,
    );
    await assert.rejects(
        actor(owner, "select public.lease_notification_push(1)"),
        /permission denied/,
    );
    const notice = randomUUID();
    await sql(`update public.profiles set locale='de-CH' where id=${q(owner)}`);
    await sql(
        `begin;insert into public.notifications(id,user_id,kind,resource_id) values(${q(notice)},${q(owner)},'claim_cancelled',${q(randomUUID())});rollback`,
    );
    assert.deepEqual(await service("lease_notification_push"), []);
    await sql(
        `insert into public.notifications(id, user_id, kind, resource_id)
         values (${q(notice)}, ${q(owner)}, 'claim_cancelled', ${q(randomUUID())})`,
    );
    const leases = await Promise.all(
        Array.from({length: 50}, () => service("lease_notification_push", "1")),
    );
    assert.equal(leases.flat().length, 1);
    const lease = leases.flat()[0];
    assert.equal(
        await service(
            "prepare_notification_push",
            `${q(lease.id)},${q(randomUUID())}`,
        ),
        null,
    );
    const row = await service(
        "prepare_notification_push",
        `${q(lease.id)},${q(lease.lease_token)}`,
    );
    assert.equal(row.subscription.endpoint, subscription.endpoint);
    assert.equal(row.locale, "de");
    assert.equal("title" in row, false);
    assert.equal("body" in row, false);
    assert.equal(
        await service(
            "finish_notification_push",
            `${q(lease.id)},${q(lease.lease_token)},'accepted'`,
        ),
        true,
    );
    assert.equal(
        await service(
            "finish_notification_push",
            `${q(lease.id)},${q(lease.lease_token)},'accepted'`,
        ),
        true,
    );
    assert.equal(
        await service(
            "finish_notification_push",
            `${q(lease.id)},${q(lease.lease_token)},'retry'`,
        ),
        false,
    );
    const second = randomUUID();
    await sql(
        `insert into public.notifications(user_id, kind, resource_id)
         values (${q(owner)}, 'claim_cancelled', ${q(second)})`,
    );
    const gone = (await service("lease_notification_push"))[0];
    await service(
        "prepare_notification_push",
        `${q(gone.id)},${q(gone.lease_token)}`,
    );
    assert.equal(
        await service(
            "finish_notification_push",
            `${q(gone.id)},${q(gone.lease_token)},'gone','subscription_gone'`,
        ),
        true,
    );
    assert.deepEqual((await own(owner, "my_push_devices")).devices, []);
    await register();
    await sql(
        `insert into public.notifications(user_id, kind, resource_id)
         values (${q(owner)}, 'claim_cancelled', ${q(randomUUID())})`,
    );
    const revoked = (await service("lease_notification_push"))[0];
    await own(owner, "remove_push_device", q(id));
    assert.equal(
        await service(
            "prepare_notification_push",
            `${q(revoked.id)},${q(revoked.lease_token)}`,
        ),
        null,
    );
    console.log(
        "PASS push defaults/identity/configuration, endpoints/key validation, foreign/admin isolation, rollback,50worker race, minimal payload, fencing/idempotency,410revocation and queued opt-out",
    );
});
