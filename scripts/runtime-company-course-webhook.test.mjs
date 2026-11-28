/** Checks the worker contract without sending requests to a real receiver. */
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, createServer as createTlsServer } from "node:tls";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  checkWebhookDestination,
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

test("the receiver check never opens a socket for an unknown alias or a private DNS answer", async () => {
  const noSocket = () => assert.fail("An unapproved address reached TLS");
  assert.deepEqual(
    await checkWebhookDestination(env, "unconfigured", { connect: noSocket }),
    { status: "unknown_destination" },
  );
  for (const [addresses, status] of [
    [[], "dns_unavailable"],
    [[publicIp, { address: "::1", family: 6 }], "address_denied"],
  ]) {
    assert.deepEqual(
      await checkWebhookDestination(env, destination, {
        resolve: async () => addresses,
        connect: noSocket,
      }),
      { status },
    );
  }
  assert.deepEqual(
    await checkWebhookDestination(env, destination, {
      resolve: async () => {
        throw new Error("Fictional DNS failure");
      },
      connect: noSocket,
    }),
    { status: "dns_unavailable" },
  );
});

test("the CLI checks an alias without any backend configuration", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("./company-course-webhook-worker.mjs", import.meta.url),
      ),
      "--check-destination",
      "unconfigured",
    ],
    {
      env: { PORTAL_WEBHOOK_DESTINATIONS: env.PORTAL_WEBHOOK_DESTINATIONS },
      encoding: "utf8",
      timeout: 2000,
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    status: "unknown_destination",
  });
});

/** Generate a short-lived certificate trusted only by the loopback test client. */
async function withReceiverCertificate(run) {
  const directory = await mkdtemp(join(tmpdir(), "luminovia-webhook-tls-"));
  try {
    const keyPath = join(directory, "receiver.key");
    const certPath = join(directory, "receiver.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=example.invalid",
        "-addext",
        "subjectAltName=DNS:example.invalid",
        "-keyout",
        keyPath,
        "-out",
        certPath,
      ],
      { stdio: "ignore" },
    );
    const [key, cert] = await Promise.all([
      readFile(keyPath),
      readFile(certPath),
    ]);
    await run({ key, cert });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("the receiver check verifies a pinned TLS peer and independently checks the hostname", async () => {
  await withReceiverCertificate(async ({ key, cert }) => {
    const server = createTlsServer({ key, cert });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const { port } = server.address();
      const resolver = {
        resolve: async () => [publicIp],
        connect(options) {
          assert.equal(options.host, publicIp.address);
          assert.equal(options.port, 443);
          assert.equal(options.rejectUnauthorized, true);
          return connect({ ...options, host: "127.0.0.1", port, ca: cert });
        },
      };
      const destinationsOnly = {
        PORTAL_WEBHOOK_DESTINATIONS: env.PORTAL_WEBHOOK_DESTINATIONS,
      };
      assert.deepEqual(
        await checkWebhookDestination(destinationsOnly, destination, resolver),
        {
          status: "tls_verified",
        },
      );
      assert.deepEqual(
        await checkWebhookDestination(
          {
            PORTAL_WEBHOOK_DESTINATIONS: JSON.stringify({
              [destination]: "https://other.example.invalid/course-events",
            }),
          },
          destination,
          resolver,
        ),
        { status: "tls_failed" },
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test("the production sender classifies actual HTTPS receiver responses and never follows redirects", async (t) => {
  await withReceiverCertificate(async ({ key, cert }) => {
    let status;
    let requests = 0;
    const receiver = https.createServer({ key, cert }, (request, response) => {
      requests++;
      request.resume();
      assert.equal(request.url, "/webhooks/courses");
      assert.equal(request.method, "POST");
      response.writeHead(status, { Location: "/do-not-follow" }).end();
    });
    receiver.listen(0, "127.0.0.1");
    await once(receiver, "listening");
    try {
      const request = https.request;
      // Preserve TLS verification and the real sender, but bind its one socket
      // to the fixture. No request can leave this machine.
      t.mock.method(https, "request", (target, options, callback) => {
        assert.equal(target.href, url);
        options.lookup(target.hostname, { all: true }, (error, pinned) => {
          assert.ifError(error);
          assert.deepEqual(pinned, [publicIp]);
        });
        return request(
          target,
          {
            ...options,
            ca: cert,
            port: receiver.address().port,
            lookup(_hostname, { all }, resolve) {
              const address = "127.0.0.1";
              if (all) resolve(null, [{ address, family: 4 }]);
              else resolve(null, address, 4);
            },
          },
          callback,
        );
      });

      const cases = [
        [204, "delivered"],
        [408, "retry"],
        [429, "retry"],
        [503, "retry"],
        [401, "failed"],
        [409, "failed"],
        [302, "failed"],
      ];
      for (const [httpStatus, expected] of cases) {
        status = httpStatus;
        const backend = fixture({
          destination,
          event,
          signing_secret: signingSecret,
        });
        const processed = await dispatchCompanyWebhooks(
          webhookConfiguration(env),
          {
            ...backend,
            resolve: async () => [publicIp],
          },
        );
        assert.equal(processed, 1);
        assert.deepEqual(
          backend.stages.find(
            ([action]) => action === "finish_company_course_webhook",
          ),
          [
            "finish_company_course_webhook",
            { p_id: lease.id, p_token: lease.token, p_result: expected },
          ],
        );
      }
      assert.equal(requests, cases.length);
    } finally {
      await new Promise((resolve) => receiver.close(resolve));
    }
  });
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

test("a full webhook batch drains ready backlog without hitting the normal poll pause", async () => {
  const controller = new AbortController();
  const order = [];
  const ready = [10, 10, 4, 0];

  await watchCompanyWebhooks(webhookConfiguration(env), {
    signal: controller.signal,
    seconds: 60,
    dispatch: async () => ready.shift(),
    report: ({ processed }) => order.push(processed),
    wait: async (milliseconds) => {
      assert.equal(milliseconds, 60000);
      order.push("wait");
      if (order.filter((entry) => entry === "wait").length === 2)
        controller.abort();
    },
  });

  assert.deepEqual(order, [10, 10, 4, "wait", "wait"]);
});

test("webhook catch-up yields after three full batches even if more events are ready", async () => {
  const controller = new AbortController();
  let attempts = 0;

  await watchCompanyWebhooks(webhookConfiguration(env), {
    signal: controller.signal,
    seconds: 60,
    dispatch: async () => {
      attempts++;
      return 10;
    },
    report() {},
    wait: async (milliseconds) => {
      assert.equal(milliseconds, 60000);
      controller.abort();
    },
  });

  assert.equal(attempts, 3);
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
