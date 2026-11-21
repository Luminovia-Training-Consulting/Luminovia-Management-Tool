/**
 * PostgreSQL regression groups for accounts, roles and reserved invitations.
 * Real migrations define the contract; controlled role claims exercise it independently of the UI.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

let checks = 0;
/** Counts and reports a group only after every related assertion has passed. */
const check = async (name, fn) => {
    await fn();
    checks++;
    console.log(`PASS ${name}`);
};
await withTestDatabase("accounts_test", async ({sql, actor}) => {
    const admin = randomUUID(),
        owner = randomUUID(),
        manager = randomUUID(),
        lecturer = randomUUID(),
        peer = randomUUID(),
        delegated = randomUUID(),
        promotable = randomUUID(),
        client = randomUUID(),
        participant = randomUUID();
    const org = randomUUID();
    await sql(
        `insert into auth.users(id, email) values ${[admin, owner, manager, lecturer, peer, delegated, promotable, client, participant].map((id) => `('${id}','${id}@example.invalid')`).join(",")};
      insert into public.user_roles(user_id, role)
      values ('${admin}', 'admin'),
             ('${owner}', 'owner'),
             ('${manager}', 'management'),
             ('${lecturer}', 'lecturer'),
             ('${peer}', 'lecturer'),
             ('${delegated}', 'lecturer'),
             ('${promotable}', 'lecturer'),
             ('${client}', 'client'),
             ('${participant}', 'participant');
      update public.profiles
      set display_name='Fictional account';
      insert into public.organisations(id, name)
      values ('${org}', 'Fictional API customer');`,
    );
    /** Calls the business database API under the fixture's controlled identity claims. */
    const rpc = (who, name, args = [], aal = "aal1") =>
        actor(
            who,
            `select public.${name}(${args.map((value) => (value === null ? "null" : typeof value === "boolean" || typeof value === "number" ? String(value) : q(value))).join(",")})`,
            aal,
        ).then((value) => {
            try {
                return JSON.parse(value);
            } catch {
                return value;
            }
        });
    await check(
        "Each account gets only its own current identity and roles, never secrets",
        async () => {
            const me = await rpc(lecturer, "account_me");
            assert.equal(me.profile.id, lecturer);
            assert.deepEqual(me.roles, ["lecturer"]);
            assert.deepEqual(me.permissions, []);
            assert.equal("assurance_level" in me, false);
            const adminMe = await rpc(admin, "account_me");
            assert.ok(adminMe.permissions.includes("jobs.manage"));
            assert.equal("assurance_level" in adminMe, false);
            assert.ok(me.profile.email.endsWith("@example.invalid"));
            assert.equal("password" in me, false);
            assert.equal("service_role" in me, false);
            await assert.rejects(
                sql("set role anon;select public.account_me()"),
                /permission denied/,
            );
        },
    );
    await check(
        "Own profile changes persist; role, activity, foreign IDs and invalid JSON fields cannot be forged",
        async () => {
            await rpc(lecturer, "save_account_profile", [
                JSON.stringify({
                    display_name: "API teacher",
                    bio_de: "Eigener Text",
                    time_zone: "Australia/Brisbane",
                }),
            ]);
            assert.equal(
                (await rpc(lecturer, "account_me")).profile.time_zone,
                "Australia/Brisbane",
            );
            for (const payload of [
                {id: peer},
                {active: false},
                {roles: ["admin"]},
                {display_name: {nested: "x"}},
                {time_zone: "Not/AZone"},
            ])
                await assert.rejects(
                    rpc(lecturer, "save_account_profile", [JSON.stringify(payload)]),
                    /Unknown profile field|Invalid profile/,
                );
            await assert.rejects(
                actor(
                    lecturer,
                    `update public.profiles set time_zone='Not/AZone' where id='${lecturer}'`,
                ),
                /22023/,
            );
        },
    );
    await check(
        "Account directory follows current database roles and excludes auth credential internals",
        async () => {
            await assert.rejects(rpc(lecturer, "account_users"), /42501/);
            const result = await rpc(admin, "account_users", ["API teacher", 25, 0]);
            assert.equal(result.total, 1);
            assert.equal(result.items[0].id, lecturer);
            assert.equal("encrypted_password" in result.items[0], false);
            await assert.rejects(
                rpc(admin, "account_users", ["", 101, 0], "aal1"),
                /Invalid pagination/,
            );
            await assert.rejects(
                rpc(admin, "account_users", ["", null, 0], "aal1"),
                /Invalid pagination/,
            );
            await assert.rejects(
                rpc(admin, "account_users", ["", 10, null], "aal1"),
                /Invalid pagination/,
            );
        },
    );
    await check(
        "Every fixture account receives a unique stable public ID without granting lookup authority",
        async () => {
            const fixtureAccounts = [
                admin,
                owner,
                manager,
                lecturer,
                peer,
                delegated,
                promotable,
                client,
                participant,
            ];
            const directory = await rpc(admin, "account_users", ["", 100, 0]);
            const rows = directory.items.filter((item) =>
                fixtureAccounts.includes(item.id),
            );
            assert.equal(rows.length, fixtureAccounts.length);
            const publicIds = rows.map((row) => row.luminovia_user_id);
            assert.equal(new Set(publicIds).size, fixtureAccounts.length);
            for (const id of publicIds)
                assert.match(id, /^LV-[0-9A-F]{4}(?:-[0-9A-F]{4}){4}$/);
            const adminPublicId = rows.find(
                (row) => row.id === admin,
            ).luminovia_user_id;
            await assert.rejects(
                actor(
                    lecturer,
                    `update public.profiles set luminovia_user_id='LV-FFFF-FFFF-FFFF-FFFF-FFFF' where id='${admin}'`,
                ),
                /(42501|23514)/,
            );
            const afterDeniedWrite = await rpc(admin, "account_users", ["", 100, 0]);
            assert.equal(
                afterDeniedWrite.items.find((row) => row.id === admin)
                    .luminovia_user_id,
                adminPublicId,
            );
            await assert.rejects(
                rpc(lecturer, "account_users", ["", 100, 0]),
                /42501/,
            );
        },
    );
    await check(
        "Only admin/owner can grant management or admin; management can grant subordinate roles",
        async () => {
            await assert.rejects(
                rpc(manager, "set_account_roles", [lecturer, "{admin}"], "aal1"),
                /42501/,
            );
            await assert.rejects(
                rpc(manager, "set_account_roles", [lecturer, "{management}"], "aal1"),
                /42501/,
            );
            await rpc(
                manager,
                "set_account_roles",
                [delegated, "{senior_lecturer}"],
                "aal1",
            );
            assert.deepEqual((await rpc(delegated, "account_me")).roles, [
                "senior_lecturer",
            ]);
            await assert.rejects(
                rpc(manager, "set_account_roles", [manager, "{admin}"], "aal1"),
                /42501/,
            );
            await assert.rejects(
                rpc(lecturer, "set_account_roles", [lecturer, "{admin}"], "aal1"),
                /42501/,
            );
            await rpc(
                admin,
                "set_account_roles",
                [promotable, "{management}"],
                "aal1",
            );
            assert.deepEqual((await rpc(promotable, "account_me")).roles, [
                "management",
            ]);
            await rpc(admin, "set_account_roles", [promotable, "{admin}"], "aal1");
            assert.deepEqual((await rpc(promotable, "account_me")).roles, ["admin"]);
            await assert.rejects(
                rpc(admin, "set_account_roles", [owner, "{management}"], "aal1"),
                /42501/,
            );
            await rpc(owner, "set_account_roles", [promotable, "{lecturer}"], "aal1");
            await rpc(
                owner,
                "set_account_roles",
                [peer, "{lecturer,senior_lecturer}"],
                "aal1",
            );
            assert.deepEqual((await rpc(peer, "account_me")).roles, [
                "lecturer",
                "senior_lecturer",
            ]);
            await assert.rejects(
                rpc(admin, "set_account_roles", [peer, "{participant}"], "aal1"),
                /42501/,
            );
            await assert.rejects(
                rpc(admin, "set_account_roles", [peer, "{fake_role}"], "aal1"),
                /Invalid roles/,
            );
        },
    );
    await check(
        "Self administrative removal and self suspension are protected and role mutations are audited",
        async () => {
            await assert.rejects(
                rpc(admin, "set_account_roles", [admin, "{lecturer}"], "aal1"),
                /Self administrative/,
            );
            await assert.rejects(
                rpc(owner, "set_user_active", [owner, false], "aal1"),
                /Self-deactivation/,
            );
            assert.equal(
                await sql(
                    `select count(*) from public.audit_events where action='account.roles_changed' and resource_id='${peer}'`,
                ),
                "1",
            );
        },
    );
    await check(
        "Concurrent mutual administrator removal cannot eliminate every administrator",
        async () => {
            const results = await Promise.allSettled([
                rpc(admin, "set_account_roles", [owner, "{lecturer}"], "aal1"),
                rpc(owner, "set_account_roles", [admin, "{lecturer}"], "aal1"),
            ]);
            assert.equal(
                results.filter((result) => result.status === "fulfilled").length,
                1,
            );
            assert.equal(
                await sql(
                    "select count(distinct ur.user_id) from public.user_roles ur join public.profiles p on p.id=ur.user_id where ur.role in ('admin','owner') and p.active",
                ),
                "1",
            );
            await sql(
                `insert into public.user_roles(user_id,role) values('${admin}','admin'),('${owner}','owner') on conflict do nothing;`,
            );
        },
    );
    await check(
        "Role removal and suspension use the same lock and cannot race into zero active administrators",
        async () => {
            const results = await Promise.allSettled([
                rpc(admin, "set_account_roles", [owner, "{lecturer}"], "aal1"),
                rpc(owner, "set_user_active", [admin, false], "aal1"),
            ]);
            assert.equal(
                results.filter((result) => result.status === "fulfilled").length,
                1,
            );
            assert.equal(
                await sql(
                    "select count(distinct ur.user_id) from public.user_roles ur join public.profiles p on p.id=ur.user_id where ur.role in ('admin','owner') and p.active",
                ),
                "1",
            );
            await sql(
                `update public.profiles set active=true where id='${admin}';insert into public.user_roles(user_id,role) values('${admin}','admin'),('${owner}','owner') on conflict do nothing;`,
            );
        },
    );
    const inviteKey = randomUUID();
    let invitation;
    await check(
        "Client invitations bind exact role, organisation and request identity before any external send",
        async () => {
            invitation = await rpc(
                admin,
                "reserve_account_invitation",
                [
                    "fictional-client@example.invalid",
                    "Client",
                    "client",
                    org,
                    inviteKey,
                ],
                "aal1",
            );
            assert.equal(invitation.status, "reserved");
            assert.equal(
                (
                    await rpc(
                        admin,
                        "reserve_account_invitation",
                        [
                            "fictional-client@example.invalid",
                            "Client",
                            "client",
                            org,
                            inviteKey,
                        ],
                        "aal1",
                    )
                ).status,
                "in_progress",
            );
            assert.equal(
                (
                    await rpc(
                        admin,
                        "reserve_account_invitation",
                        [
                            "fictional-client@example.invalid",
                            "Client",
                            "lecturer",
                            null,
                            inviteKey,
                        ],
                        "aal1",
                    )
                ).status,
                "idempotency_conflict",
            );
            await assert.rejects(
                rpc(
                    manager,
                    "reserve_account_invitation",
                    [
                        "another@example.invalid",
                        "Client",
                        "management",
                        null,
                        randomUUID(),
                    ],
                    "aal1",
                ),
                /Only subordinate invitation/,
            );
            await assert.rejects(
                rpc(
                    admin,
                    "reserve_account_invitation",
                    ["bad@example.invalid", "Client", "lecturer", org, randomUUID()],
                    "aal1",
                ),
                /Valid client organisation/,
            );
        },
    );
    await check(
        "Completion is server-only and grants only the reserved role and reserved organisation",
        async () => {
            await assert.rejects(
                rpc(
                    admin,
                    "complete_account_invitation",
                    [invitation.invitation_id, client, "Untrusted", true],
                    "aal1",
                ),
                /permission denied/,
            );
            await sql(
                `begin;set local role service_role;set local request.jwt.claim.role='service_role';select public.complete_account_invitation('${invitation.invitation_id}','${client}','Client',true);commit;`,
            );
            assert.equal(
                (
                    await rpc(
                        admin,
                        "reserve_account_invitation",
                        [
                            "fictional-client@example.invalid",
                            "Client",
                            "client",
                            org,
                            inviteKey,
                        ],
                        "aal1",
                    )
                ).status,
                "already_sent",
            );
            assert.equal(
                await sql(
                    `select count(*) from public.client_organisation_memberships where user_id='${client}' and organisation_id='${org}' and removed_at is null`,
                ),
                "1",
            );
            assert.deepEqual((await rpc(client, "account_me")).roles, ["client"]);
        },
    );
    await check(
        "A revoked inviter cannot complete a pending privileged invitation",
        async () => {
            const pending = await rpc(
                manager,
                "reserve_account_invitation",
                ["guest-api@example.invalid", "Guest", "guest", null, randomUUID()],
                "aal1",
            );
            await sql(`delete from public.user_roles where user_id='${manager}'`);
            await assert.rejects(
                sql(
                    `begin;set local role service_role;set local request.jwt.claim.role='service_role';select public.complete_account_invitation('${pending.invitation_id}','${participant}','Student',true);commit;`,
                ),
                /Inviter authority revoked/,
            );
        },
    );
    await check(
        "Suspended accounts lose existing-token account/API access immediately",
        async () => {
            await rpc(admin, "set_user_active", [lecturer, false], "aal1");
            await assert.rejects(rpc(lecturer, "account_me"), /Active login/);
            await assert.rejects(
                rpc(lecturer, "save_account_profile", ["{}"]),
                /Active login/,
            );
            await rpc(admin, "set_user_active", [lecturer, true], "aal1");
            assert.equal((await rpc(lecturer, "account_me")).profile.active, true);
        },
    );
    await check(
        "Deleting an account cascades its recipient-owned notifications",
        async () => {
            const disposable = randomUUID();
            await sql(
                `insert into auth.users(id,email) values('${disposable}','notification-cleanup@example.invalid');insert into public.notifications(user_id,kind) values('${disposable}','account_cleanup_test');delete from auth.users where id='${disposable}';`,
            );
            assert.equal(
                await sql(
                    `select count(*) from public.notifications where user_id='${disposable}'`,
                ),
                "0",
            );
            assert.equal(
                await sql(
                    `select count(*) from public.profiles where id='${disposable}'`,
                ),
                "0",
            );
        },
    );
});
console.log(
    `\n${checks} account PostgreSQL checks passed (identity, roles, invitation binding and lifecycle races).`,
);