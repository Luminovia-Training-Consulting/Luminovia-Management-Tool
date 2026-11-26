import assert from "node:assert/strict";
import {createHash, randomBytes, randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";
import {assertLmsResponse as assertRpcResponse} from "./testing/premium-lms-contract.mjs";

const token = () => randomBytes(32).toString("hex");
const hash = (value) => createHash("sha256").update(value).digest("hex");

async function calendarFixture({sql, actor}) {
    const [owner, peer, admin] = Array.from({length: 3}, randomUUID);
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
        privateEvent = randomUUID(),
        organisation = randomUUID(),
        template = randomUUID(),
        courseRun = randomUUID();
    await sql(
        `insert into public.organisations(id,name) values(${q(organisation)},'Fictional calendar company');insert into public.course_templates(id,title) values(${q(template)},'Fictional calendar course');insert into public.course_runs(id,template_id,organisation_id,published) values(${q(courseRun)},${q(template)},${q(organisation)},true);insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms) values(${q(job)},${q(courseRun)},'Fictional teaching day','Fictional academy','online','filled',100,'EUR','fixed_total',100,'Fictional terms');insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version) values(${q(claim)},${q(job)},${q(owner)},${q(randomUUID())},100,'EUR','fixed_total',100,'Fictional terms',1);insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at) values(${q(assignment)},${q(claim)},${q(owner)},now()+interval '2 days',now()+interval '2 days 1 hour');insert into public.personal_events(id,user_id,title,starts_at,ends_at) values(${q(privateEvent)},${q(owner)},'PRIVATE OPT-IN EVENT',now()+interval '3 days',now()+interval '3 days 1 hour');insert into public.personal_events(user_id,title,starts_at,ends_at) values(${q(peer)},'FOREIGN EVENT',now()+interval '4 days',now()+interval '4 days 1 hour');`,
    );
    return {
        owner, peer, admin, own, service, assignment, privateEvent, organisation, claim,
    };
}

await withTestDatabase("calendar_subscription_test", async ({sql, actor}) => {
    const {
        owner, peer, admin, own, service, assignment, privateEvent, organisation, claim,
    } = await calendarFixture({sql, actor});
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
    await sql(
        `insert into private.company_lecturer_blocks(organisation_id,lecturer_id,blocked,version) values(${q(organisation)},${q(owner)},true,1)`,
    );
    assert.deepEqual(
        (await service("calendar_subscription_snapshot", [q(hash(renewedSecret))]))
            .items.map((item) => item.id),
        [privateEvent],
        "An active company block hides teaching entries but leaves opted-in private events visible",
    );
    await sql(
        `update private.company_lecturer_blocks set blocked=false,version=2 where organisation_id=${q(organisation)} and lecturer_id=${q(owner)}`,
    );
    assert.deepEqual(
        (await service("calendar_subscription_snapshot", [q(hash(renewedSecret))]))
            .items.map((item) => item.id),
        [assignment, privateEvent],
        "Releasing the company block restores the still-authorised teaching entry",
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
    const roleRevocationSecret = token();
    await own(owner, "save_calendar_subscription", [
        "null",
        q("Role revocation fixture"),
        "true",
        q(roleRevocationSecret),
        0,
        q(randomUUID()),
    ]);
    assert.equal(
        await sql(
            `delete from public.user_roles where user_id=${q(owner)} and role='lecturer';select private.lecturer_user(${q(owner)})`,
        ),
        "f",
    );
    const roleRevokedSnapshot = await service("calendar_subscription_snapshot", [
        q(hash(roleRevocationSecret)),
    ]);
    assert.deepEqual(
        roleRevokedSnapshot.items.map((item) => item.id),
        [privateEvent],
        "Role revocation removes teaching entries but retains explicitly opted-in own private events",
    );
    assert.equal(
        await service("recheck_calendar_subscription", [q(hash(roleRevocationSecret))]),
        true,
        "A valid subscription remains usable while its owner account is active",
    );
    assert.equal(
        await sql(`select status from public.job_claims where id=${q(claim)}`),
        "confirmed",
        "Role revocation preserves the accepted claim",
    );
    assert.equal(
        await sql(`select count(*) from public.assignment_sessions where id=${q(assignment)}`),
        "1",
        "Role revocation preserves the assignment session",
    );
    console.log(
        "PASS calendar subscription identity/revocation, private opt-in, company-block filtering, current lecturer-role revocation, stable rotation, CAS, suspension and expiry",
    );
});

await withTestDatabase(
    "calendar_subscription_upgrade",
    async ({sql, actor}) => {
        const {owner, own, service, assignment, privateEvent} =
            await calendarFixture({sql, actor});
        const secret = token();
        const subscription = await own(owner, "save_calendar_subscription", [
            "null",
            q("Fictional pre-upgrade subscription"),
            "true",
            q(secret),
            0,
            q(randomUUID()),
        ]);
        const snapshot = () =>
            service("calendar_subscription_snapshot", [q(hash(secret))]);
        const stored = () =>
            sql(`select to_jsonb(s) from private.calendar_subscriptions s where id=${q(subscription.id)}`);
        const before = await snapshot();
        const storedBefore = await stored();
        assert.deepEqual(before.items.map((item) => item.id), [assignment, privateEvent]);

        const migration = new URL(
            "../supabase/migrations/20261126130000_recheck_lecturer_role_for_calendar_feed.sql",
            import.meta.url,
        );
        await sql(await readFile(migration, "utf8"));

        assert.deepEqual(
            await snapshot(),
            before,
            "The same active token retains its original scope after upgrade",
        );
        for (const schema of ["private", "public"]) {
            const routine = q(`${schema}.calendar_subscription_snapshot(text)`);
            for (const role of ["anon", "authenticated", "service_role"]) {
                assert.equal(
                    await sql(`select has_function_privilege(${q(role)},${routine},'execute')`),
                    role === "service_role" ? "t" : "f",
                    `Snapshot grants remain service-only in ${schema} for ${role}`,
                );
            }
        }
        await sql(`delete from public.user_roles where user_id=${q(owner)} and role='lecturer'`);
        assert.deepEqual((await snapshot()).items.map((item) => item.id), [privateEvent]);
        assert.equal(
            await stored(),
            storedBefore,
            "Neither the upgrade nor the role change rewrites the subscription",
        );
        console.log("PASS calendar subscription forward upgrade preserves the existing token and grants and removes teaching entries after role revocation");
    },
    {migrationsThrough: "20261126124500"},
);
