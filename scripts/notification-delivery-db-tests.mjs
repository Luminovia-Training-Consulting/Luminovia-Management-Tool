/** Real disposable PostgreSQL: committed email queue, ownership and SMTP fencing. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase(
    "notification_delivery_test",
    async ({sql, actor}) => {
        const [teacher, peer, admin] = Array.from({length: 3}, randomUUID);
        const json = (value) => `${q(JSON.stringify(value))}::jsonb`;
        const userRpc = async (id, name, args = []) =>
            JSON.parse(await actor(id, `select public.${name}(${args.join(",")})`));
        const service = async (name, args = []) =>
            JSON.parse(
                await sql(
                    `begin;set local role service_role;select coalesce(to_jsonb(public.${name}(${args.join(",")})),'null'::jsonb);commit;`,
                ),
            );
        const state = async (id) =>
            JSON.parse(
                await sql(
                    `select to_jsonb(o)
                     from private.notification_email_outbox o
                     where id = ${q(id)}`,
                ),
            );
        let checks = 0;
        const check = async (title, run) => {
            await run();
            console.log(`PASS ${title}`);
            checks++;
        };
        await sql(`insert into auth.users(id, email)
                   values ${[teacher, peer, admin].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
      insert into public.user_roles(user_id,role) values(${q(teacher)},'lecturer'),(${q(peer)},'lecturer'),(${q(admin)},'admin');
      insert into public.notifications(user_id,kind,resource_id) values(${q(teacher)},'claim_cancelled',${q(randomUUID())});`);
        await sql(
            await readFile(
                new URL(
                    "../supabase/migrations/20261116091007_notification_email_outbox.sql",
                    import.meta.url,
                ),
                "utf8",
            ),
        );
        const preferences = {
            email_enabled: true,
            quiet_start: null,
            quiet_end: null,
            time_zone: "Europe/Berlin",
        };
        const save = async (id, updates = {}) => {
            const {version, ...current} = await userRpc(id, "delivery_preferences");
            return userRpc(id, "save_delivery_preferences", [
                json({...current, ...updates}),
                version,
            ]);
        };
        const notice = async (kind = "claim_cancelled", id = teacher) => {
            const key = randomUUID();
            await sql(
                `insert into public.notifications(id,user_id,kind,resource_id) values(${q(key)},${q(id)},${q(kind)},${q(randomUUID())})`,
            );
            return key;
        };
        const clean = () => sql("truncate private.notification_email_outbox");
        const leaseOne = async () => {
            const rows = await service("lease_notification_emails", [1]);
            assert.equal(rows.length, 1);
            return rows[0];
        };
        const prepare = (lease) =>
            service("prepare_notification_email", [
                q(lease.id),
                q(lease.lease_token),
            ]);
        const finish = (lease, result, code = null) =>
            service("finish_notification_email", [
                q(lease.id),
                q(lease.lease_token),
                q(result),
                code === null ? "null" : q(code),
            ]);

        await check(
            "Email defaults off; existing inbox history is never replayed",
            async () => {
                assert.equal(
                    await sql("select count(*) from private.notification_email_outbox"),
                    "0",
                );
                assert.deepEqual(await userRpc(teacher, "delivery_preferences"), {
                    ...preferences,
                    email_enabled: false,
                    version: 1,
                });
                await notice();
                assert.deepEqual(await service("lease_notification_emails"), []);
                await save(teacher, preferences);
                assert.deepEqual(await service("lease_notification_emails"), []);
                assert.equal(
                    (await userRpc(peer, "delivery_preferences")).email_enabled,
                    false,
                );
            },
        );
        await check(
            "Own preferences use CAS; forged actors and fields are rejected",
            async () => {
                const current = await userRpc(teacher, "delivery_preferences");
                const results = await Promise.allSettled([
                    userRpc(teacher, "save_delivery_preferences", [
                        json(preferences),
                        current.version,
                    ]),
                    userRpc(teacher, "save_delivery_preferences", [
                        json(preferences),
                        current.version,
                    ]),
                ]);
                assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
                assert.match(
                    results.find((r) => r.status === "rejected").reason.message,
                    /40001/,
                );
                await assert.rejects(
                    userRpc(teacher, "save_delivery_preferences", [
                        json({...preferences, user_id: peer}),
                        current.version + 1,
                    ]),
                    /22023/,
                );
                assert.equal(
                    (await userRpc(admin, "delivery_preferences")).email_enabled,
                    false,
                );
                for (const table of [
                    "delivery_preferences",
                    "notification_email_outbox",
                ])
                    await assert.rejects(
                        actor(admin, `select * from private.${table}`),
                        /permission denied/,
                    );
            },
        );
        await check(
            "Quiet-hour pair, exact time and IANA zone validation fail closed",
            async () => {
                for (const invalid of [
                    {quiet_start: "22:00"},
                    {quiet_start: "22:00", quiet_end: "22:00"},
                    {quiet_start: "24:00", quiet_end: "06:00"},
                    {quiet_start: "22:00:01", quiet_end: "06:00"},
                    {time_zone: "Invalid/Unknown"},
                    {email_enabled: "true"},
                ]) {
                    const current = await userRpc(teacher, "delivery_preferences");
                    await assert.rejects(
                        userRpc(teacher, "save_delivery_preferences", [
                            json({...preferences, ...invalid}),
                            current.version,
                        ]),
                        /22023/,
                    );
                }
            },
        );
        await check(
            "A rolled-back business event leaves neither notification nor mail",
            async () => {
                await clean();
                const id = randomUUID();
                await sql(
                    `begin;insert into public.notifications(id,user_id,kind,resource_id) values(${q(id)},${q(teacher)},'claim_cancelled',${q(randomUUID())});rollback;`,
                );
                assert.equal(
                    await sql(
                        `select count(*) from public.notifications where id=${q(id)}`,
                    ),
                    "0",
                );
                assert.deepEqual(await service("lease_notification_emails"), []);
            },
        );
        await check(
            "A committed event queues once; read-state edits do not resend",
            async () => {
                await clean();
                const id = await notice();
                await actor(
                    teacher,
                    `update public.notifications set read_at=now() where id=${q(id)}`,
                );
                assert.equal(
                    await sql("select count(*) from private.notification_email_outbox"),
                    "1",
                );
                await sql(
                    `update public.notifications set created_at=created_at+interval '1 second' where id=${q(id)}`,
                );
                assert.equal(
                    await sql("select count(*) from private.notification_email_outbox"),
                    "2",
                );
                await assert.rejects(
                    actor(
                        teacher,
                        `update public.notifications set created_at=now() where id=${q(id)}`,
                    ),
                    /permission denied/,
                );
            },
        );
        await check(
            "Service-only worker API rejects authenticated, anon and forged JWT role",
            async () => {
                for (const [fn, args] of [
                    ["lease_notification_emails", "1"],
                    ["refresh_notification_reminders", "1"],
                    [
                        "prepare_notification_email",
                        `${q(randomUUID())},${q(randomUUID())}`,
                    ],
                    [
                        "finish_notification_email",
                        `${q(randomUUID())},${q(randomUUID())},'accepted',null`,
                    ],
                ]) {
                    await assert.rejects(
                        actor(admin, `select public.${fn}(${args})`, "aal1"),
                        /permission denied/,
                    );
                    await assert.rejects(
                        sql(
                            `begin;set local role anon;select public.${fn}(${args});commit;`,
                        ),
                        /permission denied/,
                    );
                    await assert.rejects(
                        sql(
                            `begin;set local role authenticated;set local request.jwt.claims='{"role":"service_role"}';select public.${fn}(${args});commit;`,
                        ),
                        /permission denied/,
                    );
                }
                await assert.rejects(
                    sql("select private.lease_notification_emails(1)"),
                    /42501/,
                );
                await assert.rejects(
                    service("lease_notification_emails", [101]),
                    /22023/,
                );
                await assert.rejects(
                    service("lease_notification_emails", ["null"]),
                    /22023/,
                );
                await assert.rejects(
                    actor(
                        teacher,
                        `select private.email_category_enabled(${q(teacher)},'claim_cancelled')`,
                    ),
                    /permission denied/,
                );
            },
        );
        await check(
            "Concurrent workers lease each of 50 occurrences exactly once",
            async () => {
                await clean();
                await sql(
                    `insert into public.notifications(user_id,kind,resource_id) select ${q(teacher)}::uuid,'claim_cancelled',gen_random_uuid() from generate_series(1,50)`,
                );
                const batches = await Promise.all(
                    Array.from({length: 10}, () =>
                        service("lease_notification_emails", [5]),
                    ),
                );
                const rows = batches.flat();
                assert.equal(rows.length, 50);
                assert.equal(new Set(rows.map((row) => row.id)).size, 50);
                assert.equal(new Set(rows.map((row) => row.lease_token)).size, 50);
                assert.deepEqual(await service("lease_notification_emails"), []);
            },
        );
        await check(
            "Prepare returns current address and generic locale payload with stable Message-ID",
            async () => {
                await clean();
                await notice();
                const lease = await leaseOne();
                await sql(
                    `update auth.users set email='changed@example.invalid' where id=${q(teacher)};update public.profiles set locale='en' where id=${q(teacher)}`,
                );
                assert.equal(
                    await prepare({...lease, lease_token: randomUUID()}),
                    null,
                );
                const prepared = await prepare(lease);
                assert.deepEqual(prepared, {
                    ...lease,
                    recipient: "changed@example.invalid",
                    locale: "en",
                    kind: "claim_cancelled",
                    message_id: `<luminovia-notification.${lease.id}@luminovia.org>`,
                });
                assert.equal((await state(lease.id)).state, "sending");
                assert.equal(await prepare(lease), null);
                assert.equal(await finish(lease, "accepted"), true);
                assert.equal(await finish(lease, "accepted"), true);
                assert.equal(await finish(lease, "retry"), false);
                assert.equal((await state(lease.id)).state, "accepted");
                assert.deepEqual(await service("lease_notification_emails"), []);
            },
        );
        await check(
            "Opt-out, suspension, invalid recipient and changed categories suppress before SMTP",
            async () => {
                for (const change of ["optout", "inactive", "invalid", "category"]) {
                    await clean();
                    await notice(
                        change === "category" ? "chat_message" : "claim_cancelled",
                    );
                    const lease = await leaseOne();
                    if (change === "optout")
                        await save(teacher, {email_enabled: false});
                    if (change === "inactive")
                        await sql(
                            `update public.profiles set active=false where id=${q(teacher)}`,
                        );
                    if (change === "invalid")
                        await sql(
                            `update auth.users set email=E'bad\\nheader@example.invalid' where id=${q(teacher)}`,
                        );
                    if (change === "category")
                        await sql(
                            `update private.notification_preferences set chat=false where user_id=${q(teacher)}`,
                        );
                    assert.equal(await prepare(lease), null);
                    assert.equal((await state(lease.id)).state, "suppressed");
                    await sql(
                        `update public.profiles set active=true where id=${q(teacher)};update auth.users set email='safe@example.invalid' where id=${q(teacher)};update private.notification_preferences set chat=true where user_id=${q(teacher)}`,
                    );
                    await save(teacher, preferences);
                }
            },
        );
        await check(
            "Quiet intervals handle same-day, midnight, Berlin DST and Brisbane instants",
            async () => {
                const quiet = (zone, start, end, now) =>
                    sql(
                        `select private.email_quiet_until(${q(zone)},${q(start)}::time,${q(end)}::time,${q(now)}::timestamptz)::text`,
                    );
                assert.equal(
                    await quiet(
                        "Europe/Berlin",
                        "22:00",
                        "07:00",
                        "2026-03-28T22:00:00Z",
                    ),
                    "2026-03-29 05:00:00+00",
                );
                assert.equal(
                    await quiet(
                        "Europe/Berlin",
                        "22:00",
                        "07:00",
                        "2026-10-24T22:00:00Z",
                    ),
                    "2026-10-25 06:00:00+00",
                );
                assert.equal(
                    await quiet(
                        "Australia/Brisbane",
                        "22:00",
                        "07:00",
                        "2026-03-28T13:00:00Z",
                    ),
                    "2026-03-28 21:00:00+00",
                );
                assert.equal(
                    await quiet(
                        "Australia/Brisbane",
                        "09:00",
                        "11:00",
                        "2026-03-28T00:00:00Z",
                    ),
                    "2026-03-28 01:00:00+00",
                );
                assert.equal(
                    await quiet(
                        "Europe/Berlin",
                        "22:00",
                        "07:00",
                        "2026-03-29T05:00:00Z",
                    ),
                    "",
                );
            },
        );
        await check(
            "Quiet time defers the occurrence without consuming delivery attempts",
            async () => {
                await clean();
                await notice();
                const lease = await leaseOne();
                await sql(
                    `update private.delivery_preferences set time_zone='UTC',quiet_start=(date_trunc('hour',now() at time zone 'UTC')-interval '1 hour')::time,quiet_end=(date_trunc('hour',now() at time zone 'UTC')+interval '1 hour')::time where user_id=${q(teacher)}`,
                );
                assert.equal(await prepare(lease), null);
                const row = await state(lease.id);
                assert.equal(row.state, "pending");
                assert.equal(row.attempts, 0);
                assert.equal(row.error_code, "quiet_hours");
                assert.ok(new Date(row.available_at) > new Date());
                assert.deepEqual(await service("lease_notification_emails"), []);
                await save(teacher, preferences);
            },
        );
        await check(
            "Expired pre-send lease recovers with a new fencing token",
            async () => {
                await clean();
                await notice();
                const stale = await leaseOne();
                await sql(
                    `update private.notification_email_outbox set lease_until=now()-interval '1 second' where id=${q(stale.id)}`,
                );
                const current = await leaseOne();
                assert.equal(stale.id, current.id);
                assert.notEqual(stale.lease_token, current.lease_token);
                assert.equal(await prepare(stale), null);
                assert.equal(await finish(stale, "accepted"), false);
                assert.ok(await prepare(current));
                assert.equal(await finish(current, "accepted"), true);
            },
        );
        await check(
            "Expired sending lease becomes uncertain and is never automatically resent",
            async () => {
                await clean();
                await notice();
                const lease = await leaseOne();
                assert.ok(await prepare(lease));
                await sql(
                    `update private.notification_email_outbox set lease_until=now()-interval '1 second' where id=${q(lease.id)}`,
                );
                assert.equal(await finish(lease, "accepted"), false);
                assert.deepEqual(await service("lease_notification_emails"), []);
                assert.equal((await state(lease.id)).state, "uncertain");
                assert.equal(await finish(lease, "retry"), false);
            },
        );
        await check(
            "Safe retries back off, retain Message-ID and stop after five attempts",
            async () => {
                await clean();
                await notice();
                let firstMessage;
                for (let attempt = 1; attempt <= 5; attempt++) {
                    const lease = await leaseOne();
                    const payload = await prepare(lease);
                    firstMessage ??= payload.message_id;
                    assert.equal(payload.message_id, firstMessage);
                    assert.equal(
                        await finish(lease, "retry", "smtp_connect_failed"),
                        true,
                    );
                    assert.equal(
                        await finish(lease, "retry", "smtp_connect_failed"),
                        true,
                    );
                    const row = await state(lease.id);
                    assert.equal(row.attempts, attempt);
                    assert.equal(row.state, attempt === 5 ? "failed" : "pending");
                    assert.deepEqual(await service("lease_notification_emails"), []);
                    if (attempt < 5) {
                        assert.ok(
                            new Date(row.available_at).getTime() > Date.now() + 20000,
                        );
                        await sql(
                            `update private.notification_email_outbox set available_at=now() where id=${q(lease.id)}`,
                        );
                    }
                }
            },
        );
        await check(
            "Explicit uncertainty and permanent rejection are terminal; raw errors are rejected",
            async () => {
                for (const outcome of ["uncertain", "failed"]) {
                    await clean();
                    await notice();
                    const lease = await leaseOne();
                    await prepare(lease);
                    await assert.rejects(
                        finish(
                            lease,
                            outcome,
                            "private smtp error with email@example.invalid",
                        ),
                        /22023/,
                    );
                    assert.equal(await finish(lease, outcome, "smtp_rejected"), true);
                    assert.equal((await state(lease.id)).state, outcome);
                    assert.deepEqual(await service("lease_notification_emails"), []);
                }
            },
        );
        await check(
            "Scheduled reminders generate current opted-in sessions/contracts once, with stale reminders suppressed",
            async () => {
                await clean();
                const dueSession = randomUUID(),
                    dueContract = randomUUID();
                const seedSession = async (id, who, start, released = false) => {
                    const job = randomUUID(),
                        claim = randomUUID();
                    await sql(`insert into public.jobs(id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms) values(${q(job)},'Fictional scheduled reminder','Fictional client','online','filled',100,'EUR','fixed_total',100,'Fictional terms');
          insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version) values(${q(claim)},${q(job)},${q(who)},${q(randomUUID())},100,'EUR','fixed_total',100,'Fictional terms',1);
          insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at,released_at) values(${q(id)},${q(claim)},${q(who)},${start},${start}+interval '1 hour',${released ? "now()" : "null"});`);
                };
                await seedSession(dueSession, teacher, "now()+interval '2 hours'");
                await seedSession(randomUUID(), teacher, "now()+interval '26 hours'");
                await seedSession(
                    randomUUID(),
                    teacher,
                    "now()+interval '4 hours'",
                    true,
                );
                await seedSession(randomUUID(), peer, "now()+interval '2 hours'");
                await sql(`insert into public.contracts(id,user_id,status,effective_from,expires_at,version,title,revoked_at) values
        (${q(dueContract)},${q(teacher)},'active',now()-interval '1 day',now()+interval '29 days',800,'PRIVATE fictional expiring agreement',null),
        (${q(randomUUID())},${q(teacher)},'active',now()-interval '1 day',now()+interval '31 days',801,'Outside horizon',null),
        (${q(randomUUID())},${q(teacher)},'active',now()-interval '1 day',now()+interval '10 days',802,'Revoked agreement',now()),
        (${q(randomUUID())},${q(peer)},'active',now()-interval '1 day',now()+interval '5 days',800,'Peer private agreement',null)`);
                assert.equal(await service("refresh_notification_reminders"), 2);
                assert.equal(await service("refresh_notification_reminders"), 0);
                const queued = JSON.parse(
                    await sql(
                        "select jsonb_agg(n.resource_id order by n.resource_id) from private.notification_email_outbox o join public.notifications n on n.id=o.notification_id",
                    ),
                );
                assert.deepEqual(queued.sort(), [dueSession, dueContract].sort());
                const leases = await service("lease_notification_emails");
                assert.equal(leases.length, 2);
                await sql(
                    `update public.assignment_sessions set released_at=now() where id=${q(dueSession)};update public.contracts set revoked_at=now() where id=${q(dueContract)}`,
                );
                for (const lease of leases) {
                    assert.equal(await prepare(lease), null);
                    assert.equal((await state(lease.id)).state, "suppressed");
                }
                await assert.rejects(
                    service("refresh_notification_reminders", [101]),
                    /22023/,
                );
            },
        );
        await check(
            "Deleted notices and opted-out accounts cannot leave sendable stale deliveries",
            async () => {
                await clean();
                const id = await notice();
                const lease = await leaseOne();
                await sql(`delete from public.notifications where id=${q(id)}`);
                assert.equal(await prepare(lease), null);
                assert.equal(await finish(lease, "accepted"), false);
                assert.deepEqual(await service("lease_notification_emails"), []);
                await sql(
                    `update public.profiles set active=false where id=${q(teacher)}`,
                );
                await assert.rejects(userRpc(teacher, "delivery_preferences"), /42501/);
                await notice();
                assert.deepEqual(await service("lease_notification_emails"), []);
            },
        );
        console.log(`${checks} notification delivery SQL groups passed.`);
    },
    {migrationsThrough: "20261115213550"},
);