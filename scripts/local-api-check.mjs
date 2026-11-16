/**
 * Prüft lokale Auth-/RPC-/REST-Grenzen mit getrennten tatsächlich angemeldeten Konten.
 * Die Loopback- und Konfigurationsprüfungen begrenzen das Ziel auf die lokale Testumgebung.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

if (process.env.PORTAL_TEST_MODE !== "1")
  throw new Error(
    "Run destructive fixture acceptance only through isolated ./portal test.",
  );
process.loadEnvFile(".env.test.local");
const url = process.env.SUPABASE_URL;
assert.ok(
  url && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
  "Only loopback test projects are permitted",
);
/** Erzeugt einen getrennten SDK-Client ohne persistierte oder automatisch erneuerte Testsitzung. */
const make = (key) =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const service = make(process.env.SUPABASE_SERVICE_ROLE_KEY);
const anonymous = make(process.env.SUPABASE_ANON_KEY);
/** Wertet den tatsächlichen SDK-Erfolg aus und gibt erst danach dessen Daten zurück. */
async function checked(request, label) {
  const { data, error } = await request;
  assert.equal(error, null, `${label}: ${error?.message}`);
  return data;
}
/** Meldet die Testidentität tatsächlich über Auth an; Fehler werden nicht als autorisierter Zustand behandelt. */
async function signIn(email) {
  const client = make(process.env.SUPABASE_ANON_KEY);
  const data = await checked(
    client.auth.signInWithPassword({
      email,
      password: process.env.E2E_PASSWORD,
    }),
    "Real Auth sign-in",
  );
  return { client, user: data.user };
}
const users = [];
for (let index = 1; index <= 11; index++)
  users.push(
    await signIn(`lecturer${String(index).padStart(2, "0")}@example.invalid`),
  );
const admin = await signIn("admin@example.invalid");
const participant = await signIn("participant@example.invalid");
const jobId = randomUUID();
const starts = new Date(
  Date.UTC(2040, 0, 1) + Math.floor(Math.random() * 365) * 86_400_000,
);
await checked(
  service.from("jobs").insert({
    id: jobId,
    title: "QA REST concurrency – fictional local fixture",
    description: "50 simultaneous claim attempts",
    customer_name: "Fictional QA customer",
    delivery_type: "online",
    time_zone: "Europe/Berlin",
    status: "published",
    amount: 375,
    currency: "EUR",
    rate_unit: "per_day",
    total_amount: 1875,
    terms: "Immutable fictional QA terms.",
    terms_version: 1,
    requires_contract: false,
  }),
  "Insert API race fixture",
);
await checked(
  service.from("job_sessions").insert(
    Array.from({ length: 5 }, (_, index) => {
      const start = new Date(starts.getTime() + index * 86_400_000);
      return {
        job_id: jobId,
        starts_at: start.toISOString(),
        ends_at: new Date(start.getTime() + 6 * 3_600_000).toISOString(),
      };
    }),
  ),
  "Insert five API race sessions",
);
const attempts = Array.from({ length: 50 }, (_, index) => ({
  actor: users[index % users.length],
  key: randomUUID(),
}));
const outcomes = await Promise.all(
  attempts.map(async ({ actor, key }) =>
    checked(
      actor.client.rpc("claim_job", {
        p_job_id: jobId,
        p_idempotency_key: key,
        p_terms_version: 1,
      }),
      "Concurrent claim RPC",
    ),
  ),
);
assert.equal(
  outcomes.filter((result) => result.status === "confirmed").length,
  1,
  "Exactly one of 50 real HTTP claim requests wins",
);
assert.equal(
  outcomes.filter((result) => result.status === "filled").length,
  49,
  "Every losing HTTP request reports filled",
);
const winnerIndex = outcomes.findIndex(
  (result) => result.status === "confirmed",
);
const winner = attempts[winnerIndex];
const retry = await checked(
  winner.actor.client.rpc("claim_job", {
    p_job_id: jobId,
    p_idempotency_key: winner.key,
    p_terms_version: 1,
  }),
  "Idempotent winner retry",
);
assert.deepEqual(
  retry,
  outcomes[winnerIndex],
  "Same key returns the exact committed result",
);
const claims = await checked(
  service.from("job_claims").select("*").eq("job_id", jobId),
  "Read claim assertions",
);
assert.equal(claims.length, 1);
const allocations = await checked(
  service.from("assignment_sessions").select("*").eq("claim_id", claims[0].id),
  "Read calendar allocations",
);
assert.equal(allocations.length, 5);
const notifications = await checked(
  service.from("notifications").select("*").eq("resource_id", claims[0].id),
  "Read committed notifications",
);
assert.equal(notifications.length, 1);
await checked(
  service
    .from("jobs")
    .update({
      amount: 999,
      total_amount: 4995,
      terms: "Edited future offer terms",
    })
    .eq("id", jobId),
  "Edit source offer",
);
const snapshot = await checked(
  winner.actor.client
    .from("job_claims")
    .select("*")
    .eq("id", claims[0].id)
    .single(),
  "Read immutable terms",
);
assert.equal(Number(snapshot.amount), 375);
assert.equal(Number(snapshot.total_amount), 1875);
assert.equal(snapshot.terms, "Immutable fictional QA terms.");
assert.ok(
  (
    await users[0].client
      .from("user_roles")
      .insert({ user_id: users[0].user.id, role: "admin" })
  ).error,
  "Role self-escalation is rejected",
);
const forged = await checked(
  users[0].client.auth.updateUser({
    data: { role: "admin", roles: ["admin"] },
  }),
  "Update untrusted user metadata",
);
assert.ok(forged.user);
const permissions = await checked(
  users[0].client.rpc("get_my_permissions"),
  "Permissions ignore forged user metadata",
);
assert.deepEqual(permissions, []);
assert.equal(
  (
    await checked(
      participant.client.from("jobs").select("id"),
      "Participant job visibility",
    )
  ).length,
  0,
);
const anon = await anonymous.from("jobs").select("id");
assert.ok(
  anon.error || anon.data.length === 0,
  "Anonymous actor cannot read private jobs",
);
const ownEvent = await checked(
  users[0].client
    .from("personal_events")
    .insert({
      title: "Private QA appointment",
      user_id: users[0].user.id,
      starts_at: "2030-01-01T08:00:00Z",
      ends_at: "2030-01-01T09:00:00Z",
      time_zone: "Europe/Berlin",
    })
    .select()
    .single(),
  "Create private calendar event",
);
// The race winner is intentionally random. Probe beyond this actor's latest
// assignment so the finite-time CHECK, rather than the earlier conflict trigger,
// is what rejects Infinity in both the winner and loser cases.
const lastAssignment = await checked(
  service
    .from("assignment_sessions")
    .select("ends_at")
    .eq("lecturer_id", users[0].user.id)
    .order("ends_at", { ascending: false })
    .limit(1),
  "Find an uncontested finite-time probe",
);
const probeStart = new Date(
  Math.max(
    Date.parse(ownEvent.ends_at),
    lastAssignment[0] ? Date.parse(lastAssignment[0].ends_at) : 0,
  ) + 86_400_000,
).toISOString();
const nonfiniteInsert = await users[0].client.from("personal_events").insert({
  title: "Fictional infinite blocker rejected by the API",
  user_id: users[0].user.id,
  starts_at: probeStart,
  ends_at: "infinity",
  time_zone: "Europe/Berlin",
});
assert.equal(
  nonfiniteInsert.error?.code,
  "23514",
  "Real HTTP rejects an infinite private interval",
);
const nonfiniteUpdate = await users[0].client
  .from("personal_events")
  .update({
    starts_at: probeStart,
    ends_at: "infinity",
  })
  .eq("id", ownEvent.id);
assert.equal(
  nonfiniteUpdate.error?.code,
  "23514",
  "Real HTTP rejects an infinite interval update",
);
const preservedEvent = await checked(
  users[0].client
    .from("personal_events")
    .select("starts_at,ends_at")
    .eq("id", ownEvent.id)
    .single(),
  "Finite event remains unchanged",
);
assert.equal(
  Date.parse(preservedEvent.starts_at),
  Date.parse(ownEvent.starts_at),
);
assert.equal(Date.parse(preservedEvent.ends_at), Date.parse(ownEvent.ends_at));
for (const actor of [users[1], admin]) {
  const otherEvents = await checked(
    actor.client.from("personal_events").select("id").eq("id", ownEvent.id),
    "Private calendar RLS",
  );
  assert.deepEqual(
    otherEvents,
    [],
    "Neither another lecturer nor admin can read private appointments",
  );
}
assert.ok(
  (
    await users[0].client.from("personal_events").insert({
      user_id: users[1].user.id,
      title: "Forged owner",
      starts_at: "2030-01-01T10:00:00Z",
      ends_at: "2030-01-01T11:00:00Z",
    })
  ).error,
  "Forged event ownership rejected",
);
const adminCreate = await admin.client.rpc("create_job", { p_payload: {} });
assert.ok(
  adminCreate.error,
  "Admin mutation with password-only AAL1 session is rejected",
);
const allRoles = await checked(
  users[0].client.from("user_roles").select("*"),
  "Read own roles",
);
assert.ok(
  allRoles.every((role) => role.user_id === users[0].user.id),
  "Other actors roles remain private",
);
// Remove only this script's UUID-scoped local fixtures after assertions, keeping the
// development dashboard free of race-test offers and distant calendar allocations.
const rooms = await checked(
  service.from("chat_rooms").select("id").eq("job_id", jobId),
  "Read local test room",
);
for (const room of rooms)
  await checked(
    service.from("chat_members").delete().eq("room_id", room.id),
    "Remove own test membership",
  );
await checked(
  service.from("chat_rooms").delete().eq("job_id", jobId),
  "Remove own test room",
);
await checked(
  service.from("notifications").delete().eq("resource_id", claims[0].id),
  "Remove own test notification",
);
await checked(
  service.from("claim_events").delete().eq("claim_id", claims[0].id),
  "Remove own test claim event",
);
await checked(
  service.from("assignment_sessions").delete().eq("claim_id", claims[0].id),
  "Remove own test allocations",
);
await checked(
  service.from("job_claims").delete().eq("id", claims[0].id),
  "Remove own test claim",
);
await checked(
  service.from("job_sessions").delete().eq("job_id", jobId),
  "Remove own test sessions",
);
await checked(
  service.from("jobs").delete().eq("id", jobId),
  "Remove own test job",
);
await checked(
  users[0].client.from("personal_events").delete().eq("id", ownEvent.id),
  "Remove own test appointment",
);
await checked(
  users[0].client.auth.updateUser({ data: { role: null, roles: null } }),
  "Clear own forged test metadata",
);
console.log(
  "PASS: real Supabase Auth/REST, 50 parallel claims/one winner, 5 atomic allocations, one notification, idempotent retry, immutable fees/terms, private calendar incl admin, anonymous/participant boundaries, forged-owner/user-metadata/role escalation, admin MFA gate.",
);
