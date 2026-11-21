/** Verify the credential exchange against native Auth in the disposable stack. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { withApiFixture } from "./testing/api.mjs";

await withApiFixture(async ({ actor, checked, url }) => {
  const user = await actor("username-login", "lecturer");
  const alias = "course-" + randomUUID().slice(0, 8);
  await checked(
    user.client.rpc("save_account_username", {
      p_username: alias,
      p_expected_version: 0,
    }),
    "Set the fictional login alias",
  );
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error("Disposable publishable key required");
  const signIn = (identifier, password) =>
    fetch(new URL("functions/v1/human-login", url + "/"), {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
  for (const identifier of [user.email, alias.toUpperCase()]) {
    const response = await signIn(identifier, process.env.E2E_PASSWORD);
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
      global: { headers: { Authorization: `Bearer ${session.access_token}` } },
    });
    const { data, error } = await client.auth.getUser(session.access_token);
    assert.equal(
      Boolean(error),
      false,
      "Native Auth must accept the issued token",
    );
    assert.equal(
      data.user?.id,
      user.id,
      "Alias and email must reach the same Auth identity",
    );
    const { data: own, error: aliasError } =
      await client.rpc("account_username");
    assert.equal(
      Boolean(aliasError),
      false,
      "The token must authorize the caller's own RPC",
    );
    assert.equal(own?.username, alias);
  }
  for (const identifier of [alias, "missing-" + randomUUID().slice(0, 8)]) {
    const response = await signIn(identifier, "FictionalWrongPassword42!");
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "invalid_credentials" });
  }
  console.log(
    "PASS native Auth exchanges username and email for the same account and rejects invalid credentials",
  );
});
