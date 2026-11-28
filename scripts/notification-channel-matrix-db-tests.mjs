/** Real PostgreSQL upgrade, scoped options and independent delivery gates. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

const categoryNames = [
    "chat", "forum", "job_updates", "assignments", "courses", "events", "invoices",
    "company_orders", "reminders", "announcements", "other",
];
const all = (names) => Object.fromEntries(names.map((name) => [name, true]));
const defaults = {
    email: all(categoryNames),
    push: all(categoryNames.filter((name) => name !== "company_orders")),
};
const json = (value) => q(JSON.stringify(value)) + "::jsonb";
const denial = /42501/;

await withTestDatabase("notification_channel_matrix", async ({sql, actor}) => {
    const [lecturer, administrator, historical, afterEmailOff, afterPushOff, firstOffer, companyOrder, other] =
        Array.from({length: 8}, randomUUID);
    const own = (id, call) => actor(id, `select public.${call}`).then(JSON.parse);
    const read = (id) => own(id, "notification_channel_preferences()");
    const save = (id, channels, version) =>
        own(id, `save_notification_channel_preferences(${json(channels)},${version})`);
    const service = (call) => sql(
        `begin;set local role service_role;select coalesce(to_jsonb(public.${call}),'null'::jsonb);commit;`,
    ).then(JSON.parse);
    const notify = (id, resource, kind) => sql(`
        insert into public.notifications(user_id,kind,resource_id)
        values (${q(id)},${q(kind)},${q(resource)}) returning id
    `);
    const queued = (channel, id) => sql(`
        select coalesce(jsonb_agg(jsonb_build_object('id',id,'state',state)), '[]'::jsonb)
        from private.notification_${channel}_outbox where notification_id = ${q(id)}
    `).then(JSON.parse);
    const lease = (channel, id) => service(
        channel === "email" ? "lease_notification_emails(20)" : "lease_notification_push(20)",
    ).then((items) => items.find((item) => item.id === id));
    const prepare = (channel, row) =>
        service(`prepare_notification_${channel}(${q(row.id)},${q(row.lease_token)})`);

    await sql(`
        insert into auth.users(id,email,email_confirmed_at)
        values (${q(lecturer)},${q(lecturer + "@example.invalid")},now()),
          (${q(administrator)},${q(administrator + "@example.invalid")},now());
        insert into public.user_roles(user_id,role)
        values (${q(lecturer)},'lecturer'),(${q(administrator)},'admin');
        update private.push_configuration set enabled = true;
        insert into private.push_subscriptions(user_id,endpoint,p256dh,auth_secret,device_token,label)
        values (${q(lecturer)},'https://fcm.googleapis.com/fixture/matrix','fixture','fixture',
          gen_random_uuid(),'Fictional device');
    `);
    const historyId = await notify(lecturer, historical, "claim_confirmed");
    const [legacyEmail] = await queued("email", historyId);
    const [legacyPush] = await queued("push", historyId);
    assert.equal(legacyEmail.state, "pending");
    assert.equal(legacyPush.state, "pending");

    await sql(await readFile(new URL(
        "../supabase/migrations/20261128124200_notification_channel_matrix.sql", import.meta.url,
    ), "utf8"));
    assert.deepEqual(await read(lecturer), {version: 0, channels: defaults});
    assert.deepEqual(await queued("email", historyId), [legacyEmail]);
    assert.deepEqual(await queued("push", historyId), [legacyPush]);

    await assert.rejects(sql("begin;set local role anon;select public.notification_channel_preferences();rollback;"), denial);
    await assert.rejects(sql("begin;set local role service_role;select public.notification_channel_preferences();rollback;"), denial);
    await assert.rejects(actor(lecturer, "select delivery_channels from private.notification_preferences"), denial);
    await assert.rejects(actor(lecturer, `
        select private.notification_channel_selected(${q(administrator)},'claim_confirmed','email')
    `), denial);
    assert.equal(await sql(`
        select prosecdef from pg_proc where oid = 'public.notification_channel_preferences()'::regprocedure
    `), "f");

    for (const invalid of [
        null,
        {...defaults, user_id: administrator},
        {email: defaults.email, push: ["chat"]},
        {email: {...defaults.email, chat: "true"}, push: defaults.push},
        {email: defaults.email, push: {...defaults.push, company_orders: true}},
        {email: {...defaults.email, made_up: true}, push: defaults.push},
        {email: {...defaults.email, other: null}, push: defaults.push},
    ]) {
        await assert.rejects(save(lecturer, invalid, 0), /22023/);
    }
    await assert.rejects(save(lecturer, defaults, -1), /22023/);
    assert.equal((await read(lecturer)).version, 0);

    const emailOff = {
        email: {...defaults.email, assignments: false, job_updates: false, company_orders: false, other: false},
        push: defaults.push,
    };
    const leasedEmail = await lease("email", legacyEmail.id);
    const leasedPush = await lease("push", legacyPush.id);
    assert.ok(leasedEmail && leasedPush);
    assert.deepEqual(await save(lecturer, emailOff, 0), {version: 1, channels: emailOff});
    await assert.rejects(save(lecturer, defaults, 0), /PT409/);
    assert.equal(await prepare("email", leasedEmail), null);
    assert.equal((await queued("email", historyId))[0].state, "suppressed");
    assert.ok((await prepare("push", leasedPush)).subscription);

    const pushOnlyId = await notify(lecturer, afterEmailOff, "claim_cancelled");
    assert.deepEqual(await queued("email", pushOnlyId), []);
    const [pushOnly] = await queued("push", pushOnlyId);
    assert.equal(pushOnly.state, "pending");
    const inbox = await own(lecturer, "notification_inbox()");
    assert.ok(inbox.items.some((item) => item.id === pushOnlyId));

    // Specialized external producers write the same outboxes as regular events.
    // Direct inserts here prove the common gate covers a producer's write.
    for (const [resource, kind] of [
        [firstOffer, "course_offer_published"],
        [companyOrder, "customer_order_submitted"],
        [other, "fixture_future_deliverable_kind"],
    ]) {
        const notice = await notify(lecturer, resource, kind);
        await sql(`
            insert into private.notification_email_outbox(notification_id,occurrence_at)
            select id,created_at from public.notifications where id = ${q(notice)}
            on conflict do nothing
        `);
        assert.deepEqual(await queued("email", notice), [], kind);
    }

    const legacy = await own(lecturer, "notification_preferences()");
    const {version: legacyVersion, ...legacyFields} = legacy;
    await own(lecturer, `save_notification_preferences(${json({...legacyFields, forum: false})},${legacyVersion})`);
    assert.deepEqual(await read(lecturer), {version: 1, channels: emailOff});
    assert.deepEqual(await read(administrator), {version: 0, channels: defaults});

    const leasedPushOnly = await lease("push", pushOnly.id);
    assert.ok(leasedPushOnly);
    const pushOff = {email: defaults.email, push: {...defaults.push, assignments: false}};
    assert.deepEqual(await save(lecturer, pushOff, 1), {version: 2, channels: pushOff});
    assert.equal(await prepare("push", leasedPushOnly), null);
    assert.equal((await queued("push", pushOnlyId))[0].state, "suppressed");
    assert.deepEqual(await queued("email", pushOnlyId), []);

    const emailOnlyId = await notify(lecturer, afterPushOff, "claim_confirmed");
    assert.deepEqual(await queued("push", emailOnlyId), []);
    const [emailOnly] = await queued("email", emailOnlyId);
    const leasedEmailOnly = await lease("email", emailOnly.id);
    assert.equal((await prepare("email", leasedEmailOnly)).recipient, lecturer + "@example.invalid");

    await sql(`update public.profiles set active=false where id=${q(lecturer)}`);
    await assert.rejects(read(lecturer), denial);
    await assert.rejects(save(lecturer, defaults, 2), denial);
    console.log("PASS Notification channel matrix upgrade, ACL, CAS, legacy writes, enqueue, and independent mail/push opt-outs.");
}, {migrationsThrough: "20261128124100"});
