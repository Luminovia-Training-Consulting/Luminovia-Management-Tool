import assert from "node:assert/strict";
import test from "node:test";
import { authorizeReset } from "./admin-local-reset.mjs";

const id = "68fb716d-ffb4-4719-a81a-b332f3e35b08";
const factor = "5f955a4f-a621-4265-a27e-638dd7885810";
const origin = "http://127.0.0.1:54321";
const browser = "browser-token";

function authFixture({
  role = "admin",
  active = true,
  totp = false,
  revoked = false,
} = {}) {
  const calls = [];
  const user = {
    id,
    email: "admin@example.invalid",
    email_confirmed_at: "2026-01-01",
    factors: totp
      ? [{ id: factor, factor_type: "totp", status: "verified" }]
      : [],
  };
  const request = async (url, options) => {
    const path = url.slice(origin.length);
    const token = options.headers.Authorization;
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push([path, token]);
    if (path === "/auth/v1/user") return Response.json(user);
    if (path.startsWith("/rest/v1/profiles?"))
      return Response.json([{ active }]);
    if (path.startsWith("/rest/v1/user_roles?"))
      return Response.json([
        {
          role: revoked && token !== "Bearer " + browser ? "management" : role,
        },
      ]);
    if (path === "/auth/v1/token?grant_type=password") {
      assert.equal(body.email, user.email);
      return body.password === "current password"
        ? Response.json({ user, access_token: "fresh" })
        : Response.json({}, { status: 400 });
    }
    if (path === "/auth/v1/logout?scope=local")
      return new Response(null, { status: 204 });
    assert.fail("Unexpected Auth request");
  };
  return {
    calls,
    authorize: (password = "current password") =>
      authorizeReset(origin, "publishable", browser, password, request),
  };
}

test("accepts active admins and owners only after re-entering their password", async () => {
  for (const role of ["admin", "owner"])
    assert.equal(await authFixture({ role }).authorize(), true);
  for (const settings of [{ role: "management" }, { active: false }]) {
    const fixture = authFixture(settings);
    assert.equal(await fixture.authorize(), false);
    assert.equal(
      fixture.calls.some(([path]) => path.includes("grant_type=password")),
      false,
    );
  }
  assert.equal(await authFixture().authorize("wrong"), false);
  assert.equal(await authFixture({ revoked: true }).authorize(), false);
});

test("legacy account factors do not affect current password-only verification", async () => {
  const fixture = authFixture({ totp: true });
  assert.equal(await fixture.authorize(), true);
  assert.equal(fixture.calls.at(-1)[1], "Bearer fresh");
});
