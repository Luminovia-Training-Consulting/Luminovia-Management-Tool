/** Actual owner capabilities through Auth/REST and both Edge routing layers. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { withApiFixture } from "./testing/api.mjs";
await withApiFixture(async ({ actor, service, checked, defer, url }) => {
  const owner = await actor("calendar-feed-owner", "lecturer"),
    peer = await actor("calendar-feed-peer", "lecturer");
  const ownEvent = randomUUID(),
    foreignEvent = randomUUID();
  defer(async () => {
    await checked(
      service
        .from("personal_events")
        .delete()
        .in("id", [ownEvent, foreignEvent]),
      "Delete exact private calendar fixtures before account cleanup",
    );
  });
  const begins = new Date(Date.now() + 3 * 86400000).toISOString(),
    ends = new Date(Date.now() + 3 * 86400000 + 3600000).toISOString();
  await checked(
    service.from("personal_events").insert([
      {
        id: ownEvent,
        user_id: owner.id,
        title: "Fictional private calendar appointment",
        starts_at: begins,
        ends_at: ends,
        time_zone: "Europe/Berlin",
      },
      {
        id: foreignEvent,
        user_id: peer.id,
        title: "FOREIGN SECRET APPOINTMENT",
        starts_at: begins,
        ends_at: ends,
        time_zone: "Europe/Berlin",
      },
    ]),
    "Create owned feed fixtures",
  );
  const token = randomBytes(32).toString("hex"),
    request = randomUUID();
  const payload = {
    p_id: null,
    p_label: "Fictional subscription",
    p_include_private: false,
    p_token: token,
    p_expected_version: 0,
    p_client_id: request,
  };
  const created = await checked(
    owner.client.rpc("save_calendar_subscription", payload),
    "Create actual capability subscription",
  );
  assert.equal(created.include_private, false);
  assert.deepEqual(
    await checked(peer.client.rpc("my_calendar_subscriptions")),
    [],
  );
  assert.ok(
    !JSON.stringify(
      await checked(owner.client.rpc("my_calendar_subscriptions")),
    ).includes(token),
  );
  assert.equal(
    (
      await peer.client.rpc("revoke_calendar_subscription", {
        p_id: created.id,
        p_expected_version: 1,
      })
    ).error?.code,
    "42501",
  );
  const endpoint = new URL("/functions/v1/calendar-feed", url);
  const fetchFeed = (secret) => {
    const target = new URL(endpoint);
    target.searchParams.set("token", secret);
    return fetch(target, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  };
  const initial = await fetchFeed(token);
  assert.equal(
    initial.status,
    200,
    "Feed works without a bearer token or API key",
  );
  assert.match(initial.headers.get("content-type"), /^text\/calendar/);
  assert.ok(initial.headers.get("cache-control").includes("no-store"));
  assert.equal(initial.headers.get("referrer-policy"), "no-referrer");
  assert.equal(initial.headers.get("set-cookie"), null);
  assert.equal(initial.headers.get("location"), null);
  const empty = await initial.text();
  assert.ok(!empty.includes("Fictional private calendar appointment"));
  assert.ok(!empty.includes(token));
  const changedToken = randomBytes(32).toString("hex"),
    rotation = {
      p_id: created.id,
      p_label: "Fictional explicit private feed",
      p_include_private: true,
      p_token: changedToken,
      p_expected_version: created.version,
      p_client_id: randomUUID(),
    };
  const rotated = await checked(
    owner.client.rpc("save_calendar_subscription", rotation),
    "Rotate with private opt-in",
  );
  assert.deepEqual(
    await checked(owner.client.rpc("save_calendar_subscription", rotation)),
    rotated,
  );
  assert.equal((await fetchFeed(token)).status, 404);
  const privateResponse = await fetchFeed(changedToken);
  assert.equal(privateResponse.status, 200);
  const calendar = await privateResponse.text();
  assert.ok(calendar.includes("Fictional private calendar appointment"));
  assert.ok(!calendar.includes("FOREIGN SECRET APPOINTMENT"));
  assert.ok(!calendar.includes(changedToken));
  assert.ok(!calendar.includes(owner.id));
  assert.ok(!calendar.includes("AUTHORIZATION"));
  for (const suffix of [
    "",
    "?token=invalid",
    `?token=${"f".repeat(64)}`,
    `?token=${changedToken}&extra=1`,
  ]) {
    const invalid = await fetch(endpoint.href + suffix, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(invalid.status, 404);
    assert.equal(await invalid.text(), "calendar_unavailable");
    assert.ok(invalid.headers.get("cache-control").includes("no-store"));
  }
  const wrongMethod = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
  });
  // The owned native fixture validates its exact candidate identity before
  // reaching this test. Its router exempts only GET from JWT verification.
  // CLI verify_jwt=false reaches the capability handler for every method;
  // that handler refuses POST before any token lookup. Assert each precise
  // runtime contract instead of accepting an arbitrary denial status.
  const nativeRouter = process.env.PORTAL_CANDIDATE_OWNER !== undefined;
  assert.equal(wrongMethod.status, nativeRouter ? 401 : 405);
  if (!nativeRouter) {
    assert.equal(wrongMethod.headers.get("allow"), "GET");
    assert.ok(wrongMethod.headers.get("cache-control").includes("no-store"));
    assert.equal(await wrongMethod.text(), "method_not_allowed");
  }
  const session = await checked(owner.client.auth.getSession());
  const authenticatedWrongMethod = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.session.access_token}`,
    },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(authenticatedWrongMethod.status, 405);
  assert.equal(authenticatedWrongMethod.headers.get("allow"), "GET");
  assert.ok(
    authenticatedWrongMethod.headers.get("cache-control").includes("no-store"),
  );
  assert.equal(await authenticatedWrongMethod.text(), "method_not_allowed");
  await checked(
    owner.client.rpc("revoke_calendar_subscription", {
      p_id: created.id,
      p_expected_version: rotated.version,
    }),
    "Revoke live capability",
  );
  const revoked = await fetchFeed(changedToken);
  assert.equal(revoked.status, 404);
  assert.equal(await revoked.text(), "calendar_unavailable");
  console.log(
    "PASS actual Auth/REST calendar owner/hash-only API, native unauthenticated Edge GET, no-store/no-referrer/no-cookie headers, explicit private opt-in/foreign isolation, stable rotation, old-token refusal, invalid/method refusal and revocation",
  );
});
