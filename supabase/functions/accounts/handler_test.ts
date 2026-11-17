/**
 * Account HTTP cases inject Auth/RPC/delivery with fictional UUIDs. Exercise methods, input, caller propagation and reservation; native Auth/RLS is checked separately.
 */
import assert from "node:assert/strict";
import {
  type AccountDependencies,
  createAccountHandler,
  parseInvitation,
} from "./handler.ts";
import { accountOpenApi } from "./openapi.ts";
const id = "44444444-4444-4444-8444-444444444444";
const key = "55555555-5555-4555-8555-555555555555";
// The permanent-delete facade must preserve explicit confirmation and bind all
// execution to the database-issued operation, never a submitted actor/path.
Deno.test(
  "deletion rejects unconfirmed or injected requests before any RPC",
  async () => {
    const { handler, request, calls } = fixture();
    for (const payload of [
      { plan_id: id, request_id: key },
      { plan_id: id, request_id: key, confirmation: "yes" },
      { plan_id: id, request_id: key, confirmation: "DELETE", actor_id: id },
    ]) {
      calls.length = 0;
      assert.equal(
        (await handler(request("v1/deletions/confirm", "POST", payload)))
          .status,
        400,
      );
      assert.deepEqual(calls, ["authenticate"]);
    }
    assert.equal(
      (await handler(request("v1/deletions/operations/invalid", "POST", {})))
        .status,
      400,
    );
    assert.equal(
      (
        await handler(
          request(`v1/deletions/operations/${id}`, "POST", { paths: [] }),
        )
      ).status,
      400,
    );
  },
);
Deno.test(
  "confirmed operation uses caller token and reports pending until worker completion",
  async () => {
    let complete = false;
    const { handler, request } = fixture({
      rpc: async (token, name, args) => {
        assert.equal(token, "test-token");
        assert.equal(name, "deletion_confirm");
        assert.deepEqual(args, {
          p_plan_id: id,
          p_request_id: key,
          p_confirmation: "DELETE",
        });
        return {
          data: { operation_id: key, status: "pending", kind: "job", id },
        };
      },
      executeDeletion: async (token, operationId) => {
        assert.equal(token, "test-token");
        assert.equal(operationId, key);
        return {
          operation_id: key,
          status: complete ? "completed" : "pending",
          kind: "job",
          id,
        };
      },
    });
    const payload = { plan_id: id, request_id: key, confirmation: "DELETE" };
    const pending = await handler(
      request("v1/deletions/confirm", "POST", payload),
    );
    assert.equal(pending.status, 202);
    assert.equal((await pending.json()).status, "pending");
    complete = true;
    assert.equal(
      (await handler(request(`v1/deletions/operations/${key}`, "POST", {})))
        .status,
      200,
    );
  },
);
Deno.test(
  "deletion conflicts, permission loss and worker outages never return success",
  async () => {
    for (const [code, status] of [
      ["42501", 403],
      ["40001", 409],
      ["23503", 409],
      ["22023", 400],
      ["XX000", 503],
    ] as const) {
      const { handler, request } = fixture({
        rpc: async () => ({ data: null, error: { code } }),
      });
      assert.equal(
        (
          await handler(
            request("v1/deletions/preview", "POST", { kind: "job", id }),
          )
        ).status,
        status,
      );
    }
    const { handler, request } = fixture({
      executeDeletion: async () => {
        throw new Error("deletion_unavailable");
      },
    });
    const failed = await handler(
      request(`v1/deletions/operations/${id}`, "POST", {}),
    );
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { error: "deletion_unavailable" });
  },
);
Deno.test(
  "deletion target list bounds and exact kind dispatch stay caller scoped",
  async () => {
    const { handler, request, calls } = fixture({
      rpc: async (token, name, args) => {
        assert.equal(token, "test-token");
        assert.equal(name, "deletion_resources");
        assert.deepEqual(args, {
          p_kind: "job",
          p_query: "Own",
          p_cursor: null,
          p_limit: 25,
        });
        return { data: { items: [], next_cursor: null } };
      },
    });
    for (const path of [
      "kind=jobs;drop",
      "kind=job&limit=101",
      "kind=job&cursor=forged",
    ]) {
      assert.equal(
        (await handler(request(`v1/deletions/resources?${path}`))).status,
        400,
      );
    }
    assert.equal(
      (await handler(request("v1/deletions/resources?kind=job&q=Own"))).status,
      200,
    );
    assert.ok(calls.length > 0);
  },
);
Deno.test(
  "committed confirmation retains an operation receipt when external cleanup fails",
  async () => {
    const { handler, request } = fixture({
      rpc: async () => ({
        data: { operation_id: key, kind: "document", id, status: "pending" },
      }),
      executeDeletion: async () => {
        throw new Error("deletion_unavailable");
      },
    });
    const result = await handler(
      request("v1/deletions/confirm", "POST", {
        plan_id: id,
        request_id: key,
        confirmation: "DELETE",
      }),
    );
    assert.equal(result.status, 202);
    assert.deepEqual(await result.json(), {
      operation_id: key,
      kind: "document",
      id,
      status: "pending",
    });
  },
);
Deno.test(
  "completed confirmation retries do not depend on external providers",
  async () => {
    const { handler, request } = fixture({
      rpc: async () => ({
        data: { operation_id: key, kind: "document", id, status: "completed" },
      }),
      executeDeletion: async () => {
        throw new Error("must_not_execute");
      },
    });
    const result = await handler(
      request("v1/deletions/confirm", "POST", {
        plan_id: id,
        request_id: key,
        confirmation: "DELETE",
      }),
    );
    assert.equal(result.status, 200);
    assert.equal((await result.json()).status, "completed");
  },
);
// Create controlled owned fixtures with replaceable external responses.
function fixture(overrides: Partial<AccountDependencies> = {}) {
  const calls: string[] = [];
  const handler = createAccountHandler({
    origins: ["http://127.0.0.1:5273"],
    appOrigin: "http://127.0.0.1:5273",
    invitationsEnabled: true,
    openapi: accountOpenApi,
    authenticate: async () => {
      calls.push("authenticate");
      return true;
    },
    rpc: async (_token, name) => {
      calls.push(name);
      return {
        data:
          name === "reserve_account_invitation"
            ? { status: "reserved", invitation_id: id }
            : { ok: true },
        error: null,
      };
    },
    sendInvitation: async () => {
      calls.push("send");
      return id;
    },
    completeInvitation: async (_id, _user, _name, success) => {
      calls.push(success ? "complete" : "fail");
    },
    ...overrides,
  });
  const request = (
    path: string,
    method = "GET",
    payload?: unknown,
    headers: Record<string, string> = {},
  ) =>
    new Request(`http://localhost/functions/v1/accounts/${path}`, {
      method,
      headers: {
        Authorization: "Bearer test-token",
        ...(payload === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  return { handler, calls, request };
}
Deno.test(
  "invite contracts bind roles/organisation and reject actor/permission injection",
  () => {
    assert.equal(
      parseInvitation({
        email: " A@example.invalid ",
        role: "lecturer",
        idempotency_key: key,
      })?.email,
      "a@example.invalid",
    );
    assert.equal(
      parseInvitation({
        email: "a@example.invalid",
        role: "client",
        idempotency_key: key,
      })?.organisation_id,
      null,
    );
    assert.equal(
      parseInvitation({
        email: "a@example.invalid",
        role: "lecturer",
        organisation_id: id,
        idempotency_key: key,
      }),
      null,
    );
    assert.equal(
      parseInvitation({
        email: "a@example.invalid",
        role: "lecturer",
        actor_id: id,
        idempotency_key: key,
      }),
      null,
    );
    assert.equal(
      parseInvitation({
        email: "a@example.invalid",
        role: "superadmin",
        idempotency_key: key,
      }),
      null,
    );
  },
);
Deno.test(
  "valid bearer CLI requests work without Origin; foreign origins fail before auth",
  async () => {
    const { handler, request, calls } = fixture();
    assert.equal((await handler(request("v1/me"))).status, 200);
    assert.deepEqual(calls, ["authenticate", "account_me"]);
    calls.length = 0;
    assert.equal(
      (
        await handler(
          request("v1/me", "GET", undefined, {
            Origin: "https://foreign.invalid",
          }),
        )
      ).status,
      403,
    );
    assert.equal(calls.length, 0);
    const preflight = await handler(
      new Request("http://localhost/accounts/v1/me", {
        method: "OPTIONS",
        headers: { Origin: "http://127.0.0.1:5273" },
      }),
    );
    assert.equal(preflight.status, 204);
    assert.match(
      preflight.headers.get("Access-Control-Allow-Methods")!,
      /DELETE/,
    );
  },
);
Deno.test(
  "missing and inactive credentials cannot reach account data",
  async () => {
    const { handler, calls } = fixture({ authenticate: async () => false });
    assert.equal(
      (await handler(new Request("http://localhost/accounts/v1/me"))).status,
      401,
    );
    assert.equal(calls.length, 0);
    assert.equal(
      (
        await handler(
          new Request("http://localhost/accounts/v1/me", {
            headers: { Authorization: "Bearer invalid" },
          }),
        )
      ).status,
      401,
    );
    assert.equal(calls.length, 0);
  },
);
Deno.test(
  "directory pagination and role IDs reject malformed payloads before mutation",
  async () => {
    const { handler, request, calls } = fixture();
    assert.equal((await handler(request("v1/users?limit=null"))).status, 400);
    assert.equal((await handler(request("v1/users?offset=-1"))).status, 400);
    assert.equal(
      (
        await handler(
          request("v1/users/not-a-uuid/roles", "PUT", { roles: ["admin"] }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await handler(
          request(`v1/users/${id}/roles`, "PUT", {
            roles: ["admin"],
            actor_id: id,
          }),
        )
      ).status,
      400,
    );
    assert.equal(
      calls.some((name) => name === "set_account_roles"),
      false,
    );
  },
);
Deno.test(
  "database permission rejection remains a real forbidden response",
  async () => {
    const { handler, request } = fixture({
      rpc: async () => ({ data: null, error: { code: "42501" } }),
    });
    const response = await handler(
      request(`v1/users/${id}/roles`, "PUT", { roles: ["admin"] }),
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "permission_required",
    });
  },
);
Deno.test(
  "invitation durable reservation precedes external send and server completion",
  async () => {
    const { handler, request, calls } = fixture();
    const response = await handler(
      request("v1/invitations", "POST", {
        email: "new@example.invalid",
        role: "participant",
        idempotency_key: key,
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      "authenticate",
      "reserve_account_invitation",
      "send",
      "complete",
    ]);
    assert.equal((await response.json()).status, "sent");
  },
);
Deno.test(
  "durable retry/conflict/throttle results never send another email",
  async () => {
    for (const status of [
      "already_sent",
      "in_progress",
      "failed",
      "idempotency_conflict",
      "throttled",
    ]) {
      const { handler, request, calls } = fixture({
        rpc: async () => ({ data: { status, invitation_id: id } }),
      });
      const response = await handler(
        request("v1/invitations", "POST", {
          email: "new@example.invalid",
          role: "participant",
          idempotency_key: key,
        }),
      );
      assert.equal(
        response.status,
        status === "throttled"
          ? 429
          : status === "idempotency_conflict"
            ? 409
            : 200,
      );
      assert.equal(calls.includes("send"), false);
    }
  },
);
Deno.test(
  "uncertain send records failure; uncertain completion never reports sent",
  async () => {
    const failure = fixture({
      sendInvitation: async () => {
        throw new Error("uncertain network");
      },
    });
    const body = {
      email: "new@example.invalid",
      role: "participant",
      idempotency_key: key,
    };
    assert.equal(
      (await failure.handler(failure.request("v1/invitations", "POST", body)))
        .status,
      502,
    );
    assert.equal(failure.calls.includes("fail"), true);
    const uncertain = fixture({
      completeInvitation: async () => {
        throw new Error("completion unavailable");
      },
    });
    assert.equal(
      (
        await uncertain.handler(
          uncertain.request("v1/invitations", "POST", body),
        )
      ).status,
      503,
    );
    assert.equal(uncertain.calls.includes("send"), true);
  },
);
Deno.test(
  "bounded JSON bodies and wrong methods never masquerade as a saved account",
  async () => {
    const { handler, request, calls } = fixture();
    assert.equal(
      (await handler(request("v1/me", "PATCH", { bio_de: "x".repeat(17000) })))
        .status,
      413,
    );
    assert.equal(
      (
        await handler(
          new Request("http://localhost/accounts/v1/me", {
            method: "PATCH",
            headers: {
              Authorization: "Bearer token",
              "Content-Type": "text/plain",
            },
            body: "{}",
          }),
        )
      ).status,
      415,
    );
    assert.equal(
      (
        await handler(
          request(`v1/users/${id}/status`, "PATCH", {
            active: false,
            role: "admin",
          }),
        )
      ).status,
      400,
    );
    assert.equal(calls.includes("set_user_active"), false);
    assert.equal((await handler(request("v1/me", "POST", {}))).status, 405);
    assert.equal((await handler(request("v1/unknown"))).status, 404);
  },
);
Deno.test(
  "client organisation assignment/revocation dispatch exact current actor RPC",
  async () => {
    const seen: unknown[] = [];
    const { handler, request } = fixture({
      rpc: async (_token, name, args) => {
        seen.push({ name, args });
        return { data: null };
      },
    });
    for (const method of ["PUT", "DELETE"]) {
      assert.equal(
        (await handler(request(`v1/users/${id}/organisations/${key}`, method)))
          .status,
        200,
      );
    }
    assert.deepEqual(seen, [
      {
        name: "manage_client_organisation",
        args: { p_user_id: id, p_organisation_id: key, p_remove: false },
      },
      {
        name: "manage_client_organisation",
        args: { p_user_id: id, p_organisation_id: key, p_remove: true },
      },
    ]);
  },
);
Deno.test(
  "OpenAPI is a non-secret schema and all data responses disable caching",
  async () => {
    const { handler, request } = fixture();
    const schema = await handler(
      new Request("http://localhost/accounts/openapi.json"),
    );
    assert.equal(schema.status, 200);
    assert.equal((await schema.json()).openapi, "3.1.0");
    const response = await handler(request("v1/me"));
    assert.match(response.headers.get("Cache-Control")!, /no-store/);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  },
);
