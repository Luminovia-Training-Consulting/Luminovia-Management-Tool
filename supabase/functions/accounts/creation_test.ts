/** Direct creation cannot reach privileged Auth before a current-role reservation. */
import assert from "node:assert/strict";
import {type AccountDependencies, createAccountHandler} from "./handler.ts";

const id = "11111111-1111-4111-8111-111111111111",
    requestId = "22222222-2222-4222-8222-222222222222",
    userId = "33333333-3333-4333-8333-333333333333";
const payload = {
    email: "fictional-new@example.invalid",
    display_name: "Fictional user",
    role: "admin",
    organisation_id: null,
    idempotency_key: requestId,
    password: "Aa1!aaaa",
};

function fixture(overrides: Partial<AccountDependencies> = {}) {
    const calls: string[] = [];
    const deps: AccountDependencies = {
        origins: ["http://127.0.0.1:6473"],
        appOrigin: "http://127.0.0.1:6473",
        invitationsEnabled: true,
        authenticate: async () => true,
        openapi: {},
        rpc: async (token, name, args) => {
            assert.equal(token, "native-token");
            assert.equal(name, "reserve_account_creation");
            assert.equal("password" in (args ?? {}), false);
            calls.push("reserve");
            return {data: {status: "reserved", creation_id: id}};
        },
        createAccount: async (account) => {
            assert.equal(account.password, payload.password);
            calls.push("create");
            return userId;
        },
        completeAccount: async (_id, _user, success) => {
            calls.push(success ? "complete" : "failed");
        },
        removeCreatedAccount: async (target) => {
            assert.equal(target, userId);
            calls.push("rollback");
        },
        sendInvitation: async () => {
            throw Error("unexpected email");
        },
        completeInvitation: async () => {
        },
        ...overrides,
    };
    const handler = createAccountHandler(deps);
    return {
        calls,
        request: (data: unknown) =>
            handler(
                new Request("http://localhost/accounts/v1/users", {
                    method: "POST",
                    headers: {
                        authorization: "Bearer native-token",
                        origin: "http://127.0.0.1:6473",
                        "content-type": "application/json",
                    },
                    body: JSON.stringify(data),
                }),
            ),
    };
}

Deno.test(
    "creation reserves before Auth, returns the actual new identity and never echoes the password",
    async () => {
        const f = fixture();
        const r = await f.request(payload);
        assert.equal(r.status, 201);
        const body = await r.json();
        assert.equal(body.user_id, userId);
        assert.equal("password" in body, false);
        assert.deepEqual(f.calls, ["reserve", "create", "complete"]);
    },
);
Deno.test(
    "invalid roles, missing explicit role or company, and weak or injected creation are rejected before Auth",
    async () => {
        for (const data of [
            {...payload, role: "owner"},
            {...payload, role: undefined},
            {...payload, role: "client"},
            {...payload, password: "short"},
            {...payload, password: "Aa1!aaa"},
            {...payload, password: "Aa1 aaaa"},
            {...payload, password: "Password123"},
            {...payload, actor_id: userId},
            {...payload, password: "Secret\nInjected123"},
        ]) {
            const f = fixture();
            assert.equal((await f.request(data)).status, 400);
            assert.deepEqual(f.calls, []);
        }
    },
);
Deno.test("standalone participant creation reserves exactly the selected learner role", async () => {
    const f = fixture({
        rpc: async (_token, name, args) => {
            assert.equal(name, "reserve_account_creation");
            assert.equal(args?.p_role, "participant");
            assert.equal(args?.p_organisation_id, null);
            return {data: {status: "reserved", creation_id: id}};
        },
    });
    const result = await f.request({...payload, role: "participant"});
    assert.equal(result.status, 201);
    assert.deepEqual(f.calls, ["create", "complete"]);
});
Deno.test("participant company and class are reserved together before Auth creation", async () => {
    const f = fixture({
        rpc: async (_token, name, args) => {
            assert.equal(name, "reserve_participant_account_creation");
            assert.deepEqual(args, {
                p_email: payload.email, p_display_name: payload.display_name,
                p_organisation_id: id, p_class_id: userId, p_request_id: requestId,
            });
            return {data: null, error: {code: "42501"}};
        },
    });
    assert.equal((await f.request({...payload, role: "participant", organisation_id: id, class_id: userId})).status, 403);
    assert.equal((await f.request({...payload, role: "participant", class_id: userId})).status, 400);
    assert.deepEqual(f.calls, []);
});
Deno.test(
    "permission denial and settled idempotent retries never create another Auth identity",
    async () => {
        for (const [result, code] of [
            [{data: null, error: {code: "42501"}}, 403],
            [{data: {status: "created", creation_id: id, user_id: userId}}, 200],
        ] as const) {
            const f = fixture({rpc: async () => result});
            assert.equal((await f.request(payload)).status, code);
            assert.deepEqual(f.calls, []);
        }
    },
);
Deno.test(
    "post-create authority revocation rolls back only the just-created identity",
    async () => {
        const f = fixture({
            completeAccount: async (_id, _user, success) => {
                if (success) throw Error("authority revoked");
            },
        });
        assert.equal((await f.request(payload)).status, 502);
        assert.deepEqual(f.calls, ["reserve", "create", "rollback"]);
    },
);

Deno.test(
    "company conversion dispatches one caller-scoped atomic role and membership RPC",
    async () => {
        // Use the handler directly to exercise the actual role endpoint rather than creation.
        const handler = createAccountHandler({
            origins: ["http://127.0.0.1:6473"],
            appOrigin: "http://127.0.0.1:6473",
            invitationsEnabled: false,
            authenticate: async () => true,
            openapi: {},
            rpc: async (token, name, args) => {
                assert.equal(token, "native-token");
                assert.equal(name, "set_account_roles_with_organisation");
                assert.deepEqual(args, {
                    p_user_id: userId,
                    p_roles: ["client"],
                    p_organisation_id: id,
                });
                return {data: null};
            },
            sendInvitation: async () => {
                throw Error("unexpected");
            },
            completeInvitation: async () => {
            },
        });
        assert.equal(
            (
                await handler(
                    new Request(`http://localhost/accounts/v1/users/${userId}/roles`, {
                        method: "PUT",
                        headers: {
                            authorization: "Bearer native-token",
                            "content-type": "application/json",
                        },
                        body: JSON.stringify({roles: ["client"], organisation_id: id}),
                    }),
                )
            ).status,
            200,
        );
    },
);
