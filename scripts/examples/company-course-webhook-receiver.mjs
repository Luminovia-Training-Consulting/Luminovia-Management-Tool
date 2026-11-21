/** Runnable course-event receiver for one subscription behind a TLS reverse proxy. */
import { once } from "node:events";
import { createServer } from "node:http";
import { isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import {
  isWebhookSigningSecret,
  verifyCompanyCourseWebhook,
  webhookBodyLimit,
} from "./verify-company-course-webhook.mjs";

/**
 * A single committed row is both the receipt and the queued work. Each event ID
 * has one row even when deliveries overlap or the receiver restarts.
 */
function openInbox(databasePath) {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      PRAGMA busy_timeout = 250;
      PRAGMA synchronous = EXTRA;
      CREATE TABLE IF NOT EXISTS course_event_inbox (
        id TEXT PRIMARY KEY NOT NULL,
        event_json TEXT NOT NULL,
        received_at TEXT NOT NULL
      ) STRICT;
    `);
    const insert = database.prepare(`
      INSERT INTO course_event_inbox (id, event_json, received_at) VALUES (?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);
    const existing = database.prepare(
      "SELECT event_json FROM course_event_inbox WHERE id = ?",
    );
    return {
      accept(event, received) {
        // Store only the documented envelope. Fix property order so an equivalent
        // event signed with different JSON key ordering is still a replay.
        const { id, type, version, occurred_at, course_id } = event;
        const envelope = JSON.stringify({
          id,
          type,
          version,
          occurred_at,
          course_id,
        });
        return (
          insert.run(id, envelope, received).changes === 1 ||
          existing.get(id)?.event_json === envelope
        );
      },
      close: () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

/** Preserve the bytes used for HMAC and bound memory even for chunked requests. */
async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > webhookBodyLimit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

/**
 * Return an HTTP server that authenticates and commits an event before acknowledging
 * it. The caller owns the listener. Closing it drains requests and releases SQLite.
 */
export function createCompanyCourseWebhookReceiver({ databasePath, secret }) {
  if (
    !databasePath ||
    !isAbsolute(databasePath) ||
    !isWebhookSigningSecret(secret)
  )
    throw new Error("invalid_webhook_receiver_configuration");
  const inbox = openInbox(databasePath);
  const server = createServer(
    {
      headersTimeout: 5000,
      requestTimeout: 10000,
      connectionsCheckingInterval: 1000,
    },
    async (request, response) => {
      const reply = (status, headers = {}) =>
        response
          .writeHead(status, { "Cache-Control": "no-store", ...headers })
          .end();
      if (request.url !== "/course-events")
        return reply(404, { Connection: "close" });
      if (request.method !== "POST")
        return reply(405, { Allow: "POST", Connection: "close" });
      const contentType = request.headers["content-type"]
        ?.split(";")[0]
        .trim()
        .toLowerCase();
      const encoding = request.headers["content-encoding"];
      if (
        contentType !== "application/json" ||
        (encoding && encoding !== "identity")
      )
        return reply(415, { Connection: "close" });
      if (Number(request.headers["content-length"]) > webhookBodyLimit)
        return reply(413, { Connection: "close" });

      let body;
      try {
        body = await readBody(request);
      } catch {
        // The client has already lost the request. No event was committed.
        return response.destroy();
      }
      if (!body) return reply(413, { Connection: "close" });
      const now = Date.now();
      const event = verifyCompanyCourseWebhook({
        body,
        headers: request.headers,
        secret,
        now,
      });
      // V1 has five required envelope fields. Unknown fields would change what
      // the sender signed without appearing in the durable receipt.
      if (!event || Object.keys(event).length !== 5) return reply(401);
      let accepted;
      try {
        accepted = inbox.accept(event, new Date(now).toISOString());
      } catch {
        // A busy or unavailable inbox must never acknowledge uncommitted work.
        return reply(503);
      }
      return reply(accepted ? 204 : 409);
    },
  );
  server.once("close", inbox.close);
  return server;
}

/** Print a bounded read-only view to a local operator, without the signing key. */
function printReceipts(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    for (const row of database
      .prepare(
        "SELECT event_json, received_at FROM course_event_inbox ORDER BY rowid DESC LIMIT 50",
      )
      .iterate()) {
      console.log(
        JSON.stringify({
          event: JSON.parse(row.event_json),
          received_at: row.received_at,
        }),
      );
    }
  } finally {
    database.close();
  }
}

/** Run on loopback. Operators expose only the POST route through their own HTTPS proxy. */
async function runCommand(args, env) {
  const databasePath = env.LUMINOVIA_WEBHOOK_RECEIVER_DB;
  if (!databasePath || !isAbsolute(databasePath) || args.length > 1)
    throw new Error("invalid_webhook_receiver_arguments");
  if (args[0] === "receipts") return printReceipts(databasePath);
  if (args.length !== 0) throw new Error("invalid_webhook_receiver_arguments");
  const port = Number(env.LUMINOVIA_WEBHOOK_RECEIVER_PORT ?? 8788);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("invalid_webhook_receiver_port");
  process.umask(0o077);
  const server = createCompanyCourseWebhookReceiver({
    databasePath,
    secret: env.LUMINOVIA_WEBHOOK_RECEIVER_SECRET,
  });
  const stop = () => server.close();
  try {
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
    console.log(
      `Course webhook receiver listening on http://127.0.0.1:${server.address().port}/course-events`,
    );
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    await once(server, "close");
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    if (server.listening) stop();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await runCommand(process.argv.slice(2), process.env);
  } catch {
    console.error(
      "Course webhook receiver failed. Check its private database path, signing key and local port.",
    );
    process.exitCode = 1;
  }
}
