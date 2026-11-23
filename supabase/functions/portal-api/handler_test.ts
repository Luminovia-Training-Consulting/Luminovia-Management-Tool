import { assertEquals } from "jsr:@std/assert@1.0.15";
import { createPortalHttpHandler } from "./handler.ts";

const actor = "9c0c48a1-8bde-41d4-835a-f66a4cfbe378";
const origin = "http://127.0.0.1:5173";
const example = "https://portal.example.invalid/functions/v1/portal-api/v1";
const backend = "http://owned-gateway.invalid:8000";
const key = "configured-public-key";
const bearer = "Bearer caller-token";

function fixture(
  response?: () => Response,
  authenticate = () => Response.json({ id: actor }),
) {
  const calls: Request[] = [];
  const handle = createPortalHttpHandler({
    backend,
    publicKey: key,
    origins: [origin, "https://portal.example.invalid"],
    operations: {
      example_read: "GET",
      example_save: "PUT",
      example_remove: "DELETE",
    },
    putTargets: { example_save: "p_id" },
    putVersions: { example_save: "p_expected_revision" },
    transport: (input, init) => {
      const call = new Request(input, init);
      calls.push(call);
      return Promise.resolve(
        call.url.endsWith("/auth/v1/user") ? authenticate() : response?.() ??
          Response.json({ receipt: "confirmed" }),
      );
    },
  });
  return { handle, calls };
}

Deno.test("GET, PUT and DELETE preserve caller authorization and arguments in the native RPC", async () => {
  const args = {
    p_id: actor,
    p_request_id: "ec357fc7-2ed1-4750-b6a2-f8eb5d417572",
    p_expected_revision: 3,
    p_content: {
      labels: ["Überblick", "A + B"],
      retired: false,
      optional: null,
    },
  };
  const json = JSON.stringify(args);
  for (
    const [method, operation] of [
      ["GET", "example_read"],
      ["PUT", "example_save"],
      ["DELETE", "example_remove"],
    ] as const
  ) {
    const { handle, calls } = fixture();
    const url = new URL(
      method === "DELETE"
        ? "https://portal.example.invalid/portal-api/v1/" + operation
        : example + "/" + operation,
    );
    if (method === "GET") url.searchParams.set("input", json);
    const response = await handle(
      new Request(url, {
        method,
        headers: {
          origin,
          authorization: bearer,
          apikey: "spoofed",
          cookie: "ambient=token",
          "x-http-method-override": "PATCH",
          "content-profile": "private",
          "content-type": "application/json",
        },
        ...(method === "GET" ? {} : { body: json }),
      }),
    );
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { receipt: "confirmed" });
    assertEquals(response.headers.get("cache-control"), "no-store, private");
    assertEquals(response.headers.get("access-control-allow-origin"), origin);
    assertEquals(calls.length, 2);
    assertEquals(calls[0].url, backend + "/auth/v1/user");
    assertEquals(calls[0].method, "GET");
    const rpc = calls[1];
    assertEquals(rpc.url, backend + "/rest/v1/rpc/" + operation);
    assertEquals(rpc.method, "POST");
    assertEquals(rpc.redirect, "error");
    assertEquals(rpc.headers.get("authorization"), bearer);
    assertEquals(rpc.headers.get("apikey"), key);
    assertEquals(rpc.headers.get("cookie"), null);
    assertEquals(rpc.headers.get("content-profile"), null);
    assertEquals(rpc.headers.get("x-http-method-override"), null);
    assertEquals(await rpc.json(), args);
  }
});

Deno.test("JSON numeric precision is preserved when passing arguments", async () => {
  const { handle, calls } = fixture();
  const body =
    ` {"p_id":"${actor}","p_expected_revision":3,"p_amount":123456789123456789.123} `;
  const response = await handle(
    new Request(example + "/example_save", {
      method: "PUT",
      body,
      headers: {
        authorization: bearer,
        "content-type": "application/json",
      },
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(await calls[1].text(), body);
});

Deno.test("scoped CORS preflight and a no-Origin integration client work", async () => {
  const { handle, calls } = fixture(() => new Response(null, { status: 204 }));
  const preflight = await handle(
    new Request(example + "/example_remove", {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "DELETE",
        "access-control-request-headers": "authorization,content-type,apikey",
      },
    }),
  );
  assertEquals(preflight.status, 204);
  assertEquals(preflight.headers.get("access-control-allow-origin"), origin);
  assertEquals(
    preflight.headers.get("access-control-allow-methods"),
    "DELETE, OPTIONS",
  );
  assertEquals(preflight.headers.get("vary"), "Origin");
  assertEquals(calls.length, 0);

  const terminal = await handle(
    new Request(example + "/example_remove", {
      method: "DELETE",
      headers: { authorization: bearer },
    }),
  );
  assertEquals(terminal.status, 204);
  assertEquals(terminal.headers.get("access-control-allow-origin"), null);
  assertEquals(await calls[1].json(), {});
});

Deno.test("unknown routes, mismatched methods, disallowed origins and invalid inputs never reach Auth or RPC", async () => {
  const { handle, calls } = fixture();
  const headers = {
    authorization: bearer,
    "content-type": "application/json",
  };
  const lookups = [
    [new Request(example + "/constructor", { headers }), 404, "not_found"],
    [
      new Request(example + "/example_read/more", { headers }),
      404,
      "not_found",
    ],
    [
      new Request(example + "/example_read", { method: "DELETE", headers }),
      405,
      "method_not_allowed",
    ],
    [new Request(example + "/example_read"), 401, "authentication_required"],
    [
      new Request(example + "/example_read", {
        headers: { ...headers, origin: "https://evil.example.invalid" },
      }),
      403,
      "origin_not_allowed",
    ],
    [
      new Request(example + "/example_read?input=%7B%7D&input=%7B%7D", {
        headers,
      }),
      400,
      "invalid_request",
    ],
    [
      new Request(example + "/example_read?unknown=%7B%7D", { headers }),
      400,
      "invalid_request",
    ],
    [
      new Request(example + "/example_read?input=%5B%5D", { headers }),
      400,
      "invalid_request",
    ],
    [
      new Request(example + "/example_read?input=" + "a".repeat(17 * 1024), {
        headers,
      }),
      414,
      "request_uri_too_large",
    ],
    [
      new Request(example + "/example_save?input=%7B%7D", {
        method: "PUT",
        headers,
        body: "{}",
      }),
      400,
      "invalid_request",
    ],
    [
      new Request(example + "/example_save", {
        method: "PUT",
        headers,
        body: `{"p_id":null}`,
      }),
      400,
      "existing_record_id_required",
    ],
    [
      new Request(example + "/example_save", {
        method: "PUT",
        headers,
        body: `{"p_id":"not-an-id"}`,
      }),
      400,
      "existing_record_id_required",
    ],
    [
      new Request(example + "/example_save", {
        method: "PUT",
        headers,
        body: JSON.stringify({ p_id: actor, p_expected_revision: 0 }),
      }),
      400,
      "existing_record_version_required",
    ],
    [
      new Request(example + "/example_save", {
        method: "PUT",
        headers,
        body: "{",
      }),
      400,
      "invalid_request",
    ],
    [
      new Request(example + "/example_remove", {
        method: "DELETE",
        headers: { ...headers, "content-type": "text/plain" },
        body: "{}",
      }),
      415,
      "unsupported_media_type",
    ],
    [
      new Request(example + "/example_remove", {
        method: "DELETE",
        headers,
        body: " ".repeat(1024 * 1024 + 1),
      }),
      413,
      "request_too_large",
    ],
  ] as const;
  for (const [request, status, error] of lookups) {
    const result = await handle(request);
    assertEquals(result.status, status, request.url);
    assertEquals(await result.json(), { error });
    if (status === 405) {
      assertEquals(result.headers.get("allow"), "GET, OPTIONS");
    }
    if (status === 403) {
      assertEquals(result.headers.get("access-control-allow-origin"), null);
    }
  }
  assertEquals(calls.length, 0);
});

Deno.test("invalid sessions stop dispatch; live callers receive native denials and conflicts", async () => {
  const request = () =>
    new Request(example + "/example_read", {
      headers: { authorization: bearer },
    });
  const denied = fixture(
    undefined,
    () => Response.json({ message: "invalid JWT" }, { status: 403 }),
  );
  const noIdentity = fixture(undefined, () => Response.json({ role: "anon" }));
  for (const { handle, calls } of [denied, noIdentity]) {
    const result = await handle(request());
    assertEquals(result.status, 401);
    assertEquals(await result.json(), { error: "authentication_required" });
    assertEquals(calls.length, 1);
  }

  for (
    const [status, code, expectedStatus] of [
      [403, "42501", 403],
      [409, "PT409", 409],
      [500, "40001", 409],
      [500, "XX000", 500],
    ] as const
  ) {
    const { handle, calls } = fixture(() =>
      Response.json({ code }, {
        status,
        headers: { "Set-Cookie": "unwanted=1" },
      })
    );
    const result = await handle(request());
    assertEquals(result.status, expectedStatus);
    assertEquals(await result.json(), { code });
    assertEquals(result.headers.get("set-cookie"), null);
    assertEquals(calls.length, 2);
  }
  const wrongContent = fixture(() => new Response("<html>proxy</html>"));
  const result = await wrongContent.handle(request());
  assertEquals(result.status, 502);
  assertEquals(await result.json(), { error: "upstream_unavailable" });
});

Deno.test("multi-action RPCs accept only the branch assigned to the HTTP method", async () => {
  const { handle, calls } = fixture();
  const request = (method: string, operation: string, payload: object) =>
    new Request(example + "/" + operation, {
      method,
      headers: { authorization: bearer, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

  const rejectedRemoval = await handle(
    request("DELETE", "manage_wiki_attachment", { p_remove: false }),
  );
  assertEquals(rejectedRemoval.status, 400);
  assertEquals(await rejectedRemoval.json(), { error: "action_not_allowed" });
  assertEquals(rejectedRemoval.headers.get("allow"), "PUT, DELETE, OPTIONS");
  assertEquals(
    (await handle(request("PUT", "manage_global_event", {
      p_id: null,
      p_action: "save",
      p_expected_version: 0,
    }))).status,
    400,
  );
  assertEquals(
    (await handle(request("PUT", "update_support_ticket", { p_action: "reply" })))
      .status,
    400,
  );
  assertEquals(calls.length, 0);

  const args = { p_page_id: actor, p_version_id: actor, p_revision: 3, p_remove: true };
  assertEquals(
    (await handle(request("DELETE", "manage_wiki_attachment", args))).status,
    200,
  );
  assertEquals(calls[1].url, backend + "/rest/v1/rpc/manage_wiki_attachment");
  assertEquals(await calls[1].json(), args);
});
