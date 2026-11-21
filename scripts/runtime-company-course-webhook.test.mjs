/** Checks the worker contract without sending requests to a real receiver. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  dispatchCompanyWebhooks,
  signedWebhook,
  watchCompanyWebhooks,
  webhookConfiguration,
} from "./company-course-webhook-worker.mjs";
import { verifyCompanyCourseWebhook } from "./examples/verify-company-course-webhook.mjs";

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

test("the opt-in worker polls sequentially and recovers after failures", async () => {
  const controller = new AbortController();
  const config = webhookConfiguration(env);
  const order = [];
  const reports = [];
  let attempt = 0;
  await watchCompanyWebhooks(config, {
    signal: controller.signal,
    seconds: 21,
    report: (result) => reports.push(result),
    dispatch: async (candidate, { signal }) => {
      assert.equal(candidate, config);
      assert.equal(signal, controller.signal);
      order.push("dispatch");
      if (++attempt === 1) throw new Error("fixture connection error");
      return 2;
    },
    wait: async (milliseconds, _value, { signal }) => {
      assert.equal(milliseconds, 21000);
      assert.equal(signal, controller.signal);
      order.push("wait");
      if (attempt === 2) controller.abort();
    },
  });
  assert.deepEqual(order, ["dispatch", "wait", "dispatch", "wait"]);
  assert.deepEqual(reports, [
    { status: "failed" },
    { status: "processed", processed: 2 },
  ]);
});

test("shutdown finishes an existing lease and never starts another", async () => {
  const controller = new AbortController();
  const { call, stages } = fixture({
    event,
    destination,
    signing_secret: signingSecret,
  });
  const processed = await dispatchCompanyWebhooks(webhookConfiguration(env), {
    signal: controller.signal,
    call,
    resolve: async () => [publicIp],
    send: async () => {
      controller.abort();
      return "delivered";
    },
  });
  assert.equal(processed, 1);
  assert.deepEqual(
    stages.map(([name]) => name),
    [
      "lease_company_course_webhook",
      "prepare_company_course_webhook",
      "finish_company_course_webhook",
    ],
  );
});

test("receiver verification uses raw bytes, the current timestamp and the matching event ID", () => {
  const now = 1795256000000;
  const payload = {
    ...event,
    id: "11111111-2222-3333-4444-555555555555",
    occurred_at: "2026-11-21T10:00:00+00:00",
    course_id: "55555555-4444-3333-2222-111111111111",
  };
  const { headers, body } = signedWebhook(payload, signingSecret, now);
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const input = {
    body: Buffer.from(body),
    headers: normalized,
    secret: signingSecret,
    now,
  };
  assert.deepEqual(verifyCompanyCourseWebhook(input), payload);
  assert.equal(
    verifyCompanyCourseWebhook({ ...input, body: Buffer.from(body + " ") }),
    null,
  );
  assert.equal(
    verifyCompanyCourseWebhook({ ...input, now: now + 300001 }),
    null,
  );
  assert.equal(
    verifyCompanyCourseWebhook({
      ...input,
      headers: { ...normalized, "x-luminovia-event-id": payload.course_id },
    }),
    null,
  );
  assert.equal(
    verifyCompanyCourseWebhook({ ...input, secret: "a".repeat(64) }),
    null,
  );
});

test(
  "the private CLI watch process exits cleanly on SIGTERM",
  { timeout: 5000 },
  async () => {
    const server = createServer((request, response) => {
      request.resume();
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end("null");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const request = once(server, "request", {
      signal: AbortSignal.timeout(3000),
    });
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL("./company-course-webhook-worker.mjs", import.meta.url),
        ),
        "--watch",
      ],
      {
        env: {
          ...process.env,
          ...env,
          PORTAL_WEBHOOK_API_URL: "http://127.0.0.1:" + server.address().port,
          PORTAL_WEBHOOK_POLL_SECONDS: "15",
        },
        stdio: "ignore",
      },
    );
    const exited = once(child, "exit", { signal: AbortSignal.timeout(4500) });
    try {
      // Observe failures in either branch without leaving an unhandled rejection.
      const first = await Promise.race([
        request.then(() => "leased"),
        exited.then(() => "exited"),
      ]);
      assert.equal(first, "leased");
      assert.ok(child.kill("SIGTERM"));
      assert.deepEqual(await exited, [0, null]);
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
