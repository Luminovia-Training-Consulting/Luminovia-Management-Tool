import {assertEquals} from "jsr:@std/assert@1.0.15";
import {createHumanLoginHandler, type LoginDependencies} from "./handler.ts";

const userId = "00000000-0000-4000-8000-000000000001";
const session = {access_token: "access", refresh_token: "refresh", expires_in: 3600, user_id: userId};
function deps(overrides: Partial<LoginDependencies> = {}): LoginDependencies {
  return {
    reserve: async () => true,
    signIn: async (email, password) => email === "lead@example.invalid" && password === "Valid42!" ? session : null,
    active: async () => true,
    ...overrides,
  };
}
function post(identifier: string, password: string, origin?: string) {
  return new Request("https://example.invalid/human-login", {method: "POST", headers: {
    "Content-Type": "application/json", ...(origin ? {Origin: origin} : {}),
  }, body: JSON.stringify({identifier, password})});
}

Deno.test("email produces an Auth session without identity disclosure", async () => {
  const handler = createHumanLoginHandler(deps(), ["https://portal.example.invalid"]);
  for (const identifier of ["lead@example.invalid", " LEAD@EXAMPLE.INVALID "]) {
    const response = await handler(post(identifier, "Valid42!", "https://portal.example.invalid"));
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), "https://portal.example.invalid");
    assertEquals(response.headers.get("Access-Control-Allow-Headers"), "authorization,apikey,content-type,x-client-info");
    assertEquals(await response.json(), {access_token: "access", refresh_token: "refresh", expires_in: 3600, token_type: "bearer"});
  }
});
Deno.test("unknown, wrong password and disabled account share the failure", async () => {
  const handler = createHumanLoginHandler(deps(), []);
  const disabled = createHumanLoginHandler(deps({active: async () => false}), []);
  const outcomes = await Promise.all([
    handler(post("unknown@example.invalid", "Valid42!")),
    handler(post("lead@example.invalid", "Wrong42!")),
    disabled(post("lead@example.invalid", "Valid42!")),
  ]);
  for (const response of outcomes) {
    assertEquals(response.status, 401);
    assertEquals(await response.json(), {error: "invalid_credentials"});
  }
});
Deno.test("a username is rejected even if Auth would return a session", async () => {
  const handler = createHumanLoginHandler(deps({signIn: async () => {throw new Error("username reached Auth");}}), []);
  const response = await handler(post("missing.alias", "Valid42!"));
  assertEquals(response.status, 401);
  assertEquals(await response.json(), {error: "invalid_credentials"});
});
Deno.test("rate cap, disallowed origin and malformed payload do not issue sessions", async () => {
  let calls = 0;
  const handler = createHumanLoginHandler(deps({reserve: async () => false, signIn: async () => {calls++; return session;}}), ["https://portal.example.invalid"]);
  assertEquals((await handler(post("lead@example.invalid", "Valid42!"))).status, 429);
  assertEquals((await handler(post("lead@example.invalid", "Valid42!", "https://evil.example.invalid"))).status, 403);
  assertEquals((await handler(new Request("https://example.invalid/human-login", {method: "POST", headers: {"Content-Type": "application/json"}, body: "{"}))).status, 400);
  assertEquals(calls, 0);
});

Deno.test("Auth throttling and transient infrastructure failures have distinct safe responses", async () => {
  const rateLimited = createHumanLoginHandler(deps({signIn: async () => "rate_limited"}), []);
  const unavailable = createHumanLoginHandler(deps({
    active: async () => { throw new Error("private database detail"); },
  }), []);
  for (const [handler, status, error] of [
    [rateLimited, 429, "rate_limited"],
    [unavailable, 503, "login_unavailable"],
  ] as const) {
    const response = await handler(post("lead@example.invalid", "Valid42!"));
    assertEquals(response.status, status);
    assertEquals(await response.json(), {error});
  }
});
