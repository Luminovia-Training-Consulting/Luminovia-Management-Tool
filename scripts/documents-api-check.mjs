/**
 * Real Auth/HTTP checks for private document versions, scan status and access boundaries.
 * Separate fictional identities verify actual API results and denied access; responses are not browser mocks.
 */
import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";

import {readFileSync} from "node:fs";
import {createClient} from "@supabase/supabase-js";
import {assertPasswordOnly} from "./testing/password-only.mjs";
import {portalJsonResponse} from "./testing/openapi-contract.mjs";

process.loadEnvFile(".env.test.local");
const url = process.env.SUPABASE_URL;
assert.ok(
    url && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
    "Document tests are local only.",
);
const origin = new URL(process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173")
    .origin;
/** Creates a separate SDK client without persistent sessions or automatic session refresh. */
const make = (key) =>
    createClient(url, key, {
        auth: {persistSession: false, autoRefreshToken: false},
    });
const service = make(process.env.SUPABASE_SERVICE_ROLE_KEY),
    users = [],
    rooms = [];
/** Requires actual SDK success before returning the response data. */
const checked = async (request, label) => {
    const {data, error} = await request;
    assert.equal(error, null, `${label}: ${error?.message}`);
    return data;
};

/** Creates separate fictional accounts and signs them in through Auth; their IDs belong only to the fixture. */
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
        service.from("user_roles").insert({user_id: created.user.id, role}),
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
    return {client, id: created.user.id};
}

/** Reads the test actor's current session token for actual authenticated gateway requests. */
async function headers(actor) {
    const {session} = await checked(
        actor.client.auth.getSession(),
        "Read current local Auth session",
    );
    return {
        Origin: origin,
        Authorization: `Bearer ${session.access_token}`,
        apikey: process.env.SUPABASE_ANON_KEY,
    };
}

/** Sends real fixture bytes through the authenticated file endpoint; scanning and release remain server responsibilities. */
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
    if (context.message_only) form.set("message_only", "true");
    const response = await fetch(`${url}/functions/v1/files`, {
        method: "POST",
        headers: await headers(actor),
        body: form,
    });
    return {status: response.status, body: await response.json()};
}

/** Requests the authorised bytes for this identity and exact document version through the gateway. */
async function download(actor, id, versionId) {
    return await fetch(`${url}/functions/v1/files`, {
        method: "POST",
        headers: {...(await headers(actor)), "Content-Type": "application/json"},
        body: JSON.stringify({action: "download", id, version_id: versionId}),
    });
}

let scannerStopped = false,
    scannerName;
try {
    const a = await fixture("lecturer"),
        b = await fixture("lecturer"),
        admin = await fixture("admin");
    await assertPasswordOnly(admin.client);
    const bytes = new TextEncoder().encode("Fictional secure lesson material.");
    const key = randomUUID();
    const stored = await upload(a, bytes, "lesson.txt", {}, key);
    assert.equal(stored.status, 200, JSON.stringify(stored.body));
    const {document: doc} = portalJsonResponse("/functions/v1/files", stored.status, stored.body);
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
    assert.equal(own.headers.get("cache-control"), "no-store, private");
    assert.equal(own.headers.get("x-content-type-options"), "nosniff");
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
    const empty = await upload(a, new Uint8Array());
    assert.deepEqual(empty, {status: 413, body: {error: "file_size"}});
    const oversized = await fetch(`${url}/functions/v1/files`, {
        method: "POST",
        headers: {...(await headers(a)), "Content-Type": "application/json"},
        body: JSON.stringify({action: "download", id: doc.id, padding: " ".repeat(4096)}),
        signal: AbortSignal.timeout(30_000),
    });
    assert.equal(oversized.status, 413);
    assert.deepEqual(
        portalJsonResponse("/functions/v1/files", oversized.status, await oversized.json()),
        {error: "file_size"},
    );
    // A supplied version must be a UUID. Only an omitted version selects the current file.
    for (const versionId of [null, "", false]) {
        const invalid = await download(a, doc.id, versionId);
        assert.equal(invalid.status, 400);
        assert.deepEqual(await invalid.json(), {error: "invalid_request"});
    }
    const replacedBytes = new TextEncoder().encode(
        "New fictional immutable version.",
    );
    const replaceKey = randomUUID();
    const replaced = await upload(
        a,
        replacedBytes,
        "lesson-v2.txt",
        {replace_id: doc.id},
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
        (await upload(a, bytes, "lesson.txt", {replace_id: doc.id}, key)).status,
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
    const privateAttachment = await upload(a, bytes, "message-only.txt", {
        scope: "room",
        room_id: room,
        message_only: true,
    });
    assert.equal(privateAttachment.status, 200);
    const privateId = privateAttachment.body.document.id;
    assert.equal(
        (await download(b, privateId)).status,
        403,
        "unposted attachment is private",
    );
    const privateMessage = await checked(
        a.client.rpc("send_message", {
            p_room_id: room,
            p_body: "Private attachment",
            p_client_id: randomUUID(),
            p_document_id: privateId,
        }),
        "Send message-only attachment",
    );
    assert.equal(
        (await download(b, privateId)).status,
        200,
        "live message grants download",
    );
    await checked(
        a.client.rpc("delete_message", {p_message_id: privateMessage}),
        "Delete attachment message",
    );
    assert.equal(
        (await download(b, privateId)).status,
        403,
        "deleting last message revokes the old URL",
    );
    assert.equal(
        (await download(a, privateId)).status,
        200,
        "owner retains own attachment",
    );
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
        execFileSync("docker", ["stop", scannerName], {stdio: "pipe"});
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
        execFileSync("docker", ["start", scannerName], {stdio: "pipe"});
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
            const messageIds = messages.map((message) => message.id);
            await checked(
                service.from("notifications").delete().in("resource_id", messageIds),
                "Clean scoped notifications",
            );
            await checked(
                service
                    .from("chat_message_revisions")
                    .delete()
                    .in("message_id", messageIds),
                "Clean scoped message revisions",
            );
            await checked(
                service.from("messages").delete().in("id", messageIds),
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
                    .update({current_version_id: null})
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
