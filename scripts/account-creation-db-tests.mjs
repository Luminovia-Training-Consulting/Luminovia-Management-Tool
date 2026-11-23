/** Actual account creation/role hierarchy and guest-only database boundaries. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("account_creation", async ({sql, actor}) => {
    const admin = randomUUID(),
        owner = randomUUID(),
        manager = randomUUID(),
        lecturer = randomUUID(),
        guest = randomUUID(),
        retired = randomUUID(),
        org = randomUUID();
    await sql(
        `insert into auth.users(id,email) values${[admin, owner, manager, lecturer, guest, retired].map((id) => `('${id}','${id}@example.invalid')`).join(",")};insert into public.user_roles(user_id,role) values('${admin}','admin'),('${owner}','owner'),('${manager}','management'),('${lecturer}','lecturer'),('${guest}','guest'),('${retired}','participant');insert into public.organisations(id,name) values('${org}','Fictional account creation company')`,
    );
    const service = (text) =>
        sql(`begin;set local role service_role;${text};commit;`);
    const reserve = async (
        who,
        role,
        orgId = null,
        key = randomUUID(),
        email = "created-" + randomUUID() + "@example.invalid",
    ) =>
        JSON.parse(
            await actor(
                who,
                `select public.reserve_account_creation(${q(email)},'Fictional new user',${q(role)},${orgId ? q(orgId) : "null"},${q(key)})`,
            ),
        );
    const created = [];
    for (const role of [
        "admin",
        "management",
        "senior_lecturer",
        "lecturer",
        "guest",
        "client",
        "participant",
    ]) {
        const email = "created-" + randomUUID() + "@example.invalid",
            key = randomUUID(),
            r = await reserve(
                admin,
                role,
                role === "client" ? org : null,
                key,
                email,
            ),
            id = randomUUID();
        assert.equal(r.status, "reserved");
        await sql(`insert into auth.users(id,email) values('${id}',${q(email)})`);
        await service(
            `select public.complete_account_creation('${r.creation_id}','${id}',true)`,
        );
        assert.equal(
            await sql(`select role from public.user_roles where user_id='${id}'`),
            role,
        );
        assert.equal(
            (await reserve(admin, role, role === "client" ? org : null, key, email))
                .status,
            "created",
        );
        if (role === "client")
            assert.equal(
                await sql(
                    `select organisation_id from public.client_organisation_memberships where user_id='${id}'`,
                ),
                org,
            );
        created.push({id, role});
    }
    await assert.rejects(reserve(manager, "admin"), /42501/);
    await assert.rejects(reserve(manager, "client", org), /42501/);
    await assert.rejects(reserve(admin, "owner"), /42501/);
    await assert.rejects(reserve(admin, "client"), /22023/);
    await assert.rejects(
        actor(
            lecturer,
            `select public.complete_account_creation('${randomUUID()}','${randomUUID()}',true)`,
        ),
        /42501/,
    );
    const newAdmin = created.find((x) => x.role === "admin");
    await actor(
        admin,
        `select public.set_account_roles('${newAdmin.id}',array['lecturer'])`,
    );
    assert.equal(
        await sql(
            `select role from public.user_roles where user_id='${newAdmin.id}'`,
        ),
        "lecturer",
    );
    await assert.rejects(
        actor(
            admin,
            `select public.set_account_roles('${admin}',array['admin','senior_lecturer'])`,
        ),
        /42501/,
    );
    await assert.rejects(
        actor(
            admin,
            `select public.set_account_roles('${owner}',array['lecturer'])`,
        ),
        /42501/,
    );
    await assert.rejects(
        actor(
            manager,
            `select public.set_account_roles('${lecturer}',array['admin'])`,
        ),
        /42501/,
    );
    // A missing/unauthorised company binding must roll back the role edit.
    await assert.rejects(
        actor(
            admin,
            `select public.set_account_roles_with_organisation('${lecturer}',array['client'],'${randomUUID()}')`,
        ),
        /22023/,
    );
    assert.equal(
        await sql(`select role from public.user_roles where user_id='${lecturer}'`),
        "lecturer",
    );
    await actor(
        admin,
        `select public.set_account_roles_with_organisation('${lecturer}',array['client'],'${org}')`,
    );
    assert.equal(
        await sql(
            `select count(*) from public.client_organisation_memberships where user_id='${lecturer}' and organisation_id='${org}' and removed_at is null`,
        ),
        "1",
    );
    await actor(
        admin,
        `select public.set_account_roles('${lecturer}',array['lecturer'])`,
    );
    const revokedEmail = "revoked-" + randomUUID() + "@example.invalid",
        r = await reserve(manager, "guest", null, randomUUID(), revokedEmail),
        pending = randomUUID();
    await sql(
        `insert into auth.users(id,email) values('${pending}',${q(revokedEmail)});delete from public.user_roles where user_id='${manager}'`,
    );
    await assert.rejects(
        service(
            `select public.complete_account_creation('${r.creation_id}','${pending}',true)`,
        ),
        /42501/,
    );
    assert.equal(
        await sql(
            `select count(*) from public.user_roles where user_id='${pending}'`,
        ),
        "0",
    );
    // PostgREST invokes this hook for every database role. Non-user requests
    // must never evaluate authenticated-only helpers (SQL AND is not a guard).
    await sql(
        "begin;set local role service_role;select public.require_portal_access();rollback;",
    );
    await sql(
        "begin;set local role anon;select public.require_portal_access();rollback;",
    );
    assert.equal(await actor(guest, "select public.portal_access()"), "t");
    assert.equal(await actor(guest, "select private.actor_active()"), "f");
    assert.equal(await actor(retired, "select public.portal_access()"), "f");
    assert.equal(await actor(guest, `select count(*) from public.profiles`), "1");
    assert.equal(
        await actor(guest, `select count(*) from public.user_roles`),
        "1",
    );
    await actor(
        guest,
        `update public.profiles set display_name='Guest updated' where id='${guest}'`,
    );
    assert.equal(
        await sql(`select display_name from public.profiles where id='${guest}'`),
        "Guest updated",
    );
    await assert.rejects(
        actor(guest, `update public.profiles set active=false where id='${guest}'`),
        /42501/,
    );
    for (const path of [
        "/rpc/people_directory",
        "/jobs",
        "/rpc/save_taxonomy_topic",
        "/rpc/account_users",
    ])
        await assert.rejects(
            actor(
                guest,
                `select set_config('request.path',${q(path)},true);select public.require_portal_access()`,
            ),
            /42501/,
        );
    await actor(
        guest,
        `select set_config('request.path','/profiles',true);select public.require_portal_access()`,
    );
    await assert.rejects(
        actor(guest, `select * from private.account_creation_requests`),
        /42501/,
    );
    console.log(
        "PASS seven explicitly assigned account roles, company binding, idempotency and current authority; admin peer role changes with protected self roles and owner identity, guest own-only profile and unconfirmed participant denial",
    );
});
