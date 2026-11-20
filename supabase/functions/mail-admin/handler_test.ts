/** Deno handler regressions use fictional tokens and mocked boundaries; no real relay or account is contacted. */
import {assert, assertEquals, assertFalse} from "jsr:@std/assert@1.0.14";
import {createMailAdminHandler, type MailAdminDependencies,} from "./handler.ts";

const origin = "https://portal.example.invalid";
const token = "fictional.user.jwt.token.with.enough.length";
const testId = "12345678-1234-4234-9234-123456789abc";

/** Record the user-authorized SQL and secret relay boundaries independently. */
function fixture(
    overrides: Partial<MailAdminDependencies> = {},
    relayValue: unknown = {status: "succeeded", error_code: null},
) {
    const calls: string[] = [];
    const dependencies: MailAdminDependencies = {
        origins: [origin],
        relayAvailable: true,
        queueTest: async (userToken, protocol) => {
            calls.push(`queue:${userToken}:${protocol}`);
            return {data: testId, error: null};
        },
        relayTest: async (id) => {
            calls.push(`relay:${id}`);
            return relayValue;
        },
        ...overrides,
    };
    return {
        calls,
        handler: createMailAdminHandler(dependencies),
        request: (value: unknown = {protocol: "smtp"}, headers = {}) =>
            new Request("https://portal.example.invalid/functions/v1/mail-admin", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`,
                    origin,
                    "content-type": "application/json",
                    ...headers,
                },
                body: JSON.stringify(value),
            }),
    };
}

Deno.test(
    "invalid auth, origin, method and oversized input never queue a connection test",
    async () => {
        const f = fixture();
        const noAuth = await f.handler(
            new Request("https://portal.example.invalid/functions/v1/mail-admin", {
                method: "POST",
                headers: {origin, "content-type": "application/json"},
                body: JSON.stringify({protocol: "smtp"}),
            }),
        );
        assertEquals(noAuth.status, 401);
        const preflight = await f.handler(
            new Request("https://portal.example.invalid/functions/v1/mail-admin", {
                method: "OPTIONS",
                headers: {origin},
            }),
        );
        assertEquals(preflight.status, 204);
        assertEquals(
            preflight.headers.get("access-control-allow-methods"),
            "POST, OPTIONS",
        );
        const wrongOrigin = await f.handler(
            new Request("https://portal.example.invalid/functions/v1/mail-admin", {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`,
                    origin: "https://attacker.example.invalid",
                    "content-type": "application/json",
                },
                body: JSON.stringify({protocol: "smtp"}),
            }),
        );
        assertEquals(wrongOrigin.status, 403);
        assertEquals(
            (
                await f.handler(
                    new Request("https://portal.example.invalid", {method: "GET"}),
                )
            ).status,
            405,
        );
        const oversized = await f.handler(
            f.request({protocol: "smtp", extra: "x".repeat(3000)}),
        );
        assertEquals(oversized.status, 400);
        assertEquals(f.calls, []);
    },
);

Deno.test(
    "the caller's JWT authorizes the test and the relay receives only its queued ID",
    async () => {
        const f = fixture();
        const response = await f.handler(f.request({protocol: "imap"}));

        assertEquals(response.status, 200);
        assertEquals(await response.json(), {
            status: "succeeded",
            error_code: null,
        });
        assertEquals(f.calls, [`queue:${token}:imap`, `relay:${testId}`]);
        assertEquals(response.headers.get("cache-control"), "no-store");
        assertEquals(response.headers.get("access-control-allow-origin"), origin);
    },
);

Deno.test("database permission denial blocks relay access", async () => {
    const f = fixture({
        queueTest: async () => ({data: null, error: {code: "42501"}}),
    });
    const response = await f.handler(f.request());

    assertEquals(response.status, 403);
    assertEquals(await response.json(), {error: "permission_denied"});
    assertEquals(f.calls, []);
});

Deno.test("local Mailpit mode reports relay checks unavailable without queueing secrets", async () => {
    const f = fixture({relayAvailable: false});
    const response = await f.handler(f.request());

    assertEquals(response.status, 503);
    assertEquals(await response.json(), {error: "test_unavailable"});
    assertEquals(f.calls, []);
});

Deno.test(
    "relay failures return only fixed codes and never echo provider details",
    async () => {
        const f = fixture(
            {},
            {
                status: "failed",
                error_code: "authentication_failed",
                password: "private-provider-password",
                message: "provider echoed private-provider-password",
            },
        );
        const response = await f.handler(f.request());
        const body = await response.text();

        assertEquals(response.status, 200);
        assert(body.includes("authentication_failed"));
        assertFalse(body.includes("password"));
        assertFalse(body.includes("private-provider-password"));
        assertEquals(f.calls[1], `relay:${testId}`);
    },
);

Deno.test("unknown relay error strings are discarded", async () => {
    const f = fixture(
        {},
        {status: "failed", error_code: "provider leaked text"},
    );
    const response = await f.handler(f.request());

    assertEquals(await response.json(), {status: "failed", error_code: null});
});