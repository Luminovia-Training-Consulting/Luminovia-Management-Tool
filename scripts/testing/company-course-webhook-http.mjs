/** Loopback HTTP witness for the real worker and disposable PostgreSQL outbox. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  dispatchCompanyWebhooks,
  webhookConfiguration,
} from "../company-course-webhook-worker.mjs";
import { createCompanyCourseWebhookReceiver } from "../examples/company-course-webhook-receiver.mjs";
import { quoteSql as q } from "./database.mjs";

/** Bind the fixture only to loopback and always close it after verification. */
async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: "http://127.0.0.1:" + server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Read the small fixture request exactly, before authenticating or parsing its bytes. */
async function readBytes(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 65536) throw new Error("fixture body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

/** Post the exact signed bytes to the owned receiver and drain the response. */
async function postReceiver(receiver, { body, headers }) {
  const response = await fetch(receiver.url + "/course-events", {
    method: "POST",
    headers,
    body,
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  await response.body?.cancel();
  return response.status;
}

/**
 * Calls the actual service-role database functions through an owned HTTP bridge.
 * The injected final transport sends to the owned receiver only. Production
 * receiver allowlists, public IP pinning and TLS checks stay unchanged.
 */
export async function verifyWebhookDeliveryHttp({
  sql,
  destination,
  subscription,
  course,
  invoice,
  eventType = "course.published",
  publishFollowups,
  publishNext,
  revoke,
  readHistory,
  replaceSubscription,
  enforcePortalGate = false,
}) {
  const [resourceKey, resourceId] = course
    ? ["course_id", course]
    : ["invoice_id", invoice];
  const key = randomBytes(24).toString("hex");
  const calls = [];
  const receiverEvents = [];
  const expectedTypes = new Set([eventType]);
  const backend = await listen(
    createServer(async (request, response) => {
      try {
        assert.equal(request.method, "POST");
        assert.equal(request.headers.apikey, key);
        assert.equal(request.headers.authorization, "Bearer " + key);
        const body = JSON.parse(await readBytes(request));
        const route = request.url;
        calls.push(route);
        const gate = enforcePortalGate
          ? "set request.method='POST'; set request.path=" +
            q(route.slice("/rest/v1".length)) +
            "; select public.require_portal_access(); "
          : "";
        let statement;
        if (route === "/rest/v1/rpc/lease_company_course_webhook") {
          assert.deepEqual(body, { p_destinations: [destination] });
          statement = `select coalesce(public.lease_company_course_webhook(array[${q(destination)}]),'null')`;
        } else if (route === "/rest/v1/rpc/prepare_company_course_webhook") {
          statement = `select coalesce(public.prepare_company_course_webhook(${q(body.p_id)},${q(body.p_token)}),'null')`;
        } else if (route === "/rest/v1/rpc/finish_company_course_webhook") {
          await sql(`set role service_role; ${gate}
          select public.finish_company_course_webhook(${q(body.p_id)},${q(body.p_token)},${q(body.p_result)})`);
          response.writeHead(204).end();
          return;
        } else {
          assert.fail("Unexpected worker RPC");
        }
        const value = await sql("set role service_role; " + gate + statement);
        response
          .writeHead(200, { "Content-Type": "application/json" })
          .end(value);
      } catch {
        response.writeHead(500).end();
      }
    }),
  );
  try {
    const directory = await mkdtemp(join(tmpdir(), "portal-receiver-"));
    const databasePath = join(directory, "events.sqlite");
    const startReceiver = (secret = subscription.signing_secret) =>
      listen(
        createCompanyCourseWebhookReceiver({
          databasePath,
          secret,
        }),
      );
    let receiver;
    let nextReceiver;
    try {
      receiver = await startReceiver();
      const config = webhookConfiguration({
        PORTAL_WEBHOOK_API_URL: backend.url,
        PORTAL_WEBHOOK_SERVICE_KEY: key,
        PORTAL_WEBHOOK_DESTINATIONS: JSON.stringify({
          [destination]: "https://example.invalid/course-events",
        }),
      });
      const pinned = { address: "8.8.8.8", family: 4 };
      let firstMessage;
      let expectedResource = resourceId;
      const send = async (url, address, message) => {
        const { body, headers } = message;
        assert.equal(url.href, "https://example.invalid/course-events");
        assert.deepEqual(address, pinned);
        assert.equal(headers.apikey, undefined);
        assert.equal(headers.authorization, undefined);
        const event = JSON.parse(body);
        assert.equal(event[resourceKey], expectedResource);
        assert.equal(headers["X-Luminovia-Event-Id"], event.id);
        assert.ok(expectedTypes.has(event.type), "Expected signed event type");
        assert.deepEqual(
          Object.keys(event).sort(),
          [resourceKey, "id", "occurred_at", "type", "version"].sort(),
        );
        firstMessage ??= message;
        if (receiverEvents.length === 1) assert.equal(body, firstMessage.body);
        if (nextReceiver) {
          assert.equal(await postReceiver(receiver, message), 401);
        }
        assert.equal(
          await postReceiver(nextReceiver ?? receiver, message),
          204,
        );
        receiverEvents.push(event);
        // Model an acknowledgement lost after the durable write.
        return receiverEvents.length === 1 ? "retry" : "delivered";
      };
      const dispatch = (resolve = async () => [pinned]) =>
        dispatchCompanyWebhooks(config, { resolve, send });
      const currentDelivery = async () =>
        JSON.parse(
          await sql(
            `select to_jsonb(d) from private.company_course_webhook_deliveries d
         where subscription_id=${q(subscription.id)} and ${resourceKey}=${q(resourceId)} and event_type=${q(eventType)}`,
          ),
        );

      const checkHistory = async (
        row,
        event,
        subscriptionId = subscription.id,
      ) => {
        assert.equal(
          row.event_id,
          event.id,
          "The queue and receiver share an event ID",
        );
        if (!readHistory) return;
        const history = await readHistory();
        const receipt = history
          .find(({ id }) => id === subscriptionId)
          ?.deliveries.find(({ id }) => id === row.id);
        assert.deepEqual(receipt, {
          id: row.id,
          event_id: event.id,
          event_type: event.type,
          occurred_at: event.occurred_at,
          state: row.state,
          attempts: row.attempts,
        });
      };

      assert.equal(await dispatch(), 1);
      assert.equal(receiverEvents.length, 1);
      let row = await currentDelivery();
      assert.equal(row.state, "pending");
      assert.equal(row.attempts, 1);
      assert.equal(row.lease_token, null);
      await checkHistory(row, receiverEvents[0]);
      assert.equal(
        await dispatch(),
        0,
        "Database backoff blocks premature HTTP delivery",
      );
      await sql(
        `update private.company_course_webhook_deliveries set available_at=now() where id=${q(row.id)}`,
      );
      await receiver.close();
      receiver = await startReceiver();
      assert.equal(await dispatch(), 1);
      assert.equal(receiverEvents.length, 2);
      assert.deepEqual(receiverEvents[0], receiverEvents[1]);
      row = await currentDelivery();
      assert.equal(row.state, "delivered");
      assert.equal(row.attempts, 2);
      assert.equal(row.lease_token, null);
      await checkHistory(row, receiverEvents[0]);
      assert.deepEqual(calls.slice(0, 4), [
        "/rest/v1/rpc/lease_company_course_webhook",
        "/rest/v1/rpc/prepare_company_course_webhook",
        "/rest/v1/rpc/finish_company_course_webhook",
        "/rest/v1/rpc/lease_company_course_webhook",
      ]);

      if (publishFollowups) {
        const types = await publishFollowups();
        for (const type of types) expectedTypes.add(type);
        assert.equal(await dispatch(), types.length);
        assert.deepEqual(
          receiverEvents
            .slice(2)
            .map(({ type }) => type)
            .sort(),
          [...types].sort(),
          "Only committed follow-up events reach the receiver",
        );
      }
      const accepted = receiverEvents.length;
      const receipts = new Map(
        receiverEvents.map((event) => [event.id, event]),
      );
      assert.equal(
        receipts.size,
        accepted - 1,
        "Only the first acknowledgement is lost",
      );
      const checkInbox = () => {
        const inbox = new DatabaseSync(databasePath, { readOnly: true });
        try {
          const persisted = inbox
            .prepare("SELECT event_json FROM course_event_inbox ORDER BY rowid")
            .all();
          assert.deepEqual(
            persisted.map(({ event_json }) => JSON.parse(event_json)),
            [...receipts.values()],
          );
        } finally {
          inbox.close();
        }
      };
      checkInbox();
      assert.equal(
        await sql(
          `select count(*) from private.company_course_webhook_deliveries
          where subscription_id=${q(subscription.id)} and state='delivered'`,
        ),
        String(receipts.size),
      );

      await publishNext();
      assert.equal(
        await dispatch(async () => {
          await revoke();
          return [pinned];
        }),
        1,
      );
      assert.equal(
        receiverEvents.length,
        accepted,
        "Revocation after leasing must stop network delivery",
      );
      assert.equal(
        await sql(
          `select count(*) from private.company_course_webhook_deliveries
          where subscription_id=${q(subscription.id)} and state='cancelled'`,
        ),
        "1",
      );

      if (replaceSubscription) {
        const replacement = await replaceSubscription(() => dispatch());
        assert.notEqual(replacement.subscription.id, subscription.id);
        // Do not include signing keys in assertion error output.
        assert.ok(
          replacement.subscription.signing_secret !==
            subscription.signing_secret,
        );
        nextReceiver = await startReceiver(
          replacement.subscription.signing_secret,
        );
        assert.equal(await postReceiver(nextReceiver, firstMessage), 401);
        expectedResource = replacement.resource;
        await replacement.publish();
        assert.equal(await dispatch(), 1);
        assert.equal(receiverEvents.length, accepted + 1);
        const newest = receiverEvents.at(-1);
        assert.ok(!receipts.has(newest.id));
        receipts.set(newest.id, newest);
        checkInbox();
        const delivered = JSON.parse(
          await sql(
            `select to_jsonb(d) from private.company_course_webhook_deliveries d
          where subscription_id=${q(replacement.subscription.id)} and event_id=${q(newest.id)}`,
          ),
        );
        assert.equal(delivered.state, "delivered");
        assert.equal(delivered.attempts, 1);
        await checkHistory(delivered, newest, replacement.subscription.id);
        return {
          retired: subscription.id,
          active: replacement.subscription.id,
        };
      }
    } finally {
      await nextReceiver?.close();
      await receiver?.close();
      await rm(directory, { recursive: true, force: true });
    }
  } finally {
    await backend.close();
  }
}
