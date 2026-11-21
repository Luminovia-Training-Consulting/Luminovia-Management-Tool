import assert from "node:assert/strict";
import {createHash, randomBytes, randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";
import {assertLmsResponse as assertRpcResponse} from "./testing/premium-lms-contract.mjs";

await withTestDatabase("calendar_subscription_test", async ({sql, actor}) => {
    const [owner, peer, admin] = Array.from({length: 3}, randomUUID);
    const token = () => randomBytes(32).toString("hex"),
        hash = (value) => createHash("sha256").update(value).digest("hex");
    const own = (id, name, args = []) =>
        actor(
            id,
            `select coalesce(to_jsonb(public.${name}(${args.join(",")})),'null'::jsonb)`,
        ).then(JSON.parse);
    const service = (name, args = []) =>
        sql(
            `begin;set local role service_role;select coalesce(to_jsonb(public.${name}(${args.join(",")})),'null'::jsonb);commit;`,
        ).then(JSON.parse);
    await sql(
        `insert into auth.users(id,email) values(${q(owner)},'subscription-owner@example.invalid'),(${q(peer)},'subscription-peer@example.invalid'),(${q(admin)},'subscription-admin@example.invalid');insert into public.user_roles(user_id,role) values(${q(owner)},'lecturer'),(${q(peer)},'lecturer'),(${q(admin)},'admin')`,
    );
    const job = randomUUID(),
        claim = randomUUID(),
        assignment = randomUUID(),
        privateEvent = randomUUID();
    await sql(
        `insert into public.jobs(id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms) values(${q(job)},'Fictional teaching day','Fictional academy','online','filled',100,'EUR','fixed_total',100,'Fictional terms');insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version) values(${q(claim)},${q(job)},${q(owner)},${q(randomUUID())},100,'EUR','fixed_total',100,'Fictional terms',1);insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at) values(${q(assignment)},${q(claim)},${q(owner)},now()+interval '2 days',now()+interval '2 days 1 hour');insert into public.personal_events(id,user_id,title,starts_at,ends_at) values(${q(privateEvent)},${q(owner)},'PRIVATE OPT-IN EVENT',now()+interval '3 days',now()+interval '3 days 1 hour');insert into public.personal_events(user_id,title,starts_at,ends_at) values(${q(peer)},'FOREIGN EVENT',now()+interval '4 days',now()+interval '4 days 1 hour');`,
    );
    const secret = token(),
        request = randomUUID();
    const createArgs = [
        "null",
        q("Fictional calendar"),
        "false",
        q(secret),
        0,
        q(request),
    ];
    const created = await own(owner, "save_calendar_subscription", createArgs);
    assertRpcResponse("save_calendar_subscription", created);
    assertRpcResponse("my_calendar_subscriptions", await own(owner, "my_calendar_subscriptions"));
    assert.equal(created.include_private, false);
    assert.deepEqual(await own(peer, "my_calendar_subscriptions"), []);
    assert.deepEqual(await own(admin, "my_calendar_subscriptions"), []);
    assert.ok(
        !JSON.stringify(await own(owner, "my_calendar_subscriptions")).includes(
            secret,
        ),
    );
    assert.equal(
        await sql(
            `select token_hash from private.calendar_subscriptions where id=${q(created.id)}`,
        ),
        hash(secret),
    );
    assert.deepEqual(
        await own(owner, "save_calendar_subscription", createArgs),
        created,
    );
    await assert.rejects(
        own(owner, "save_calendar_subscription", [
            ...createArgs.slice(0, 3),
            q(token()),
            0,
            q(request),
        ]),
        /22023/,
    );
    await assert.rejects(
        actor(admin, "select * from private.calendar_subscriptions", "aal1"),
        /permission denied/,
    );
    await assert.rejects(
        own(peer, "revoke_calendar_subscription", [q(created.id), created.version]),
        /42501/,
    );
    await assert.rejects(
        own(owner, "calendar_subscription_snapshot", [q(hash(secret))]),
        /permission denied/,
    );
    const snapshot = await service("calendar_subscription_snapshot", [
        q(hash(secret)),
    ]);
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0].id, assignment);
    assert.ok(!JSON.stringify(snapshot).includes("PRIVATE OPT-IN EVENT"));
    assert.equal(
        await service("calendar_subscription_snapshot", [q(hash(token()))]),
        null,
    );
    const renewedSecret = token(),
        rotation = randomUUID(),
        rotationArgs = [
            q(created.id),
            q("Fictional private calendar"),
            "true",
            q(renewedSecret),
            created.version,
            q(rotation),
        ];
    const renewed = await own(owner, "save_calendar_subscription", rotationArgs);
    assert.equal(renewed.version, 2);
    assert.equal(
        await service("recheck_calendar_subscription", [q(hash(secret))]),
        false,
    );
    assert.equal(
        (await service("calendar_subscription_snapshot", [q(hash(renewedSecret))]))
            .items.length,
        2,
    );
    assert.ok(
        !JSON.stringify(
            await service("calendar_subscription_snapshot", [q(hash(renewedSecret))]),
        ).includes("FOREIGN EVENT"),
    );
    assert.deepEqual(
        await own(owner, "save_calendar_subscription", rotationArgs),
        renewed,
        "A confirmed rotation retry cannot mint another version or lose its URL",
    );
    await assert.rejects(
        own(owner, "save_calendar_subscription", [
            q(created.id),
            q("Stale"),
            "false",
            q(token()),
            1,
            q(randomUUID()),
        ]),
        /PT409/,
    );
    assert.equal(
        await own(owner, "revoke_calendar_subscription", [
            q(created.id),
            renewed.version,
        ]),
        true,
    );
    await assert.rejects(
        own(owner, "revoke_calendar_subscription", [q(created.id), renewed.version]),
        /PT409/,
    );
    assert.equal(
        await service("recheck_calendar_subscription", [q(hash(renewedSecret))]),
        false,
    );
    assert.equal(
        await service("calendar_subscription_snapshot", [q(hash(renewedSecret))]),
        null,
    );
    const next = token(),
        nextItem = await own(owner, "save_calendar_subscription", [
            "null",
            q("Suspension test"),
            "false",
            q(next),
            0,
            q(randomUUID()),
        ]);
    await sql(`update public.profiles set active=false where id=${q(owner)}`);
    assert.equal(
        await service("calendar_subscription_snapshot", [q(hash(next))]),
        null,
    );
    await assert.rejects(own(owner, "my_calendar_subscriptions"), /42501/);
    await sql(
        `update public.profiles set active=true where id=${q(owner)};update private.calendar_subscriptions set expires_at=now()-interval '1 minute' where id=${q(nextItem.id)}`,
    );
    assert.equal(
        await service("calendar_subscription_snapshot", [q(hash(next))]),
        null,
    );
    console.log(
        "PASS calendar subscription hash-only storage/identity, exact retries, own private opt-in, foreign isolation, service-only snapshot, stable rotation, old-token revocation, CAS, explicit revocation, suspension and expiry",
    );
});
