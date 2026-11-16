/**
 * Checks local invitations through real Auth/MFA and a captured Mailpit message.
 * Delivery stays inside the local test system; real recipients are outside these fixtures.
 */
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";

process.loadEnvFile(".env.test.local");
const url = process.env.SUPABASE_URL;
assert.ok(
  url && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
  "Only local disposable projects are permitted",
);
/** Creates the business fixture through the data contract under test here. */
const create = (key) =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const service = create(process.env.SUPABASE_SERVICE_ROLE_KEY);
const admin = create(process.env.SUPABASE_ANON_KEY);
/** Requires actual SDK success before returning the response data. */
async function checked(request, label) {
  const { data, error } = await request;
  assert.equal(error, null, `${label}: ${error?.message}`);
  return data;
}
/** Computes the current six-digit TOTP from the fictional MFA secret; never log the code or secret. */
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replace(/=+$/, "").toUpperCase()]
    .map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(
    bits.match(/.{8}/g).map((byte) => Number.parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return (
    (digest.readUInt32BE(digest[digest.length - 1] & 15) & 0x7fffffff) %
    1_000_000
  )
    .toString()
    .padStart(6, "0");
}
const users = await checked(
  service.auth.admin.listUsers({ perPage: 1000 }),
  "Read disposable users",
);
let actor = users.users.find(
  (user) => user.email === "edge-admin@example.invalid",
);
if (!actor)
  actor = (
    await checked(
      service.auth.admin.createUser({
        email: "edge-admin@example.invalid",
        password: process.env.E2E_PASSWORD,
        email_confirm: true,
      }),
      "Create local Edge test admin",
    )
  ).user;
else
  await checked(
    service.auth.admin.updateUserById(actor.id, {
      password: process.env.E2E_PASSWORD,
    }),
    "Reset dedicated test password",
  );
await checked(
  service
    .from("profiles")
    .update({ display_name: "Fiktive Edge-QA-Verwaltung", active: true })
    .eq("id", actor.id),
  "Set disposable profile",
);
await checked(
  service
    .from("user_roles")
    .upsert(
      { user_id: actor.id, role: "admin" },
      { onConflict: "user_id,role" },
    ),
  "Assign dedicated local admin",
);
const factors = await checked(
  service.auth.admin.mfa.listFactors({ userId: actor.id }),
  "List dedicated QA factors",
);
for (const factor of factors.factors)
  await checked(
    service.auth.admin.mfa.deleteFactor({ userId: actor.id, id: factor.id }),
    "Remove old dedicated QA factor",
  );
await checked(
  admin.auth.signInWithPassword({
    email: actor.email,
    password: process.env.E2E_PASSWORD,
  }),
  "Sign in actual test admin",
);
const enrollment = await checked(
  admin.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Disposable Edge QA",
  }),
  "Enroll real TOTP",
);
await checked(
  admin.auth.mfa.challengeAndVerify({
    factorId: enrollment.id,
    code: totp(enrollment.totp.secret),
  }),
  "Verify real TOTP",
);
const assurance = await checked(
  admin.auth.mfa.getAuthenticatorAssuranceLevel(),
  "Read verified AAL",
);
assert.equal(assurance.currentLevel, "aal2");
const session = await checked(
  admin.auth.getSession(),
  "Read actual verified session",
);
const email = `invite-${randomUUID()}@example.invalid`;
const body = {
  email,
  display_name: "Fiktive eingeladene QA-Lehrkraft",
  idempotency_key: randomUUID(),
};
const headers = {
  "Content-Type": "application/json",
  Origin: process.env.PORTAL_APP_ORIGIN ?? "http://127.0.0.1:5173",
  apikey: process.env.SUPABASE_ANON_KEY,
  Authorization: `Bearer ${session.session.access_token}`,
};
const inviteUrl = `${url}/functions/v1/invite-lecturer`;
const options = await fetch(inviteUrl, {
  method: "OPTIONS",
  headers: { Origin: headers.Origin, "Access-Control-Request-Method": "POST" },
});
assert.ok([200, 204].includes(options.status));
// Local Kong can answer preflight itself; the function still checks every POST origin.
assert.ok(
  [headers.Origin, "*"].includes(
    options.headers.get("Access-Control-Allow-Origin"),
  ),
);
const response = await fetch(inviteUrl, {
  method: "POST",
  headers,
  body: JSON.stringify(body),
});
const result = await response.json();
assert.equal(
  response.status,
  200,
  `Local invite function HTTP ${response.status}: ${JSON.stringify(result)}`,
);
assert.equal(result.status, "sent");
assert.ok(
  [headers.Origin, "*"].includes(
    response.headers.get("Access-Control-Allow-Origin"),
  ),
);
const retry = await fetch(inviteUrl, {
  method: "POST",
  headers,
  body: JSON.stringify(body),
});
const retryResult = await retry.json();
assert.equal(retry.status, 200);
assert.equal(retryResult.invitation_id, result.invitation_id);
assert.ok(["sent", "already_sent"].includes(retryResult.status));
const listed = await checked(
  service.auth.admin.listUsers({ perPage: 1000 }),
  "Read invited user",
);
const invited = listed.users.find((user) => user.email === email);
assert.ok(invited, "Actual invited account exists");
const roles = await checked(
  service.from("user_roles").select("*").eq("user_id", invited.id),
  "Read invited account role",
);
assert.deepEqual(
  roles.map((role) => role.role),
  ["lecturer"],
);
const profile = await checked(
  service.from("profiles").select("display_name").eq("id", invited.id).single(),
  "Read invited profile name",
);
assert.equal(profile.display_name, body.display_name);
let messages = [];
for (let index = 0; index < 20; index++) {
  const inbox = await (
    await fetch(
      `${process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324"}/api/v1/messages`,
    )
  ).json();
  messages = inbox.messages.filter((message) =>
    message.To.some((to) => to.Address === email),
  );
  if (messages.length) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.equal(
  messages.length,
  1,
  "Exactly one invitation captured by local Mailpit after retry",
);
const message = await (
  await fetch(
    `${process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324"}/api/v1/message/${messages[0].ID}`,
  )
).json();
const href = /href="([^"]+)"/.exec(message.HTML)?.[1]?.replaceAll("&amp;", "&");
assert.ok(href, "Custom invitation email contains its acceptance link");
const invitation = new URL(href);
assert.equal(invitation.pathname, "/auth/callback");
assert.equal(invitation.searchParams.get("type"), "invite");
assert.ok(
  invitation.searchParams.get("token_hash"),
  "Custom template provides the one-time token hash",
);
mkdirSync(".local", { recursive: true, mode: 0o700 });
writeFileSync(
  ".local/last-invitation.json",
  JSON.stringify({ email, url: href }),
  { mode: 0o600 },
);
const denied = await fetch(inviteUrl, {
  method: "POST",
  headers: { ...headers, Origin: "https://untrusted.example.invalid" },
  body: JSON.stringify(body),
});
assert.equal(denied.status, 403);
console.log(
  "PASS: actual local Edge runtime, actual admin AAL2 TOTP, CORS preflight, durable invitation+lecturer role+profile, idempotent retry and exactly one Mailpit email with custom token-hash callback, denied untrusted origin. No real email sent.",
);
