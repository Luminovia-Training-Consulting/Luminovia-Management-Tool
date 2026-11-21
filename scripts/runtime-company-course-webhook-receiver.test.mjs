/** Exercise the shipped receiver over loopback with a disposable on-disk inbox. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { signedWebhook } from "./company-course-webhook-worker.mjs";
import { createCompanyCourseWebhookReceiver } from "./examples/company-course-webhook-receiver.mjs";
import { webhookBodyLimit } from "./examples/verify-company-course-webhook.mjs";

const secret = "ab".repeat(32);
const command = fileURLToPath(
  new URL("./examples/company-course-webhook-receiver.mjs", import.meta.url),
);

/** Only fictional IDs and the documented v1 metadata cross the HTTP boundary. */
function event(fields = {}) {
  return {
    id: randomUUID(),
    type: "course.schedule_changed",
    version: 1,
    course_id: randomUUID(),
    occurred_at: "2026-11-21T09:00:00.000Z",
    ...fields,
  };
}

/** Each test opens independent receiver connections on the same private fixture DB. */
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "luminovia-receiver-test-"));
  const databasePath = join(directory, "inbox.sqlite");
  const servers = [];
  t.after(async () => {
    await Promise.all(
      servers
        .filter((server) => server.listening)
        .map((server) => new Promise((resolve) => server.close(resolve))),
    );
    await rm(directory, { recursive: true, force: true });
  });
  return {
    databasePath,
    async listen() {
      const server = createCompanyCourseWebhookReceiver({
        databasePath,
        secret,
      });
      servers.push(server);
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      return {
        url: `http://127.0.0.1:${server.address().port}/course-events`,
        close: () => new Promise((resolve) => server.close(resolve)),
      };
    },
    rows() {
      const database = new DatabaseSync(databasePath, { readOnly: true });
      try {
        return database
          .prepare("SELECT event_json FROM course_event_inbox ORDER BY rowid")
          .all()
          .map((row) => JSON.parse(row.event_json));
      } finally {
        database.close();
      }
    },
  };
}

/** Let the HTTP client calculate its length if a test substitutes raw bytes. */
function deliver(url, message, body = message.body, extraHeaders) {
  const headers = new Headers(message.headers);
  headers.delete("content-length");
  for (const [name, value] of Object.entries(extraHeaders ?? {}))
    headers.set(name, value);
  return fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(3000),
  });
}

test("parallel deliveries and a restart leave one durable receipt per event", async (t) => {
  const inbox = await fixture(t);
  const left = await inbox.listen();
  const right = await inbox.listen();
  const newest = event();
  const signed = signedWebhook(newest, secret);
  const statuses = await Promise.all(
    Array.from(
      { length: 12 },
      async (_, index) =>
        (await deliver(index % 2 ? left.url : right.url, signed)).status,
    ),
  );
  assert.deepEqual(statuses, Array(12).fill(204));
  assert.deepEqual(inbox.rows(), [newest]);
  await left.close();
  await right.close();
  const restarted = await inbox.listen();
  const reorderedKeys = Object.fromEntries(Object.entries(newest).reverse());
  assert.equal(
    (await deliver(restarted.url, signedWebhook(reorderedKeys, secret))).status,
    204,
  );
  const conflicting = { ...newest, type: "course.updated" };
  assert.equal(
    (await deliver(restarted.url, signedWebhook(conflicting, secret))).status,
    409,
  );
  const older = event({ occurred_at: "2026-11-21T08:00:00.000Z" });
  assert.equal(
    (await deliver(restarted.url, signedWebhook(older, secret))).status,
    204,
  );
  assert.deepEqual(inbox.rows(), [newest, older]);
});

test("tampered, stale, mismatched and malformed signed bytes never reach the inbox", async (t) => {
  const inbox = await fixture(t);
  const { url } = await inbox.listen();
  const payload = event();
  const signed = signedWebhook(payload, secret);
  assert.equal((await deliver(url, signed, signed.body + " ")).status, 401);
  assert.equal(
    (await deliver(url, signedWebhook(payload, "cd".repeat(32)))).status,
    401,
  );
  assert.equal(
    (
      await deliver(
        url,
        signedWebhook({ ...payload, extra: "outside-v1" }, secret),
      )
    ).status,
    401,
  );
  assert.equal(
    (await deliver(url, signedWebhook(payload, secret, Date.now() - 301_000)))
      .status,
    401,
  );
  assert.equal(
    (
      await deliver(url, signed, signed.body, {
        "X-Luminovia-Event-Id": randomUUID(),
      })
    ).status,
    401,
  );
  // The payload is still JSON after lossy decoding. A valid HMAC must not
  // turn malformed UTF-8 into accepted course metadata.
  const raw = Buffer.concat([
    Buffer.from(signed.body.slice(0, -1) + ',"invalid":"'),
    Buffer.from([0xff]),
    Buffer.from('"}'),
  ]);
  const timestamp = signed.headers["X-Luminovia-Timestamp"];
  const signature = createHmac("sha256", Buffer.from(secret, "hex"))
    .update(timestamp + ".")
    .update(raw)
    .digest("hex");
  assert.equal(
    (
      await deliver(url, signed, raw, {
        "X-Luminovia-Signature": "v1=" + signature,
      })
    ).status,
    401,
  );
  assert.deepEqual(inbox.rows(), []);
});

test("HTTP method, media type and declared or chunked size gates precede acceptance", async (t) => {
  const inbox = await fixture(t);
  const { url } = await inbox.listen();
  const signed = signedWebhook(event(), secret);
  const method = await fetch(url);
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "POST");
  assert.equal((await deliver(url + "?unknown", signed)).status, 404);
  assert.equal(
    (await deliver(url, signed, signed.body, { "Content-Type": "text/plain" }))
      .status,
    415,
  );
  assert.equal(
    (await deliver(url, signed, signed.body, { "Content-Encoding": "gzip" }))
      .status,
    415,
  );
  assert.equal(
    (await deliver(url, signed, Buffer.alloc(webhookBodyLimit + 1))).status,
    413,
  );
  const chunkedStatus = await new Promise((resolve, reject) => {
    const outgoing = request(
      url,
      { method: "POST", headers: { "Content-Type": "application/json" } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    outgoing.on("error", reject);
    outgoing.write(Buffer.alloc(webhookBodyLimit / 2));
    outgoing.end(Buffer.alloc(webhookBodyLimit / 2 + 1));
  });
  assert.equal(chunkedStatus, 413);
  assert.deepEqual(inbox.rows(), []);
});

test("the worker receives a retryable status when SQLite cannot commit", async (t) => {
  const inbox = await fixture(t);
  const { url } = await inbox.listen();
  const payload = event();
  const signed = signedWebhook(payload, secret);
  const blocker = new DatabaseSync(inbox.databasePath);
  blocker.exec("BEGIN IMMEDIATE");
  try {
    assert.equal((await deliver(url, signed)).status, 503);
    assert.deepEqual(inbox.rows(), []);
  } finally {
    blocker.exec("ROLLBACK");
    blocker.close();
  }
  assert.equal((await deliver(url, signed)).status, 204);
  assert.deepEqual(inbox.rows(), [payload]);
});

test(
  "the CLI listens on loopback, creates a private inbox and lists receipts without the key",
  { timeout: 5000 },
  async (t) => {
    const { databasePath } = await fixture(t);
    const env = {
      ...process.env,
      LUMINOVIA_WEBHOOK_RECEIVER_DB: databasePath,
      LUMINOVIA_WEBHOOK_RECEIVER_PORT: "0",
    };
    const receiver = spawn(process.execPath, [command], {
      env: { ...env, LUMINOVIA_WEBHOOK_RECEIVER_SECRET: secret },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stopped = once(receiver, "exit");
    t.after(async () => {
      if (receiver.exitCode === null && receiver.signalCode === null)
        receiver.kill();
      await stopped;
    });
    const lines = createInterface({ input: receiver.stdout });
    const [ready] = await once(lines, "line", {
      signal: AbortSignal.timeout(3000),
    });
    const url = /http:\/\/127\.0\.0\.1:[1-9][0-9]*\/course-events$/.exec(
      ready,
    )?.[0];
    assert.ok(url);
    assert.equal(ready.includes(secret), false);
    const payload = event();
    assert.equal(
      (await deliver(url, signedWebhook(payload, secret))).status,
      204,
    );
    assert.equal((await stat(databasePath)).mode & 0o777, 0o600);
    receiver.kill("SIGTERM");
    assert.deepEqual(await stopped, [0, null]);
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [command, "receipts"],
      { env: { ...env, LUMINOVIA_WEBHOOK_RECEIVER_SECRET: "" } },
    );
    assert.deepEqual(JSON.parse(stdout).event, payload);
    assert.equal(stderr, "");
  },
);
