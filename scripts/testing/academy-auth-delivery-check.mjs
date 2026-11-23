/** Exercise the native Academy invitation and recovery callbacks in an owned Mailpit fixture. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

assert.equal(process.env.PORTAL_TEST_MODE, "1", "Disposable rehearsal only.");
const config = readFileSync("supabase/config.toml", "utf8");
assert.match(config, /^project_id\s*=\s*"luminovia-portal-test-[a-f0-9]{8}"$/m);
const apiPort = /^\[api\]\s*[\s\S]*?^port\s*=\s*(\d+)$/m.exec(config)?.[1];
const capture =
  /^\[local_smtp\]\s*\nenabled = true\n(?:#[^\n]*\n)*port\s*=\s*(\d+)$/m.exec(
    config,
  );
const origin = /^site_url\s*=\s*"(http:\/\/127\.0\.0\.1:\d+)"$/m.exec(
  config,
)?.[1];
assert.ok(
  apiPort && capture && origin,
  "An owned loopback Auth and Mailpit are required.",
);
assert.doesNotMatch(
  config,
  /^\[auth\.email\.smtp\]/m,
  "External mail is forbidden in capture mode.",
);

const base = `http://127.0.0.1:${apiPort}`;
const mailbox = `http://127.0.0.1:${capture[1]}`;
const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = JSON.parse(
  execFileSync("./node_modules/.bin/supabase", ["status", "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
assert.equal(API_URL, base, "The keys must belong to this owned local stack.");
function client(key = ANON_KEY) {
  return createClient(base, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
async function checked(request, context) {
  const { data, error } = await request;
  assert.ok(!error, context);
  return data;
}
async function post(path, body, token) {
  return fetch(base + path, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Origin: origin,
      apikey: ANON_KEY,
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
}
async function mail(email, previous) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const inbox = await getMailbox("/api/v1/messages");
    const matches = inbox.messages.filter(
      (message) =>
        message.ID !== previous &&
        message.To.some((address) => address.Address === email),
    );
    if (matches.length) {
      assert.equal(matches.length, 1, "Exactly one new message per operation.");
      const message = await getMailbox("/api/v1/message/" + matches[0].ID);
      const link = /href="([^"]+)"/.exec(message.HTML)?.[1];
      assert.ok(link, "The bilingual message contains its own callback link.");
      assert.match(message.HTML, /Lernportal \/ Learning portal/);
      assert.doesNotMatch(message.HTML + message.Subject, /Luminovia/);
      return { id: message.ID, href: new URL(link.replaceAll("&amp;", "&")) };
    }
    await delay(200);
  }
  throw new Error("No fictional delivery reached the owned Mailpit inbox.");
}
async function getMailbox(path) {
  const response = await fetch(mailbox + path, {
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(response.status, 200, "Local Mailpit must be available.");
  return response.json();
}

const service = client(SERVICE_ROLE_KEY);
const users = await checked(
  service.auth.admin.listUsers(),
  "List owned fixture users.",
);
const admins = users.users.filter((user) =>
  /^fictional-administrator-[a-f0-9-]+@example\.invalid$/.test(
    user.email ?? "",
  ),
);
assert.equal(
  admins.length,
  1,
  "The material rehearsal creates one local administrator.",
);
const [admin] = admins;
const adminPassword = `A1!a-${randomUUID()}`;
await checked(
  service.auth.admin.updateUserById(admin.id, { password: adminPassword }),
  "Set the disposable administrator password.",
);
const adminSession = await checked(
  client().auth.signInWithPassword({
    email: admin.email,
    password: adminPassword,
  }),
  "Sign in with the real administrator account.",
);

const email = `academy-delivery-${randomUUID()}@example.invalid`;
const invitation = {
  mode: "invite",
  role: "lecturer",
  organisation_id: null,
  display_name: "Fictional Academy lecturer",
  email,
  idempotency_key: randomUUID(),
};
const invite = () =>
  post(
    "/functions/v1/accounts/v1/academy/users",
    invitation,
    adminSession.session.access_token,
  );
const sent = await invite();
assert.equal(
  sent.status,
  201,
  "The Academy accounts facade created the native invitation.",
);
const account = await sent.json();
assert.equal(account.status, "created");
const retry = await invite();
assert.equal(
  retry.status,
  200,
  "The same invitation must be recognised on retry.",
);
assert.deepEqual(await retry.json(), account);
const received = await mail(email);
assert.equal(received.href.origin, origin);
assert.equal(received.href.pathname, "/auth/callback");
assert.equal(received.href.searchParams.get("type"), "invite");
const inviteToken = received.href.searchParams.get("token_hash");
assert.ok(inviteToken, "The invitation provides a one-time token hash.");

const lecturer = client();
const accepted = await checked(
  lecturer.auth.verifyOtp({ type: "invite", token_hash: inviteToken }),
  "Accept the captured invitation through native Auth.",
);
assert.equal(accepted.user.id, account.user_id);
const selectedPassword = `B2!b-${randomUUID()}`;
await checked(
  lecturer.auth.updateUser({ password: selectedPassword }),
  "Set the lecturer's first password.",
);
const alias = "fixture-" + randomUUID().slice(0, 12);
const personal = await checked(
  lecturer.rpc("academy_personal_settings"),
  "Read current login alias.",
);
await checked(
  lecturer.rpc("academy_save_username", {
    p_username: alias,
    p_expected_version: personal.username.version,
  }),
  "Set the normalized Academy username.",
);
const login = (identifier, password) =>
  post("/functions/v1/human-login", { identifier, password });
for (const identifier of [email, alias.toUpperCase()]) {
  const response = await login(identifier, selectedPassword);
  assert.equal(response.status, 200);
  const session = await response.json();
  const actor = await checked(
    client().auth.getUser(session.access_token),
    "Resolve the issued account session.",
  );
  assert.equal(actor.user.id, account.user_id);
}

const verifier = randomBytes(42).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const requested = await post("/functions/v1/human-recovery", {
  username: alias,
  code_challenge: challenge,
  code_challenge_method: "s256",
  redirect_to: origin + "/auth/callback",
});
assert.equal(
  requested.status,
  202,
  "Request the captured recovery through the username facade.",
);
const recovery = await mail(email, received.id);
assert.equal(recovery.href.origin, base);
assert.equal(recovery.href.pathname, "/auth/v1/verify");
const confirmation = await fetch(recovery.href, {
  redirect: "manual",
  signal: AbortSignal.timeout(15_000),
});
assert.ok(
  [302, 303].includes(confirmation.status),
  "Native Auth redirects after verification.",
);
const callback = new URL(confirmation.headers.get("location") ?? "");
assert.equal(callback.origin, origin);
assert.equal(callback.pathname, "/auth/callback");
const code = callback.searchParams.get("code");
assert.ok(code, "Recovery provides a one-use PKCE code.");
const exchange = () =>
  post("/auth/v1/token?grant_type=pkce", {
    auth_code: code,
    code_verifier: verifier,
  });
const exchanged = await exchange();
assert.equal(exchanged.status, 200);
const session = await exchanged.json();
assert.equal(session.user?.id, account.user_id);
const duplicate = await exchange();
assert.ok(
  duplicate.status >= 400 && duplicate.status < 500,
  "PKCE replay must be denied.",
);
await duplicate.body?.cancel();
const recovered = client();
await checked(
  recovered.auth.setSession(session),
  "Restore the confirmed recovery session.",
);
const replacementPassword = `C3!c-${randomUUID()}`;
await checked(
  recovered.auth.updateUser({ password: replacementPassword }),
  "Complete recovery by setting the replacement password.",
);
const old = await login(alias, selectedPassword);
assert.equal(old.status, 401, "The old password is rejected.");
await old.body?.cancel();
const next = await login(alias, replacementPassword);
assert.equal(next.status, 200, "The replacement password signs in.");
await next.body?.cancel();

console.log(
  JSON.stringify({
    evidence: "isolated-local-mailpit",
    checks: [
      "academy_invitation",
      "idempotent_delivery",
      "invite_callback",
      "first_password",
      "email_and_username_login",
      "username_recovery",
      "recovery_callback",
      "one_time_pkce",
      "recovered_password",
    ],
  }),
);
