/** Checks the worker contract without sending requests to a real receiver. */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  dispatchCompanyWebhooks,
  webhookConfiguration,
} from "./company-course-webhook-worker.mjs";

const destination = "11111111-2222-3333-4444-555555555555/course-sync";
const url = "https://example.invalid/webhooks/courses";
const env = {
  PORTAL_WEBHOOK_API_URL: "http://127.0.0.1:54321",
  PORTAL_WEBHOOK_SERVICE_KEY: "fictional-service-key",
  PORTAL_WEBHOOK_DESTINATIONS: JSON.stringify({ [destination]: url }),
};
const event = {
  id: "event-1",
  type: "course.schedule_changed",
  version: 1,
  course_id: "course-1",
};
const signingSecret = "ab".repeat(32);
const lease = { id: "delivery-1", token: "lease-1", destination };
const publicIp = { address: "8.8.8.8", family: 4 };

/** Record every dispatched stage in order and return canned database results. */
function fixture(prepared) {
  const stages = [];
  let leased = false;
  return {
    stages,
    async call(_config, action, args) {
      stages.push([action, args]);
      if (action === "lease_company_course_webhook") {
        if (leased) return null;
        leased = true;
        return lease;
      }
      if (action === "prepare_company_course_webhook") return prepared;
      return null;
    },
  };
}

test("an operator must bind a tenant and alias to one exact HTTPS receiver", () => {
  assert.equal(
    webhookConfiguration(env).destinations.get(destination).href,
    url,
  );
  for (const invalid of [
    "http://example.invalid/hook",
    "https://example.invalid:8443/hook",
    "https://a:b@example.invalid/hook",
    "https://example.invalid/hook?key=secret",
    "https://192.168.0.2/hook",
  ]) {
    assert.throws(() =>
      webhookConfiguration({
        ...env,
        PORTAL_WEBHOOK_DESTINATIONS: JSON.stringify({ [destination]: invalid }),
      }),
    );
  }
});

test("a committed event is signed after DNS and live authorization with its stable event ID", async () => {
  const { call, stages } = fixture({
    event,
    destination,
    signing_secret: signingSecret,
  });
  const count = await dispatchCompanyWebhooks(webhookConfiguration(env), {
    call,
    resolve: async (hostname) => {
      assert.equal(hostname, "example.invalid");
      assert.equal(stages.at(-1)[0], "lease_company_course_webhook");
      return [publicIp];
    },
    send: async (receiver, pinnedIp, { body, headers }) => {
      assert.equal(stages.at(-1)[0], "prepare_company_course_webhook");
      assert.equal(receiver.href, url);
      assert.deepEqual(pinnedIp, publicIp);
      assert.deepEqual(JSON.parse(body), event);
      assert.equal(headers["X-Luminovia-Event-Id"], event.id);
      const expected = createHmac("sha256", Buffer.from(signingSecret, "hex"))
        .update(headers["X-Luminovia-Timestamp"] + "." + body)
        .digest("hex");
      assert.equal(headers["X-Luminovia-Signature"], "v1=" + expected);
      return "delivered";
    },
  });
  assert.equal(count, 1);
  assert.deepEqual(stages[2], [
    "finish_company_course_webhook",
    {
      p_id: lease.id,
      p_token: lease.token,
      p_result: "delivered",
    },
  ]);
});

test("blocked DNS addresses or revoked authorization never reach a receiver", async () => {
  for (const [addresses, outcome] of [
    [[publicIp, { address: "127.0.0.1", family: 4 }], "failed"],
    [[publicIp], "cancelled"],
  ]) {
    const { call, stages } = fixture(null);
    await dispatchCompanyWebhooks(webhookConfiguration(env), {
      call,
      resolve: async () => addresses,
      send: async () =>
        assert.fail("Revoked or locally routed event reached a receiver"),
    });
    assert.equal(stages.at(-2)[1].p_result, outcome);
  }
});
