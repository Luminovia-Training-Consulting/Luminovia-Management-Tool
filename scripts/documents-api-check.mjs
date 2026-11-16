/**
 * Echte Auth-/HTTP-Prüfung für private Dokumentversionen, Scanstatus und Zugriffsgrenzen.
 * Fiktive getrennte Identitäten prüfen bestätigte API-Ergebnisse und negative Zugriffe; keine Browser-Mocks.
 */
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
process.loadEnvFile(".env.test.local");
const url = process.env.SUPABASE_URL;
assert.ok(
  url && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
  "Document tests are local only.",
);
const origin = new URL(process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173")
  .origin;
/** Erzeugt einen getrennten SDK-Client ohne persistierte oder automatisch erneuerte Testsitzung. */
const make = (key) =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const service = make(process.env.SUPABASE_SERVICE_ROLE_KEY),
  users = [],
  rooms = [];
/** Wertet den tatsächlichen SDK-Erfolg aus und gibt erst danach dessen Daten zurück. */
const checked = async (request, label) => {
  const { data, error } = await request;
  assert.equal(error, null, `${label}: ${error?.message}`);
  return data;
};
/** Berechnet den aktuellen sechsstelligen TOTP aus dem fiktiven MFA-Geheimnis; keine Codes protokollieren. */
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replace(/=+$/, "").toUpperCase()]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(
    bits.match(/.{8}/g).map((b) => Number.parseInt(b, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", key).update(counter).digest();
  return ((h.readUInt32BE(h[h.length - 1] & 15) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}
/** Erzeugt getrennte fiktive Konten und meldet sie über Auth an; ihre Kennungen dienen nur der Fixture. */
async function fixture(role) {
  const created = await checked(
    service.auth.admin.createUser({
      email: `files-${role}-${randomUUID()}@example.invalid`,
      password: process.env.E2E_PASSWORD,
      email_confirm: true,
    }),
    "Create temporary document test account",
  );
  users.push(created.user.id);
  await checked(
    service.from("user_roles").insert({ user_id: created.user.id, role }),
    "Assign temporary role",
  );
  const client = make(process.env.SUPABASE_ANON_KEY);
  await checked(
    client.auth.signInWithPassword({
      email: created.user.email,
      password: process.env.E2E_PASSWORD,
    }),
    "Sign in real document actor",
  );
  return { client, id: created.user.id };
}
/** Liest den aktuellen Sitzungstoken der Testidentität für echte authentifizierte Gatewayaufrufe. */
async function headers(actor) {
  const { session } = await checked(
    actor.client.auth.getSession(),
    "Read current local Auth session",
  );
  return {
    Origin: origin,
    Authorization: `Bearer ${session.access_token}`,
    apikey: process.env.SUPABASE_ANON_KEY,
  };
}
/** Sendet echte Fixturebytes an den authentifizierten Dateipfad; Scan und Freigabe bleiben Serveraufgaben. */
async function upload(
  actor,
  bytes,
  name = "lesson.txt",
  context = {},
  clientId = randomUUID(),
) {
  const form = new FormData();
  form.set(
    "file",
    new File([bytes], name, {
      type: name.endsWith(".pdf") ? "application/pdf" : "text/plain",
    }),
  );
  form.set("scope", context.scope ?? "personal");
  form.set(
    "kind",
    context.kind ?? (context.scope === "room" ? "chat" : "material"),
  );
  form.set("client_id", clientId);
  for (const key of ["room_id", "job_id", "owner_id", "replace_id"])
    if (context[key]) form.set(key, context[key]);
  const response = await fetch(`${url}/functions/v1/files`, {
    method: "POST",
    headers: await headers(actor),
    body: form,
  });
  return { status: response.status, body: await response.json() };
}
/** Fragt die berechtigten Dokumentbytes für die konkrete Identität und Version über das Gateway ab. */
async function download(actor, id, versionId) {
  return await fetch(`${url}/functions/v1/files`, {
    method: "POST",
    headers: { ...(await headers(actor)), "Content-Type": "application/json" },
    body: JSON.stringify({ action: "download", id, version_id: versionId }),
  });
}
let scannerStopped = false,
  scannerName;
try {
  const a = await fixture("lecturer"),
    b = await fixture("lecturer"),
    admin = await fixture("admin");
  const factor = await checked(
    admin.client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Local document QA",
    }),
    "Enroll actual admin TOTP",
  );
  await checked(
    admin.client.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: totp(factor.totp.secret),
    }),
    "Verify actual admin TOTP",
  );
  const bytes = new TextEncoder().encode("Fictional secure lesson material.");
  const key = randomUUID();
  const stored = await upload(a, bytes, "lesson.txt", {}, key);
  assert.equal(stored.status, 200, JSON.stringify(stored.body));
  const doc = stored.body.document;
  assert.equal(doc.status, "clean");
  assert.equal(doc.owner_id, a.id);
  const retry = await upload(a, bytes, "lesson.txt", {}, key);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.document.id, doc.id);
  const changedBytes = bytes.slice();
  changedBytes[0] = changedBytes[0] === 65 ? 66 : 65;
  const changedRetry = await upload(a, changedBytes, "lesson.txt", {}, key);
  assert.equal(
    changedRetry.status,
    409,
    "Same-length different bytes must not silently confirm the old upload",
  );
  assert.equal(changedRetry.body.error, "idempotency_conflict");
  const versions = await checked(
    a.client.from("document_versions").select("*").eq("document_id", doc.id),
    "Read actual version",
  );
  assert.equal(versions.length, 1);
  assert.equal(
    versions[0].sha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert.match(versions[0].scanner_version, /^ClamAV /);
  const own = await download(a, doc.id);
  assert.equal(own.status, 200);
  assert.deepEqual(new Uint8Array(await own.arrayBuffer()), bytes);
  assert.match(own.headers.get("cache-control"), /no-store/);
  assert.match(own.headers.get("content-disposition"), /^attachment/);
  for (const actor of [b, admin]) {
    assert.deepEqual(
      await checked(
        actor.client.from("documents").select("id").eq("id", doc.id),
        "Forged private metadata read",
      ),
      [],
    );
    assert.equal((await download(actor, doc.id)).status, 403);
  }
  assert.ok(
    (
      await a.client.storage
        .from("portal-clean")
        .download(versions[0].object_path)
    ).error,
    "Even an owner cannot bypass the fresh authorization gateway",
  );
  assert.ok(
    (
      await a.client.storage
        .from("portal-clean")
        .createSignedUrl(versions[0].object_path, 60)
    ).error,
    "No signed-URL revocation bypass",
  );
  const anon = make(process.env.SUPABASE_ANON_KEY);
  assert.ok(
    (await anon.storage.from("portal-clean").download(versions[0].object_path))
      .error,
  );
  assert.equal((await upload(a, bytes, "forged.pdf")).status, 415);
  const replacedBytes = new TextEncoder().encode(
    "New fictional immutable version.",
  );
  const replaceKey = randomUUID();
  const replaced = await upload(
    a,
    replacedBytes,
    "lesson-v2.txt",
    { replace_id: doc.id },
    replaceKey,
  );
  assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
  assert.equal(replaced.body.document.id, doc.id);
  assert.deepEqual(
    new Uint8Array(
      await (await download(a, doc.id, versions[0].id)).arrayBuffer(),
    ),
    bytes,
    "Old version remains unchanged",
  );
  assert.deepEqual(
    new Uint8Array(await (await download(a, doc.id)).arrayBuffer()),
    replacedBytes,
  );
  assert.equal(
    (await upload(a, replacedBytes, "lesson-v2.txt", {}, replaceKey)).status,
    403,
    "A replacement retry cannot become a new-file request",
  );
  assert.equal(
    (await upload(a, bytes, "lesson.txt", { replace_id: doc.id }, key)).status,
    403,
    "A create retry cannot become a replacement request",
  );
  const room = await checked(
    a.client.rpc("create_chat_group", {
      p_title: "Fictional file QA",
      p_member_ids: [b.id],
    }),
    "Create real file room",
  );
  rooms.push(room);
  const attachment = await upload(a, bytes, "chat.txt", {
    scope: "room",
    room_id: room,
  });
  assert.equal(attachment.status, 200, JSON.stringify(attachment.body));
  const attachmentId = attachment.body.document.id;
  await checked(
    a.client.rpc("send_message", {
      p_room_id: room,
      p_body: "Shared file",
      p_client_id: randomUUID(),
      p_document_id: attachmentId,
    }),
    "Send clean room attachment",
  );
  assert.equal((await download(b, attachmentId)).status, 200);
  assert.equal(
    (await download(admin, attachmentId)).status,
    403,
    "Admin is not a room member",
  );
  await checked(
    a.client.rpc("manage_chat_member", {
      p_room_id: room,
      p_user_id: b.id,
      p_remove: true,
    }),
    "Revoke room membership",
  );
  assert.equal(
    (await download(b, attachmentId)).status,
    403,
    "Removed member cannot use a previous document ID",
  );
  assert.ok(
    (
      await b.client.rpc("reserve_document", {
        p_name: "forged.txt",
        p_mime: "text/plain",
        p_size: 20,
        p_scope: "room",
        p_kind: "chat",
        p_room_id: room,
        p_job_id: null,
        p_client_id: randomUUID(),
      })
    ).error,
    "Removed member cannot reserve a new upload",
  );
  const eicar = new TextEncoder().encode(
    "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
  );
  const rejected = await upload(a, eicar, "antivirus-test.txt");
  assert.equal(rejected.status, 422, JSON.stringify(rejected.body));
  assert.equal(rejected.body.error, "scan_rejected");
  assert.equal((await download(a, rejected.body.document_id)).status, 409);
  if (process.env.PORTAL_TEST_MODE === "1") {
    const project = /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m.exec(
      readFileSync("supabase/config.toml", "utf8"),
    )?.[1];
    assert.ok(
      project?.startsWith("luminovia-portal-test-"),
      "Scanner interruption only permitted in the isolated test project",
    );
    scannerName = `portal_scanner_${project}`;
    execFileSync("docker", ["stop", scannerName], { stdio: "pipe" });
    scannerStopped = true;
    const pending = await upload(a, bytes, "scanner-down.txt");
    assert.equal(pending.status, 503);
    assert.equal(pending.body.error, "scanner_unavailable");
    assert.equal((await download(a, pending.body.document_id)).status, 409);
    const pendingVersion = await checked(
      service
        .from("document_versions")
        .select("client_id")
        .eq("document_id", pending.body.document_id)
        .single(),
      "Read isolated quarantine retry key",
    );
    const alteredPending = await upload(
      a,
      changedBytes,
      "scanner-down.txt",
      {},
      pendingVersion.client_id,
    );
    assert.equal(
      alteredPending.status,
      409,
      "Different bytes cannot replace an immutable quarantined retry",
    );
    execFileSync(process.execPath, ["scripts/local-scanner.mjs", "start"], {
      stdio: "pipe",
      timeout: 240000,
    });
    scannerStopped = false;
    const recovered = await upload(a, bytes, "scanner-recovered.txt");
    assert.equal(
      recovered.status,
      200,
      "Scanner must actually resume clean uploads after outage, not merely restart its container",
    );
    assert.equal(recovered.body.document.status, "clean");
  }
  await checked(
    a.client.rpc("rename_document", {
      p_id: doc.id,
      p_name: "archived.txt",
      p_delete: true,
    }),
    "Archive permitted owned document",
  );
  assert.equal(
    (await download(a, doc.id)).status,
    403,
    "Archived documents cannot be downloaded",
  );
  console.log(
    "PASS: actual Auth/Edge/Storage/ClamAV: content validation, private clean/quarantine buckets, real malware-test rejection, immutable version hashes, idempotency, admin/peer/anonymous IDOR denial, no direct storage/signed-URL bypass, clean chat attachments and immediate membership revocation." +
      (process.env.PORTAL_TEST_MODE === "1"
        ? " Isolated scanner-outage fails closed."
        : ""),
  );
} finally {
  if (scannerStopped && scannerName)
    execFileSync("docker", ["start", scannerName], { stdio: "pipe" });
  if (users.length) {
    const docs = await checked(
      service.from("documents").select("id").in("owner_id", users),
      "Select scoped test documents",
    );
    const ids = docs.map((d) => d.id);
    const messages = rooms.length
      ? await checked(
          service.from("messages").select("id").in("room_id", rooms),
          "Select scoped attachment messages",
        )
      : [];
    if (messages.length) {
      await checked(
        service
          .from("notifications")
          .delete()
          .in(
            "resource_id",
            messages.map((m) => m.id),
          ),
        "Clean scoped notifications",
      );
      await checked(
        service
          .from("messages")
          .delete()
          .in(
            "id",
            messages.map((m) => m.id),
          ),
        "Clean scoped messages",
      );
    }
    if (ids.length) {
      const versions = await checked(
        service
          .from("document_versions")
          .select("object_path")
          .in("document_id", ids),
        "Scoped object paths",
      );
      const paths = versions.map((v) => v.object_path);
      await service.storage.from("portal-clean").remove(paths);
      await service.storage.from("portal-quarantine").remove(paths);
      await checked(
        service
          .from("documents")
          .update({ current_version_id: null })
          .in("id", ids),
        "Release scoped version pointers",
      );
      await checked(
        service.from("document_versions").delete().in("document_id", ids),
        "Clean scoped versions",
      );
      await checked(
        service.from("documents").delete().in("id", ids),
        "Clean scoped documents",
      );
    }
    if (rooms.length) {
      await checked(
        service.from("chat_members").delete().in("room_id", rooms),
        "Clean scoped memberships",
      );
      await checked(
        service.from("chat_rooms").delete().in("id", rooms),
        "Clean scoped rooms",
      );
    }
    await checked(
      service.from("audit_events").delete().in("actor_id", users),
      "Clean scoped audit fixtures",
    );
    for (const id of users)
      await checked(
        service.auth.admin.deleteUser(id),
        "Remove temporary document test account",
      );
  }
}
