import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const mode = process.argv[2];
assert(["--create", "--verify"].includes(mode) && process.argv.length === 3);
const owner = process.env.PORTAL_CANDIDATE_OWNER;
assert.match(owner ?? "", /^luminovia-portal-test-[a-f0-9]{24}$/);
assert.equal(lstatSync(process.cwd()).mode & 0o077, 0);
const metadata = JSON.parse(
  execFileSync("docker", ["inspect", "supabase_db_" + owner], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
)[0];
assert.equal(metadata.Config.Labels["org.luminovia.candidate"], owner);
assert.equal(Object.keys(metadata.HostConfig.PortBindings ?? {}).length, 0);
assert.deepEqual(Object.keys(metadata.NetworkSettings.Networks), [
  owner + "-backend",
]);
process.loadEnvFile(".env.test.local");
const url = new URL(process.env.SUPABASE_URL);
assert(url.protocol === "https:" && url.hostname === "127.0.0.1" && url.port);
const make = (key) =>
  createClient(url.href, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
const service = make(process.env.SUPABASE_SERVICE_ROLE_KEY);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function checked(promise) {
  const result = await promise;
  assert.equal(result.error, null);
  return result.data;
}
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replace(/=+$/, "")]
    .map((character) =>
      alphabet.indexOf(character).toString(2).padStart(5, "0"),
    )
    .join("");
  const key = Buffer.from(
    bits.match(/.{8}/g).map((byte) => Number.parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return (
    (digest.readUInt32BE(digest[digest.length - 1] & 15) & 0x7fffffff) %
    1000000
  )
    .toString()
    .padStart(6, "0");
}
const ledger = ".candidate-upgrade-probe.json";
if (mode === "--create") {
  const id = randomUUID(),
    email = "candidate-existing-" + id + "@example.invalid";
  const password = "Existing!" + randomUUID() + "Aa9";
  const { user } = await checked(
    service.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  await checked(
    service.from("user_roles").insert({ user_id: user.id, role: "lecturer" }),
  );
  const client = make(process.env.SUPABASE_ANON_KEY);
  await checked(client.auth.signInWithPassword({ email, password }));
  const factor = await checked(
    client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Candidate existing factor",
    }),
  );
  await checked(
    client.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: totp(factor.totp.secret),
    }),
  );
  const { session } = await checked(client.auth.getSession());
  const event = await checked(
    client
      .from("personal_events")
      .insert({
        user_id: user.id,
        title: "Private existing candidate event " + id,
        starts_at: "2046-01-01T08:00:00Z",
        ends_at: "2046-01-01T09:00:00Z",
        time_zone: "Europe/Berlin",
      })
      .select()
      .single(),
  );
  const bytes = new TextEncoder().encode(
    "Existing private scanned candidate file " + id,
  );
  const form = new FormData();
  form.set(
    "file",
    new File([bytes], "existing-private.txt", { type: "text/plain" }),
  );
  form.set("scope", "personal");
  form.set("kind", "material");
  form.set("client_id", randomUUID());
  const response = await fetch(
    url.href.replace(/\/$/, "") + "/functions/v1/files",
    {
      method: "POST",
      headers: {
        Origin: process.env.PORTAL_APP_ORIGIN,
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: "Bearer " + session.access_token,
      },
      body: form,
      signal: AbortSignal.timeout(90000),
    },
  );
  assert.equal(response.status, 200);
  const document = (await response.json()).document;
  assert.equal(document.status, "clean");
  const roles = await checked(
    service
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .order("role"),
  );
  writeFileSync(
    ledger,
    JSON.stringify({
      owner,
      id: user.id,
      email,
      password,
      factorId: factor.id,
      secret: factor.totp.secret,
      counter: Math.floor(Date.now() / 30000),
      event,
      documentId: document.id,
      sha256: hash(bytes),
      roles,
    }),
    { flag: "wx", mode: 0o600 },
  );
} else {
  assert.equal(lstatSync(ledger).mode & 0o077, 0);
  const probe = JSON.parse(readFileSync(ledger, "utf8"));
  assert.equal(probe.owner, owner);
  const client = make(process.env.SUPABASE_ANON_KEY);
  const data = await checked(
    client.auth.signInWithPassword({
      email: probe.email,
      password: probe.password,
    }),
  );
  assert.equal(data.user.id, probe.id);
  const factors = await checked(client.auth.mfa.listFactors());
  assert(
    factors.totp.some(
      (factor) => factor.id === probe.factorId && factor.status === "verified",
    ),
  );
  while (Math.floor(Date.now() / 30000) <= probe.counter)
    await new Promise((done) => setTimeout(done, 200));
  await checked(
    client.auth.mfa.challengeAndVerify({
      factorId: probe.factorId,
      code: totp(probe.secret),
    }),
  );
  assert.equal(
    (await checked(client.auth.mfa.getAuthenticatorAssuranceLevel()))
      .currentLevel,
    "aal2",
  );
  assert.deepEqual(
    await checked(
      service
        .from("user_roles")
        .select("role")
        .eq("user_id", probe.id)
        .order("role"),
    ),
    probe.roles,
  );
  assert.deepEqual(
    await checked(
      client.from("personal_events").select().eq("id", probe.event.id).single(),
    ),
    probe.event,
  );
  const { session } = await checked(client.auth.getSession());
  const download = (token) =>
    fetch(url.href.replace(/\/$/, "") + "/functions/v1/files", {
      method: "POST",
      headers: {
        Origin: process.env.PORTAL_APP_ORIGIN,
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "download", id: probe.documentId }),
      signal: AbortSignal.timeout(90000),
    });
  const response = await download(session.access_token);
  assert.equal(response.status, 200);
  assert.equal(
    hash(new Uint8Array(await response.arrayBuffer())),
    probe.sha256,
  );
  assert.match(response.headers.get("cache-control"), /no-store/);
  const administrator = make(process.env.SUPABASE_ANON_KEY);
  const admin = await checked(
    administrator.auth.signInWithPassword({
      email: "admin@example.invalid",
      password: process.env.E2E_PASSWORD,
    }),
  );
  const denied = await download(admin.session.access_token);
  assert.equal(denied.status, 403);
  await denied.body?.cancel();
  assert.deepEqual(
    await checked(
      administrator
        .from("personal_events")
        .select("id")
        .eq("id", probe.event.id),
    ),
    [],
  );
}
console.log(
  "PASS scoped existing password/MFA/roles/private-event/scanned-file " + mode,
);
