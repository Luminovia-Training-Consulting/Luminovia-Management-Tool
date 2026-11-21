/** Loopback HTTP witness for the real worker and disposable PostgreSQL outbox. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import {
  dispatchCompanyWebhooks,
  webhookConfiguration,
} from "../company-course-webhook-worker.mjs";
import { verifyCompanyCourseWebhook } from "../examples/verify-company-course-webhook.mjs";
import { quoteSql as q } from "./database.mjs";

/** Bind the fixture only to loopback and always close it after verification. */
async function listen(handler) {
  const server = createServer(handler);
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
  publishNext,
  revoke,
  enforcePortalGate = false,
}) {
  const key = randomBytes(24).toString("hex");
  const calls = [];
  const receiverEvents = [];
  const processed = new Set();
  const backend = await listen(async (request, response) => {
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
  });
  try {
    const receiver = await listen(async (request, response) => {
      try {
        assert.equal(request.method, "POST");
        assert.equal(request.url, "/course-events");
        assert.equal(request.headers.apikey, undefined);
        assert.equal(request.headers.authorization, undefined);
        const event = verifyCompanyCourseWebhook({
          body: await readBytes(request),
          headers: request.headers,
          secret: subscription.signing_secret,
        });
        assert.ok(event);
        assert.equal(event.course_id, course);
        assert.equal(event.type, "course.published");
        receiverEvents.push(event);
        if (processed.has(event.id)) {
          response.writeHead(204).end();
          return;
        }
        // Simulate applying an event but losing the acknowledgement. A repeat
        // is acknowledged without executing the same business change twice.
        processed.add(event.id);
        response.writeHead(503).end();
      } catch {
        response.writeHead(400).end();
      }
    });
    try {
      const config = webhookConfiguration({
        PORTAL_WEBHOOK_API_URL: backend.url,
        PORTAL_WEBHOOK_SERVICE_KEY: key,
        PORTAL_WEBHOOK_DESTINATIONS: JSON.stringify({
          [destination]: "https://example.invalid/course-events",
        }),
      });
      const pinned = { address: "8.8.8.8", family: 4 };
      const send = async (url, address, { body, headers }) => {
        assert.equal(url.href, "https://example.invalid/course-events");
        assert.deepEqual(address, pinned);
        const response = await fetch(receiver.url + "/course-events", {
          method: "POST",
          headers,
          body,
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        });
        await response.body?.cancel();
        assert.ok([204, 503].includes(response.status));
        return response.status === 204 ? "delivered" : "retry";
      };
      const dispatch = (resolve = async () => [pinned]) =>
        dispatchCompanyWebhooks(config, { resolve, send });
      const currentDelivery = async () =>
        JSON.parse(
          await sql(
            `select to_jsonb(d) from private.company_course_webhook_deliveries d
         where subscription_id=${q(subscription.id)} and course_id=${q(course)}`,
          ),
        );

      assert.equal(await dispatch(), 1);
      assert.equal(receiverEvents.length, 1);
      let row = await currentDelivery();
      assert.equal(row.state, "pending");
      assert.equal(row.attempts, 1);
      assert.equal(row.lease_token, null);
      assert.equal(
        await dispatch(),
        0,
        "Database backoff blocks premature HTTP delivery",
      );
      await sql(
        `update private.company_course_webhook_deliveries set available_at=now() where id=${q(row.id)}`,
      );
      assert.equal(await dispatch(), 1);
      assert.equal(receiverEvents.length, 2);
      assert.deepEqual(receiverEvents[0], receiverEvents[1]);
      assert.equal(processed.size, 1);
      row = await currentDelivery();
      assert.equal(row.state, "delivered");
      assert.equal(row.attempts, 2);
      assert.equal(row.lease_token, null);
      assert.deepEqual(calls.slice(0, 4), [
        "/rest/v1/rpc/lease_company_course_webhook",
        "/rest/v1/rpc/prepare_company_course_webhook",
        "/rest/v1/rpc/finish_company_course_webhook",
        "/rest/v1/rpc/lease_company_course_webhook",
      ]);

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
        2,
        "Revocation after leasing must stop network delivery",
      );
      assert.equal(
        await sql(
          `select count(*) from private.company_course_webhook_deliveries
          where subscription_id=${q(subscription.id)} and state='cancelled'`,
        ),
        "1",
      );
    } finally {
      await receiver.close();
    }
  } finally {
    await backend.close();
  }
}
