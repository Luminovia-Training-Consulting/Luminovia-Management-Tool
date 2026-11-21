import assert from "node:assert/strict";
import { type AccountDependencies, createAccountHandler } from "./handler.ts";

const id = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const organisation = "33333333-3333-4333-8333-333333333333";
const origin = "https://academy.example.invalid";
const payload = {
  email: "learner@example.invalid",
  display_name: "Fictional learner",
  role: "participant",
  organisation_id: organisation,
  idempotency_key: "44444444-4444-4444-8444-444444444444",
  mode: "invite",
};

function fixture(overrides: Partial<AccountDependencies> = {}) {
  const calls: string[] = [];
  const handler = createAccountHandler({
    origins: [origin],
    appOrigin: origin,
    openapi: {},
    invitationsEnabled: true,
    authenticate: async () => false,
    authenticateAcademy: async (token) => token === "academy-session",
    rpc: async (_token, name, args) => {
      assert.equal(name, "reserve_academy_account");
      assert.equal(args?.p_role, "participant");
      assert.equal(args?.p_organisation_id, organisation);
      assert.equal(args?.p_mode, "invite");
      assert.ok(!Object.hasOwn(args ?? {}, "password"));
      calls.push("reserve");
      return { data: { status: "reserved", creation_id: id } };
    },
    sendInvitation: async (item, redirect) => {
      assert.equal(item.role, "participant");
      assert.equal(item.organisation_id, organisation);
      assert.equal(redirect, origin + "/auth/callback");
      calls.push("invite");
      return userId;
    },
    completeInvitation: async () => {
      throw new Error("Internal worker not permitted");
    },
    removeCreatedAccount: async (target) => {
      assert.equal(target, userId);
      calls.push("cleanup");
    },
    privilegedRpc: async (name, args) => {
      assert.equal(name, "finish_academy_account");
      assert.equal(args?.p_creation_id, id);
      assert.equal(args?.p_user_id, userId);
      calls.push(String(args?.p_decision));
      return { data: { status: "created", user_id: userId } };
    },
    ...overrides,
  });
  return {
    calls,
    request: (data: unknown = payload, path = "users") =>
      handler(
        new Request(origin + "/functions/v1/accounts/v1/academy/" + path, {
          method: "POST",
          headers: {
            authorization: "Bearer academy-session",
            origin,
            "content-type": "application/json",
          },
          body: JSON.stringify(data),
        }),
      ),
  };
}

Deno.test("academy invitation uses the caller reservation and exact local membership inputs", async () => {
  const f = fixture();
  const result = await f.request();
  assert.equal(result.status, 201);
  assert.deepEqual(await result.json(), { status: "created", user_id: userId });
  assert.deepEqual(f.calls, ["reserve", "invite", "complete"]);
});

Deno.test("company invitation uses the authenticated actor, scoped course and an opaque receipt", async () => {
  const company = {email: payload.email, display_name: payload.display_name,
    idempotency_key: payload.idempotency_key, course_id: organisation};
  const actions: string[] = [];
  const f = fixture({
    resolveAcademyActor: async (token) => token === "academy-session" ? userId : null,
    privilegedRpc: async (name, args) => {
      actions.push(name);
      if (name === "reserve_academy_company_invitation") {
        assert.deepEqual(args, {p_creator: userId, p_course_id: organisation,
          p_email: company.email, p_display_name: company.display_name, p_request_id: company.idempotency_key});
        return {data: {status: "reserved", creation_id: id}};
      }
      assert.equal(name, "finish_academy_account");
      return {data: {status: "created", user_id: userId}};
    },
    sendInvitation: async (item) => {
      assert.equal(item.role, "participant");
      actions.push("email");
      return userId;
    },
  });
  const path = "company-invitations";
  for (const extra of [{actor_id: id}, {role: "client"}, {organisation_id: id}, {password: "Fictional6!Password"}]) {
    assert.equal((await f.request({...company, ...extra}, path)).status, 400);
  }
  assert.deepEqual(actions, []);
  const accepted = await f.request(company, path);
  assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), {status: "requested"});
  assert.deepEqual(actions, ["reserve_academy_company_invitation", "email", "finish_academy_account"]);

  for (const denial of ["PT429", "42501"]) {
    const limited = fixture({resolveAcademyActor: async () => userId,
      privilegedRpc: async () => ({data: null, error: {code: denial}})});
    const response = await limited.request(company, path);
    assert.equal(response.status, denial === "PT429" ? 202 : 403);
    assert.deepEqual(limited.calls, []);
  }
});

Deno.test("academy role injection, a missing organisation and disabled invitation cannot reach Auth", async () => {
  for (
    const input of [
      { ...payload, role: "admin" },
      { ...payload, role: "lecturer" },
      { ...payload, organisation_id: null },
      { ...payload, actor_id: userId },
      { ...payload, password: "Fake1!self" },
    ]
  ) {
    const f = fixture();
    assert.equal((await f.request(input)).status, 400);
    assert.deepEqual(f.calls, []);
  }
  const disabled = fixture({ invitationsEnabled: false });
  assert.equal((await disabled.request()).status, 503);
  assert.deepEqual(disabled.calls, []);
});

Deno.test("a lost completion response recovers the committed academy account without deleting it", async () => {
  const f = fixture({
    privilegedRpc: async (_name, args) =>
      args?.p_decision === "complete"
        ? { data: null, error: { code: "08006" } }
        : { data: { status: "created", user_id: userId } },
  });
  const response = await f.request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "created",
    user_id: userId,
  });
  assert.deepEqual(f.calls, ["reserve", "invite"]);
});

Deno.test("revoked creator receives 403 after a bound compensating Auth deletion", async () => {
  const action: string[] = [];
  const f = fixture({
    privilegedRpc: async (_name, args) => {
      assert.equal(args?.p_user_id, userId);
      action.push(String(args?.p_decision));
      switch (args?.p_decision) {
        case "complete":
          return { data: null, error: { code: "42501" } };
        case "cleanup":
          return { data: { status: "cleanup", user_id: userId } };
        default:
          return { data: { status: "failed" } };
      }
    },
  });
  const response = await f.request();
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "permission_required" });
  assert.deepEqual(f.calls, ["reserve", "invite", "cleanup"]);
  assert.deepEqual(action, ["complete", "cleanup", "discard"]);
});

Deno.test("a fully occupied academy rejects creation before any native Auth or cleanup call", async () => {
  for (
    const [details, expected] of [
      ["academy_seat_limit", "academy_seat_limit"],
      [null, "creation_conflict"],
    ]
  ) {
    const reservations: string[] = [];
    const f = fixture({
      rpc: (_token, name) => {
        reservations.push(name);
        return Promise.resolve({ data: null, error: { code: "PT409", details } });
      },
    });
    const response = await f.request();
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: expected });
    assert.deepEqual(reservations, ["reserve_academy_account"]);
    assert.deepEqual(f.calls, []);
  }
});
