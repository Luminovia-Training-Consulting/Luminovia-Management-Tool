/** Verify the credential exchange against native Auth in the disposable stack. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { withApiFixture } from "./testing/api.mjs";

await withApiFixture(async ({ actor, url, recoveryEndpoints }) => {
  const user = await actor("email-login", "lecturer");
  const alias = "course-" + randomUUID().slice(0, 8);
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error("Disposable publishable key required");
  const signIn = (identifier, password) =>
    fetch(new URL("functions/v1/human-login", url + "/"), {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
  const signedIn = await Promise.all(
    [user.email, user.email.toUpperCase(), user.email].map((identifier) =>
      signIn(identifier, process.env.E2E_PASSWORD),
    ),
  );
  const sessions = [];
  const sessionIds = new Set();
  for (const response of signedIn) {
    assert.equal(
      response.status,
      200,
      "Human login must establish an Auth session",
    );
    assert.match(response.headers.get("Cache-Control") ?? "", /no-store/i);
    const session = await response.json();
    assert.ok(
      typeof session.access_token === "string" &&
        session.access_token.length > 0,
    );
    const client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const installed = await client.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    assert.ok(installed.data.session && !installed.error, "A fresh device can install its own session");
    const claims = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString());
    assert.match(claims.session_id, /^[a-f0-9-]{36}$/i);
    sessionIds.add(claims.session_id);
    sessions.push(client);
    const { data, error } = await client.auth.getUser();
    assert.equal(
      Boolean(error),
      false,
      "Native Auth must accept the issued token",
    );
    assert.equal(
      data.user?.id,
      user.id,
      "Email login must reach the original Auth identity",
    );
    const retired = await client.rpc("account_username");
    assert.ok(retired.error, "The old alias endpoint must be inaccessible");
  }
  assert.equal(sessionIds.size, 3, "Concurrent password exchanges create independent sessions");
  const refresh = async (client) => {
    const result = await client.auth.refreshSession();
    assert.ok(!result.error && result.data.user?.id === user.id, "This device can refresh its session");
    return result.data.session.refresh_token;
  };
  await Promise.all(sessions.map(refresh));
  const [first, ...others] = sessions;
  const revoked = await refresh(first);
  assert.equal((await first.auth.signOut({ scope: "local" })).error, null);
  const rejected = await first.auth.refreshSession({ refresh_token: revoked });
  assert.ok(rejected.error, "The signed-out device's token can no longer refresh");
  await Promise.all(others.map(refresh));
  console.log("PASS three concurrent native sessions refresh independently after device-only sign-out");
  assert.equal((await signIn(alias, process.env.E2E_PASSWORD)).status, 401);
  for (const identifier of [alias, "missing-" + randomUUID().slice(0, 8)]) {
    const response = await signIn(identifier, "FictionalWrongPassword42!");
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "invalid_credentials" });
  }
  const origin = process.env.PORTAL_APP_ORIGIN ?? recoveryEndpoints.appOrigin;
  const mailpit = new URL(
    process.env.E2E_MAILPIT_URL ?? recoveryEndpoints.mailpitOrigin,
  );
  assert.equal(origin, recoveryEndpoints.appOrigin);
  assert.equal(mailpit.href, new URL(recoveryEndpoints.mailpitOrigin).href);
  const verifier = randomBytes(42).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const recoverUrl = new URL("auth/v1/recover", url + "/");
  recoverUrl.searchParams.set("redirect_to", origin + "/auth/callback");
  const submitted = await fetch(
    recoverUrl,
    {
      method: "POST",
      headers: {
        apikey: key,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: user.email,
        code_challenge: challenge,
        code_challenge_method: "s256",
      }),
    },
  );
  assert.equal(submitted.status, 200);
  let captured;
  for (let index = 0; index < 40 && !captured; index++) {
    const response = await fetch(new URL("/api/v1/messages", mailpit));
    assert.equal(response.status, 200);
    const inbox = await response.json();
    captured = inbox.messages.find((message) =>
      message.To.some((recipient) => recipient.Address === user.email),
    );
    if (!captured) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(
    captured,
    "The fictional account receives a recovery email in Mailpit",
  );
  const message = await (
    await fetch(new URL("/api/v1/message/" + captured.ID, mailpit))
  ).json();
  const href = /href="([^"]+)"/
    .exec(message.HTML)?.[1]
    ?.replaceAll("&amp;", "&");
  assert.ok(href, "The captured message includes the recovery link");
  const confirmation = new URL(href);
  const expected = new URL(recoveryEndpoints.confirmationUrl);
  assert.equal(confirmation.origin, expected.origin);
  assert.equal(confirmation.pathname, expected.pathname);
  assert.equal(confirmation.username, "");
  assert.equal(confirmation.password, "");
  const verified = await fetch(confirmation, { redirect: "manual" });
  const callback = new URL(verified.headers.get("location") ?? "", origin);
  assert.equal(callback.origin, origin);
  assert.equal(callback.pathname, "/auth/callback");
  const code = callback.searchParams.get("code");
  assert.ok(code, "Native Auth returns a one-time PKCE authorization code");
  const exchange = await fetch(
    new URL("auth/v1/token?grant_type=pkce", url + "/"),
    {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    },
  );
  assert.equal(exchange.status, 200);
  const recovery = await exchange.json();
  assert.equal(recovery.user?.id, user.id);
  console.log(
    "PASS one-time email recovery through native Auth, PKCE and fictional Mailpit delivery",
  );

  console.log(
    "PASS native Auth accepts email and rejects username sign-in and invalid credentials",
  );
});
