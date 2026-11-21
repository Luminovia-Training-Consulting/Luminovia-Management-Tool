/** Real PostgreSQL own-only, versioned onboarding progress and denial checks. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";
import {assertLmsResponse} from "./testing/premium-lms-contract.mjs";

await withTestDatabase("welcome_test", async ({sql, actor}) => {
    const first = randomUUID(),
        peer = randomUUID(),
        admin = randomUUID(),
        inactive = randomUUID();
    await sql(
        `insert into auth.users(id,email) values ${[first, peer, admin, inactive].map((id) => `('${id}','${id}@example.invalid')`).join(",")};insert into public.user_roles(user_id,role) values('${first}','lecturer'),('${peer}','lecturer'),('${admin}','admin');update public.profiles set active=false where id='${inactive}'`,
    );
    const get = async (id) => {
        const result = JSON.parse(await actor(id, "select public.get_welcome_progress()"));
        assertLmsResponse("get_welcome_progress", result);
        return result;
    };
    const save = async (id, step, status, version) => {
        const result = JSON.parse(
            await actor(
                id,
                `select public.save_welcome_progress(${q(step)},${q(status)},${version})`,
            ),
        );
        assertLmsResponse("save_welcome_progress", result);
        return result;
    };
    let checks = 0;
    const check = async (name, fn) => {
        await fn();
        checks++;
        console.log(`PASS ${name}`);
    };
    await check(
        "First-login state is complete without creating a record or mutating another user",
        async () => {
            assert.deepEqual(await get(first), {
                step: "welcome",
                status: "active",
                version: 0,
            });
            assert.equal(
                await sql("select count(*) from private.welcome_progress"),
                "0",
            );
        },
    );
    await check(
        "Progress resumes, pauses, skips, completes and restarts with server-confirmed versions",
        async () => {
            assert.deepEqual(await save(first, "profile", "active", 0), {
                step: "profile",
                status: "active",
                version: 1,
            });
            assert.deepEqual(await get(first), {
                step: "profile",
                status: "active",
                version: 1,
            });
            assert.deepEqual(await save(first, "jobs", "paused", 1), {
                step: "jobs",
                status: "paused",
                version: 2,
            });
            assert.deepEqual(await save(first, "jobs", "active", 2), {
                step: "jobs",
                status: "active",
                version: 3,
            });
            assert.equal((await save(first, "jobs", "skipped", 3)).status, "skipped");
            assert.equal((await save(first, "welcome", "active", 4)).step, "welcome");
            assert.equal(
                (await save(first, "finish", "completed", 5)).status,
                "completed",
            );
            assert.deepEqual(await save(first, "welcome", "active", 6), {
                step: "welcome",
                status: "active",
                version: 7,
            });
        },
    );
    await check(
        "Peer and administrator have separate own progress and no private table bypass",
        async () => {
            assert.deepEqual(await get(peer), {
                step: "welcome",
                status: "active",
                version: 0,
            });
            assert.deepEqual(await get(admin), {
                step: "welcome",
                status: "active",
                version: 0,
            });
            for (const who of [peer, admin]) {
                await assert.rejects(
                    actor(who, "select * from private.welcome_progress"),
                    /permission denied/,
                );
                await assert.rejects(
                    actor(
                        who,
                        `update private.welcome_progress set step='finish' where user_id='${first}'`,
                    ),
                    /permission denied/,
                );
            }
            assert.equal((await get(first)).version, 7);
        },
    );
    await check(
        "Stale tabs and simultaneous first writes cannot overwrite a committed step",
        async () => {
            await assert.rejects(
                save(first, "files", "active", 1),
                /PT409.*Welcome progress changed/,
            );
            await assert.rejects(
                save(first, "files", "active", 0),
                /PT409.*Welcome progress changed/,
            );
            const outcomes = await Promise.allSettled([
                save(peer, "profile", "active", 0),
                save(peer, "calendar", "active", 0),
            ]);
            assert.equal(
                outcomes.filter((result) => result.status === "fulfilled").length,
                1,
            );
            assert.equal(
                outcomes.filter((result) => result.status === "rejected").length,
                1,
            );
            assert.equal((await get(peer)).version, 1);
        },
    );
    await check(
        "Invalid input and inactive or unauthenticated actors are rejected",
        async () => {
            for (const [step, status, version] of [
                ["../../admin", "active", 7],
                ["security", "active", 7],
                ["profile", "unknown", 7],
                ["files", "active", -1],
                ["files", "active", 2147483647],
            ])
                await assert.rejects(
                    save(first, step, status, version),
                    /Invalid welcome progress/,
                );
            await assert.rejects(get(inactive), /Active account required/);
            await assert.rejects(
                save(inactive, "profile", "active", 0),
                /Active account required/,
            );
            await assert.rejects(
                sql("set role anon;select public.get_welcome_progress()"),
                /permission denied/,
            );
            await assert.rejects(
                sql("set role authenticated;select public.get_welcome_progress()"),
                /Active account required/,
            );
        },
    );
    await check(
        "Guide progress cannot grant a role, permission or contract acceptance",
        async () => {
            await save(first, "administration", "active", 7);
            assert.equal(
                await sql(
                    `select string_agg(role,',') from public.user_roles where user_id='${first}'`,
                ),
                "lecturer",
            );
            assert.equal(
                await actor(first, "select private.has_permission('users.manage')"),
                "f",
            );
            assert.equal(
                await sql(
                    `select count(*) from public.contract_acceptances where user_id='${first}'`,
                ),
                "0",
            );
            assert.equal(
                await sql(
                    "select relrowsecurity from pg_class where oid='private.welcome_progress'::regclass",
                ),
                "t",
            );
            assert.equal(
                await sql(
                    "select has_table_privilege('authenticated','private.welcome_progress','SELECT')",
                ),
                "f",
            );
        },
    );
    console.log(`\n${checks} welcome-guide PostgreSQL groups passed.`);
});

// Exercise the real forward upgrade with retained legacy progress, not only a
// database created after the no-MFA contract was introduced.
await withTestDatabase(
    "welcome_upgrade",
    async ({sql, actor}) => {
        const user = randomUUID();
        await sql(
            `insert into auth.users(id, email)
             values ('${user}', 'upgrade@example.invalid');
            insert into private.welcome_progress(user_id, step, status, version)
            values ('${user}', 'security', 'paused', 9)`,
        );
        const migration = await readFile(
            new URL(
                "../supabase/migrations/20261117130021_remove_mfa_and_assurance_gates.sql",
                import.meta.url,
            ),
            "utf8",
        );
        await sql(migration);
        assert.deepEqual(
            JSON.parse(await actor(user, "select public.get_welcome_progress()")),
            {step: "profile", status: "paused", version: 10},
        );
        await assert.rejects(
            actor(
                user,
                `select public.save_welcome_progress('security','active',10)`,
            ),
            /Invalid welcome progress/,
        );
        console.log(
            "PASS Legacy security progress upgrades to profile; the removed step is rejected",
        );
    },
    {migrationsThrough: "20261117120001"},
);