/**
 * Echte Auth-/HTTP-Prüfung für Konten, Rollen und reservierte Einladungen.
 * Fiktive getrennte Identitäten prüfen bestätigte API-Ergebnisse und negative Zugriffe; keine Browser-Mocks.
 */
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
if (process.env.PORTAL_TEST_MODE !== "1")
  throw new Error("Account API mutations require isolated ./portal test.");
process.loadEnvFile(".env.test.local");
const project = /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m.exec(
  readFileSync("supabase/config.toml", "utf8"),
)?.[1];
assert.match(project ?? "", /^luminovia-portal-test-[a-f0-9]+$/);
const url = process.env.SUPABASE_URL;
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname));
const origin = process.env.PORTAL_APP_ORIGIN ?? "http://127.0.0.1:5273";
/** Erzeugt einen getrennten SDK-Client ohne persistierte oder automatisch erneuerte Testsitzung. */
const make = (key) =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const service = make(process.env.SUPABASE_SERVICE_ROLE_KEY),
  users = [],
  organisations = [];
const suffix = randomUUID().slice(0, 8);
/** Wertet den tatsächlichen SDK-Erfolg aus und gibt erst danach dessen Daten zurück. */
async function checked(request, label) {
  const result = await request;
  assert.equal(result.error, null, `${label}: ${result.error?.message}`);
  return result.data;
}
/** Berechnet den aktuellen sechsstelligen TOTP aus dem fiktiven MFA-Geheimnis; keine Codes protokollieren. */
function totp(secret) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replace(/=+$/, "").toUpperCase()]
    .map((c) => chars.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const bytes = Buffer.from(
    bits.match(/.{8}/g).map((v) => Number.parseInt(v, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac("sha1", bytes).update(counter).digest();
  return (
    (hash.readUInt32BE(hash[hash.length - 1] & 15) & 0x7fffffff) %
    1000000
  )
    .toString()
    .padStart(6, "0");
}
/** Erzeugt getrennte fiktive Konten und meldet sie über Auth an; ihre Kennungen dienen nur der Fixture. */
async function fixture(name, role) {
  const email = `account-${name}-${suffix}@example.invalid`;
  const data = await checked(
    service.auth.admin.createUser({
      email,
      password: process.env.E2E_PASSWORD,
      email_confirm: true,
    }),
    "Create own API fixture",
  );
  users.push(data.user.id);
  await checked(
    service.from("user_roles").insert({ user_id: data.user.id, role }),
    "Assign fixture role",
  );
  await checked(
    service
      .from("profiles")
      .update({ display_name: `API ${name} ${suffix}` })
      .eq("id", data.user.id),
    "Name fixture",
  );
  const client = make(process.env.SUPABASE_ANON_KEY);
  await checked(
    client.auth.signInWithPassword({
      email,
      password: process.env.E2E_PASSWORD,
    }),
    "Actual Auth login",
  );
  return { id: data.user.id, email, client };
}
/** Verifiziert einen echten TOTP-Faktor, damit privilegierte Prüfaufrufe tatsächlich AAL2 verwenden. */
async function mfa(actor) {
  const factor = await checked(
    actor.client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Account API QA",
    }),
    "Enroll actual TOTP",
  );
  await checked(
    actor.client.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: totp(factor.totp.secret),
    }),
    "Verify actual TOTP",
  );
}
/** Sendet den tatsächlichen Prüfrequest mit der ausgewählten Identität; Antworten werden unabhängig geprüft. */
async function request(
  actor,
  path,
  method = "GET",
  body,
  originValue = undefined,
) {
  const session = await checked(
    actor.client.auth.getSession(),
    "Read own Auth session",
  );
  const response = await fetch(`${url}/functions/v1/accounts/v1/${path}`, {
    method,
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.session.access_token}`,
      ...(originValue === undefined ? {} : { Origin: originValue }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
}
try {
  const admin = await fixture("admin", "admin"),
    teacher = await fixture("teacher", "lecturer"),
    peer = await fixture("peer", "lecturer");
  let own = await request(teacher, "me");
  assert.equal(own.status, 200);
  assert.equal(own.body.profile.id, teacher.id);
  assert.deepEqual(own.body.roles, ["lecturer"]);
  assert.match(own.headers.get("cache-control"), /no-store/);
  assert.equal((await request(teacher, "users")).status, 403);
  assert.equal((await request(admin, "users")).status, 403);
  await mfa(admin);
  const accounts = await request(admin, `users?q=${suffix}&limit=2&offset=0`);
  assert.equal(accounts.status, 200);
  assert.equal(accounts.body.total, 3);
  assert.equal(accounts.body.items.length, 2);
  assert.ok(
    accounts.body.items.every((item) => !("encrypted_password" in item)),
  );
  assert.equal(
    (await admin.client.rpc("account_users", { p_limit: null })).error?.code,
    "22023",
    "Native RPC cannot bypass pagination cap with explicit NULL",
  );
  assert.equal(
    (
      await request(
        teacher,
        "me",
        "PATCH",
        {
          display_name: `API teacher edited ${suffix}`,
          bio_de: "Echte API-Daten",
          time_zone: "Australia/Brisbane",
        },
        origin,
      )
    ).status,
    200,
  );
  own = await request(teacher, "me");
  assert.equal(own.body.profile.time_zone, "Australia/Brisbane");
  for (const payload of [
    { id: peer.id },
    { roles: ["owner"] },
    { active: false },
    { time_zone: "Invalid/Zone" },
  ])
    assert.equal((await request(teacher, "me", "PATCH", payload)).status, 400);
  assert.ok(
    (
      await teacher.client
        .from("profiles")
        .update({ time_zone: "Invalid/Zone" })
        .eq("id", teacher.id)
    ).error,
    "Native REST repeats timezone integrity",
  );
  assert.equal(
    (
      await request(teacher, `users/${teacher.id}/roles`, "PUT", {
        roles: ["owner"],
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(admin, `users/${teacher.id}/roles`, "PUT", {
        roles: ["lecturer", "participant"],
      })
    ).status,
    200,
  );
  assert.deepEqual((await request(teacher, "me")).body.roles, [
    "lecturer",
    "participant",
  ]);
  assert.equal(
    (
      await request(admin, `users/${admin.id}/roles`, "PUT", {
        roles: ["lecturer"],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(admin, `users/${admin.id}/status`, "PATCH", {
        active: false,
      })
    ).status,
    400,
  );
  const org = await checked(
    admin.client.rpc("save_organisation", {
      p_id: null,
      p_payload: {
        name: `API organisation ${suffix}`,
        time_zone: "Europe/Berlin",
      },
    }),
    "Create scoped org",
  );
  organisations.push(org);
  assert.equal(
    (
      await request(admin, `users/${peer.id}/roles`, "PUT", {
        roles: ["client"],
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(admin, `users/${peer.id}/organisations/${org}`, "PUT"))
      .status,
    200,
  );
  assert.equal(
    (
      await checked(
        peer.client.rpc("client_organisations"),
        "Scoped linked client",
      )
    )[0].id,
    org,
  );
  assert.equal(
    (await request(admin, `users/${peer.id}/organisations/${org}`, "DELETE"))
      .status,
    200,
  );
  assert.deepEqual(
    await checked(peer.client.rpc("client_organisations"), "Revoked link"),
    [],
  );
  const email = `account-invited-${suffix}@example.invalid`,
    body = {
      email,
      display_name: `Invited client ${suffix}`,
      role: "client",
      organisation_id: org,
      idempotency_key: randomUUID(),
    };
  const sent = await request(admin, "invitations", "POST", body, origin);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.status, "sent");
  const retry = await request(admin, "invitations", "POST", body);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.status, "already_sent");
  assert.equal(retry.body.invitation_id, sent.body.invitation_id);
  assert.equal(
    (
      await request(admin, "invitations", "POST", {
        ...body,
        role: "admin",
        organisation_id: null,
      })
    ).status,
    409,
  );
  const invited = (
    await checked(
      service.auth.admin.listUsers({ perPage: 1000 }),
      "Read scoped invited actor",
    )
  ).users.find((user) => user.email === email);
  assert.ok(invited);
  users.push(invited.id);
  assert.deepEqual(
    (
      await checked(
        service.from("user_roles").select("role").eq("user_id", invited.id),
        "Invited role",
      )
    ).map((row) => row.role),
    ["client"],
  );
  assert.equal(
    (
      await checked(
        service
          .from("client_organisation_memberships")
          .select("organisation_id")
          .eq("user_id", invited.id),
        "Invited client scope",
      )
    )[0].organisation_id,
    org,
  );
  let messages = [];
  for (let i = 0; i < 20; i++) {
    const inbox = await (
      await fetch(`${process.env.E2E_MAILPIT_URL}/api/v1/messages`)
    ).json();
    messages = inbox.messages.filter((message) =>
      message.To.some((recipient) => recipient.Address === email),
    );
    if (messages.length) break;
    await delay(250);
  }
  assert.equal(
    messages.length,
    1,
    "Exactly one actual captured account invitation after retry",
  );
  assert.equal(
    (await request(admin, "users", "GET", undefined, "https://foreign.invalid"))
      .status,
    403,
  );
  assert.equal(
    (
      await request(admin, `users/${teacher.id}/status`, "PATCH", {
        active: false,
      })
    ).status,
    200,
  );
  assert.equal((await request(teacher, "me")).status, 401);
  assert.equal(
    (
      await request(admin, `users/${teacher.id}/status`, "PATCH", {
        active: true,
      })
    ).status,
    200,
  );
  assert.equal((await request(teacher, "me")).status, 200);
  const catalog = await request(admin, "roles");
  assert.equal(catalog.status, 200);
  assert.ok(catalog.body.some((row) => row.role === "owner"));
  assert.ok(catalog.body.some((row) => row.role === "client"));
  const spec = await fetch(`${url}/functions/v1/accounts/openapi.json`, {
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${(await admin.client.auth.getSession()).data.session.access_token}`,
    },
  });
  assert.equal(spec.status, 200);
  assert.equal((await spec.json()).openapi, "3.1.0");
  console.log(
    "PASS: actual Auth/TOTP Account HTTP API, own profile, strict identity/roles/timezones, bounded directory, self protection, role assignment, scoped client links/revocation, durable one-email invitation, origin check and old-token suspension/reactivation.",
  );
} finally {
  if (users.length) {
    await checked(
      service.from("invitation_requests").delete().in("actor_id", users),
      "Remove scoped invitation ledger",
    );
    await checked(
      service
        .from("client_organisation_memberships")
        .delete()
        .in("user_id", users),
      "Remove scoped memberships",
    );
    await checked(
      service.from("audit_events").delete().in("actor_id", users),
      "Remove scoped audit",
    );
    for (const id of users)
      await checked(
        service.auth.admin.deleteUser(id),
        "Remove own account fixture",
      );
  }
  if (organisations.length)
    await checked(
      service.from("organisations").delete().in("id", organisations),
      "Remove own empty organisations",
    );
}
