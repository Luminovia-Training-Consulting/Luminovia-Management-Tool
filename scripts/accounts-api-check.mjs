/**
 * Real Auth/HTTP checks for accounts, roles and reserved invitations.
 * Separate fictional identities verify actual API results and denied access; responses are not browser mocks.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {setTimeout as delay} from "node:timers/promises";
import {createClient} from "@supabase/supabase-js";
import {accountResponse, verifyAccountHttpResponse} from "./testing/openapi-contract.mjs";
import {assertPasswordOnly} from "./testing/password-only.mjs";

if (process.env.PORTAL_TEST_MODE !== "1")
    throw new Error("Account API mutations require isolated ./portal test.");
process.loadEnvFile(".env.test.local");
const project = /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m.exec(
    readFileSync("supabase/config.toml", "utf8"),
)?.[1];
assert.match(project ?? "", /^luminovia-portal-test-[a-f0-9]+$/);
const url = process.env.SUPABASE_URL;
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname));
const origin = process.env.PORTAL_APP_ORIGIN ?? "http://127.0.0.1:5273";
/** Creates a separate SDK client without persistent sessions or automatic session refresh. */
const make = (key) =>
    createClient(url, key, {
        auth: {persistSession: false, autoRefreshToken: false},
    });
const service = make(process.env.SUPABASE_SERVICE_ROLE_KEY),
    users = [],
    organisations = [];
const suffix = randomUUID().slice(0, 8);
const directoryLabel = `API account ${suffix}`;

/** Requires actual SDK success before returning the response data. */
async function checked(request, label) {
    const result = await request;
    assert.equal(result.error, null, `${label}: ${result.error?.message}`);
    return result.data;
}

/** Creates separate fictional accounts and signs them in through Auth; their IDs belong only to the fixture. */
async function fixture(name, role) {
    const email = `account-${suffix}-${name}@example.invalid`;
    const data = await checked(
        service.auth.admin.createUser({
            email,
            password: process.env.E2E_PASSWORD,
            email_confirm: true,
        }),
        "Create own API fixture",
    );
    users.push(data.user.id);
    await checked(
        service.from("user_roles").insert({user_id: data.user.id, role}),
        "Assign fixture role",
    );
    await checked(
        service
            .from("profiles")
            .update({display_name: `${directoryLabel} ${name}`})
            .eq("id", data.user.id),
        "Name fixture",
    );
    const client = make(process.env.SUPABASE_ANON_KEY);
    await checked(
        client.auth.signInWithPassword({
            email,
            password: process.env.E2E_PASSWORD,
        }),
        "Actual Auth login",
    );
    return {id: data.user.id, email, client};
}

/** Confirms privileged requests work with password-only AAL1 and no enrolled factors. */
async function passwordOnly(actor) {
    await assertPasswordOnly(actor.client);
}

/** Proves Auth itself enforces the eight-character create/reset boundary using disposable local identities. */
async function passwordFloor() {
    const shortEmail = `password-short-${suffix}@example.invalid`;
    const shortCreation = await service.auth.admin.createUser({
        email: shortEmail,
        password: "Aa1!aaa",
        email_confirm: true,
    });
    if (shortCreation.data.user) users.push(shortCreation.data.user.id);
    assert(shortCreation.error, "Auth must reject a seven-character password");

    const email = `password-floor-${suffix}@example.invalid`;
    const created = await checked(
        service.auth.admin.createUser({
            email,
            password: "Aa1!aaaa",
            email_confirm: true,
        }),
        "Auth accepts the eight-character creation boundary",
    );
    users.push(created.user.id);
    const client = make(process.env.SUPABASE_ANON_KEY);
    await checked(
        client.auth.signInWithPassword({email, password: "Aa1!aaaa"}),
        "Sign in with an eight-character password",
    );
    const shortReset = await client.auth.updateUser({password: "Aa1!aaa"});
    assert(shortReset.error, "Auth must reject a seven-character password reset");
    await checked(
        client.auth.updateUser({password: "Bb2!bbbb"}),
        "Auth accepts the eight-character password reset boundary",
    );
    const concurrent = await Promise.all(
        Array.from({length: 3}, (_, index) =>
            checked(
                service.auth.admin.createUser({
                    email: `parallel-id-${index}-${suffix}@example.invalid`,
                    password: "Aa1!aaaa",
                    email_confirm: true,
                }),
                "Concurrent Auth profile creation",
            ),
        ),
    );
    const concurrentIds = concurrent.map((result) => result.user.id);
    users.push(...concurrentIds);
    const profiles = await checked(
        service
            .from("profiles")
            .select("id,luminovia_user_id")
            .in("id", concurrentIds),
        "Read IDs assigned during concurrent profile creation",
    );
    assert.equal(profiles.length, concurrentIds.length);
    const publicIds = profiles.map((profile) => profile.luminovia_user_id);
    assert.equal(new Set(publicIds).size, concurrentIds.length);
    for (const publicId of publicIds)
        assert.match(publicId, /^LV-[0-9A-F]{4}(?:-[0-9A-F]{4}){4}$/);
}

/** Sends the actual test request as the selected identity; its response is asserted separately. */
async function request(
    actor,
    path,
    method = "GET",
    body,
    originValue = undefined,
) {
    const session = await checked(
        actor.client.auth.getSession(),
        "Read own Auth session",
    );
    const response = await fetch(`${url}/functions/v1/accounts/v1/${path}`, {
        method,
        headers: {
            apikey: process.env.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${session.session.access_token}`,
            ...(originValue === undefined ? {} : {Origin: originValue}),
            ...(body === undefined ? {} : {"Content-Type": "application/json"}),
        },
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
        signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json();
    verifyAccountHttpResponse(path, method, response.status, payload);
    return {status: response.status, headers: response.headers, body: payload};
}

try {
    await passwordFloor();
    const admin = await fixture("admin", "admin"),
        owner = await fixture("owner", "owner"),
        teacher = await fixture("teacher", "lecturer"),
        peer = await fixture("peer", "lecturer"),
        manager = await fixture("manager", "management");
    let own = await request(teacher, "me");
    assert.equal(own.status, 200);
    assert.equal(own.body.profile.id, teacher.id);
    const teacherPublicId = own.body.profile.luminovia_user_id;
    assert.match(teacherPublicId, /^LV-[0-9A-F]{4}(?:-[0-9A-F]{4}){4}$/);
    assert.deepEqual(own.body.roles, ["lecturer"]);
    assert.match(own.headers.get("cache-control"), /no-store/);
    assert.equal((await request(teacher, "users")).status, 403);
    const adminDirectory = await request(
        admin,
        `users?q=${encodeURIComponent(teacher.email)}`,
    );
    assert.equal(adminDirectory.status, 200);
    assert.equal(
        adminDirectory.body.items.find((row) => row.id === teacher.id)
            .luminovia_user_id,
        teacherPublicId,
    );
    const passwordOnlyAccounts = await request(admin, "users");
    assert.equal(passwordOnlyAccounts.status, 200);
    assert.ok(Array.isArray(passwordOnlyAccounts.body.items));
    await passwordOnly(admin);
    const accounts = await request(
        admin,
        `users?q=${encodeURIComponent(directoryLabel)}&limit=100&offset=0`,
    );
    assert.equal(accounts.status, 200);
    assert.equal(accounts.body.total, 5);
    assert.equal(accounts.body.items.length, 5);
    assert.deepEqual(
        accounts.body.items.map((item) => item.id).sort(),
        [admin, owner, teacher, peer, manager].map((item) => item.id).sort(),
    );
    const listedIds = accounts.body.items.map((item) => item.luminovia_user_id);
    assert.equal(new Set(listedIds).size, accounts.body.items.length);
    assert.ok(
        accounts.body.items.every((item) =>
            /^LV-[0-9A-F]{4}(?:-[0-9A-F]{4}){4}$/.test(item.luminovia_user_id),
        ),
    );
    assert.ok(
        accounts.body.items.every((item) => !("encrypted_password" in item)),
    );
    assert.equal(
        (await admin.client.rpc("account_users", {p_limit: null})).error?.code,
        "22023",
        "Native RPC cannot bypass pagination cap with explicit NULL",
    );
    assert.equal(
        (
            await request(
                teacher,
                "me",
                "PATCH",
                {
                    display_name: `API teacher edited ${suffix}`,
                    bio_de: "Echte API-Daten",
                    time_zone: "Australia/Brisbane",
                },
                origin,
            )
        ).status,
        200,
    );
    own = await request(teacher, "me");
    assert.equal(own.body.profile.time_zone, "Australia/Brisbane");
    for (const payload of [
        {id: peer.id},
        {roles: ["owner"]},
        {active: false},
        {time_zone: "Invalid/Zone"},
    ])
        assert.equal((await request(teacher, "me", "PATCH", payload)).status, 400);
    assert.ok(
        (
            await teacher.client
                .from("profiles")
                .update({time_zone: "Invalid/Zone"})
                .eq("id", teacher.id)
        ).error,
        "Native REST repeats timezone integrity",
    );
    assert.equal(
        (
            await request(teacher, `users/${teacher.id}/roles`, "PUT", {
                roles: ["owner"],
            })
        ).status,
        403,
    );
    assert.equal(
        (
            await request(admin, `users/${teacher.id}/roles`, "PUT", {
                roles: ["lecturer", "senior_lecturer"],
            })
        ).status,
        200,
    );
    assert.deepEqual((await request(teacher, "me")).body.roles, [
        "lecturer",
        "senior_lecturer",
    ]);
    assert.equal(
        (
            await request(manager, `users/${peer.id}/roles`, "PUT", {
                roles: ["admin"],
            })
        ).status,
        403,
    );
    assert.equal(
        (
            await request(manager, `users/${manager.id}/roles`, "PUT", {
                roles: ["admin"],
            })
        ).status,
        403,
    );
    assert.equal(
        (
            await request(manager, `users/${peer.id}/roles`, "PUT", {
                roles: ["lecturer", "senior_lecturer"],
            })
        ).status,
        200,
    );
    assert.deepEqual((await request(peer, "me")).body.roles, [
        "lecturer",
        "senior_lecturer",
    ]);
    assert.equal(
        (
            await request(admin, `users/${peer.id}/roles`, "PUT", {
                roles: ["management"],
            })
        ).status,
        200,
    );
    assert.deepEqual((await request(peer, "me")).body.roles, ["management"]);
    assert.equal(
        (
            await request(admin, `users/${peer.id}/roles`, "PUT", {
                roles: ["admin"],
            })
        ).status,
        200,
    );
    assert.deepEqual((await request(peer, "me")).body.roles, ["admin"]);
    assert.equal(
        (
            await request(owner, `users/${peer.id}/roles`, "PUT", {
                roles: ["lecturer"],
            })
        ).status,
        200,
    );
    assert.deepEqual((await request(peer, "me")).body.roles, ["lecturer"]);
    own = await request(teacher, "me");
    assert.equal(own.body.profile.luminovia_user_id, teacherPublicId);
    assert.equal(
        (
            await request(admin, `users/${peer.id}/roles`, "PUT", {
                roles: ["lecturer", "participant"],
            })
        ).status,
        200,
    );
    assert.deepEqual((await request(peer, "me")).body.roles, [
        "lecturer",
        "participant",
    ]);
    assert.equal(
        (
            await request(admin, `users/${admin.id}/roles`, "PUT", {
                roles: ["lecturer"],
            })
        ).status,
        403,
    );
    assert.equal(
        (
            await request(admin, `users/${admin.id}/status`, "PATCH", {
                active: false,
            })
        ).status,
        403,
    );
    const org = await checked(
        admin.client.rpc("save_organisation", {
            p_id: null,
            p_payload: {
                name: `API organisation ${suffix}`,
                time_zone: "Europe/Berlin",
            },
        }),
        "Create scoped org",
    );
    organisations.push(org);
    assert.equal(
        (
            await request(admin, `users/${peer.id}/roles`, "PUT", {
                roles: ["client"],
            })
        ).status,
        200,
    );
    assert.equal(
        (await request(admin, `users/${peer.id}/organisations/${org}`, "PUT"))
            .status,
        200,
    );
    assert.equal(
        (
            await checked(
                peer.client.rpc("client_organisations"),
                "Scoped linked client",
            )
        )[0].id,
        org,
    );
    assert.equal(
        (await request(admin, `users/${peer.id}/organisations/${org}`, "DELETE"))
            .status,
        200,
    );
    assert.deepEqual(
        await checked(peer.client.rpc("client_organisations"), "Revoked link"),
        [],
    );
    const email = `account-invited-${suffix}@example.invalid`,
        body = {
            email,
            display_name: `Invited client ${suffix}`,
            role: "client",
            organisation_id: org,
            idempotency_key: randomUUID(),
        };
    const sent = await request(admin, "invitations", "POST", body, origin);
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.status, "sent");
    const retry = await request(admin, "invitations", "POST", body);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.status, "already_sent");
    assert.equal(retry.body.invitation_id, sent.body.invitation_id);
    const conflictingInvite = await request(admin, "invitations", "POST", {
        ...body,
        role: "lecturer",
        organisation_id: null,
    });
    assert.equal(conflictingInvite.status, 409);
    accountResponse("/v1/invitations", "post", "409")(
        JSON.stringify(conflictingInvite.body),
    );
    const deniedInvite = await request(teacher, "invitations", "POST", body);
    assert.equal(deniedInvite.status, 403);
    accountResponse("/v1/invitations", "post", "403")(
        JSON.stringify(deniedInvite.body),
    );
    const deniedCompanyInvite = await request(
        teacher, "company-participant-invitations", "POST",
        {
            email,
            display_name: body.display_name,
            organisation_id: org,
            idempotency_key: randomUUID(),
        },
    );
    assert.equal(deniedCompanyInvite.status, 403);
    accountResponse("/v1/company-participant-invitations", "post", "403")(
        JSON.stringify(deniedCompanyInvite.body),
    );
    const invited = (
        await checked(
            service.auth.admin.listUsers({perPage: 1000}),
            "Read scoped invited actor",
        )
    ).users.find((user) => user.email === email);
    assert.ok(invited);
    users.push(invited.id);
    assert.deepEqual(
        (
            await checked(
                service.from("user_roles").select("role").eq("user_id", invited.id),
                "Invited role",
            )
        ).map((row) => row.role),
        ["client"],
    );
    assert.equal(
        (
            await checked(
                service
                    .from("client_organisation_memberships")
                    .select("organisation_id")
                    .eq("user_id", invited.id),
                "Invited client scope",
            )
        )[0].organisation_id,
        org,
    );
    let messages = [];
    for (let i = 0; i < 20; i++) {
        const inbox = await (
            await fetch(`${process.env.E2E_MAILPIT_URL}/api/v1/messages`)
        ).json();
        messages = inbox.messages.filter((message) =>
            message.To.some((recipient) => recipient.Address === email),
        );
        if (messages.length) break;
        await delay(250);
    }
    assert.equal(
        messages.length,
        1,
        "Exactly one actual captured account invitation after retry",
    );
    assert.equal(
        (await request(admin, "users", "GET", undefined, "https://foreign.invalid"))
            .status,
        403,
    );
    assert.equal(
        (
            await request(admin, `users/${teacher.id}/status`, "PATCH", {
                active: false,
            })
        ).status,
        200,
    );
    assert.equal((await request(teacher, "me")).status, 401);
    assert.equal(
        (
            await request(admin, `users/${teacher.id}/status`, "PATCH", {
                active: true,
            })
        ).status,
        200,
    );
    assert.equal((await request(teacher, "me")).status, 200);
    await passwordOnly(manager);
    const managerCatalog = await request(manager, "roles");
    assert.equal(managerCatalog.status, 200);
    assert.ok(
        managerCatalog.body.some((row) => row.role === "guest" && row.assignable),
    );
    assert.ok(
        managerCatalog.body
            .filter((row) => ["owner", "admin", "management"].includes(row.role))
            .every((row) => row.assignable === false),
    );
    assert.equal(
        (
            await request(manager, `users/${teacher.id}/roles`, "PUT", {
                roles: ["senior_lecturer"],
            })
        ).status,
        200,
    );
    assert.deepEqual((await request(teacher, "me")).body.roles, [
        "senior_lecturer",
    ]);
    for (const target of [admin, manager])
        assert.equal(
            (
                await request(manager, `users/${target.id}/roles`, "PUT", {
                    roles: ["guest"],
                })
            ).status,
            403,
        );
    assert.equal(
        (
            await request(manager, `users/${teacher.id}/roles`, "PUT", {
                roles: ["admin"],
            })
        ).status,
        403,
    );
    assert.equal(
        (
            await request(manager, `users/${teacher.id}/roles`, "PUT", {
                roles: ["guest"],
            })
        ).status,
        200,
    );
    const guestMe = await request(teacher, "me");
    assert.equal(guestMe.status, 200);
    assert.deepEqual(guestMe.body.roles, ["guest"]);
    assert.deepEqual(guestMe.body.permissions, []);
    assert.equal((await request(teacher, "users")).status, 403);
    assert.equal(
        (
            await request(manager, `users/${teacher.id}/roles`, "PUT", {
                roles: ["lecturer"],
            })
        ).status,
        200,
    );
    assert.deepEqual((await request(teacher, "me")).body.roles, ["lecturer"]);
    const combined = await request(manager, `users/${teacher.id}/roles`, "PUT", {
        roles: ["client", "lecturer"],
    });
    assert.equal(combined.status, 200);
    assert.deepEqual((await request(teacher, "me")).body.roles, ["client", "lecturer"]);
    assert.deepEqual(
        await checked(teacher.client.rpc("client_organisations"), "No unassigned company membership"),
        [],
    );
    const teachingOnly = await request(manager, `users/${teacher.id}/roles`, "PUT", {
        roles: ["lecturer"],
    });
    assert.equal(teachingOnly.status, 200);
    assert.deepEqual((await request(teacher, "me")).body.roles, ["lecturer"]);
    assert.equal(
        (
            await request(manager, `users/${admin.id}/status`, "PATCH", {
                active: false,
            })
        ).status,
        403,
    );
    const privatePolicy = await checked(
        manager.client.rpc("commission_access"),
        "Manager private policy projection",
    );
    assert.equal("regular_lecturer_percent" in privatePolicy, false);
    assert.equal("senior_lecturer_percent" in privatePolicy, false);
    const catalog = await request(admin, "roles");
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.some((row) => row.role === "owner"), false);
    assert.ok(catalog.body.some((row) => row.role === "participant" && row.assignable));
    assert.ok(catalog.body.some((row) => row.role === "admin" && row.assignable));
    assert.ok(catalog.body.some((row) => row.role === "client"));
    const spec = await fetch(`${url}/functions/v1/accounts/openapi.json`, {
        headers: {
            apikey: process.env.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${(await admin.client.auth.getSession()).data.session.access_token}`,
        },
    });
    assert.equal(spec.status, 200);
    assert.equal((await spec.json()).openapi, "3.1.0");
    console.log(
        "PASS: actual password-only Auth Account HTTP API, own profile, strict identity/roles/timezones, bounded directory, self protection, role assignment, scoped client links/revocation, durable one-email invitation, origin check and old-token suspension/reactivation.",
    );
} finally {
    if (users.length) {
        await checked(
            service.from("invitation_requests").delete().in("actor_id", users),
            "Remove scoped invitation ledger",
        );
        await checked(
            service
                .from("client_organisation_memberships")
                .delete()
                .in("user_id", users),
            "Remove scoped memberships",
        );
        await checked(
            service.from("audit_events").delete().in("actor_id", users),
            "Remove scoped audit",
        );
        for (const id of users)
            await checked(
                service.auth.admin.deleteUser(id),
                "Remove own account fixture",
            );
    }
    if (organisations.length)
        await checked(
            service.from("organisations").delete().in("id", organisations),
            "Remove own empty organisations",
        );
}
