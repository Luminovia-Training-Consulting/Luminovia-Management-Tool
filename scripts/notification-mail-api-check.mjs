/** Real disposable Auth/PostgREST -> Python worker -> loopback-only SMTP. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { withApiFixture } from "./testing/api.mjs";
import { quoteSql as q } from "./testing/database.mjs";

// This code is fixed source, never constructed from a user value. Credentials
// enter only via the child environment, and the worker connects only to its
// fixed loopback relay endpoint. The captured SMTP dialogue stays local.
const capture = `
import json, smtplib, sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path("scripts").resolve()))
import test_notification_mail_worker as fixture
worker = fixture.worker
server = fixture.SmtpServer(sys.argv[1])
original_smtp = smtplib.SMTP
def connect(host, port, *, timeout):
    assert (host, port) == ("127.0.0.1", 2526)
    return original_smtp("127.0.0.1", server.server_address[1], timeout=timeout)
with fixture.server_context(server), patch.object(smtplib, "SMTP", connect):
    result = worker.run(config)
messages = [__import__("email").message_from_bytes(message) for message in server.messages]
print(json.dumps({"counts":result,"messages":len(messages),"ids":[message["Message-ID"] for message in messages],"recipients":[message["To"] for message in messages]}))
`;

function runWorker(url, mode = "accepted") {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", capture, mode], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PORTAL_NOTIFICATION_MAIL_ENABLED: "true",
        PORTAL_NOTIFICATION_API_URL: url,
        PORTAL_NOTIFICATION_APP_ORIGIN: "http://127.0.0.1:5273",
        PORTAL_NOTIFICATION_SERVICE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        PORTAL_NOTIFICATION_SMTP_USERNAME: "info@example.invalid",
        PORTAL_NOTIFICATION_SMTP_PASSWORD: "fictional-smtp-fixture",
          PORTAL_NOTIFICATION_SMTP_PORT: "2526",
        PORTAL_NOTIFICATION_TIMEOUT_SECONDS: "5",
        PORTAL_NOTIFICATION_BATCH: "10",
      },
    });
    let output = "";
    let bytes = 0;
    let timer;
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 65536) child.kill("SIGKILL");
      else output += chunk;
    });
    // Never relay Python tracebacks/HTTP headers to the outer test log.
    child.stderr.resume();
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Loopback mail worker could not start"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        assert.equal(code, 0, "Loopback mail worker process completed");
        resolve(JSON.parse(output));
      } catch {
        reject(
          new Error("Loopback mail worker failed or returned invalid data"),
        );
      }
    });
    timer = setTimeout(() => child.kill("SIGKILL"), 30000);
  });
}

await withApiFixture(async ({ actor, service, checked, sql, defer, url }) => {
  const owner = await actor("mail-worker-owner", "lecturer");
  const peer = await actor("mail-worker-peer", "lecturer");
  defer(async () => {
    await checked(
      service.from("notifications").delete().in("user_id", [owner.id, peer.id]),
      "Remove own email notification fixtures",
    );
  });
  // This fixture uses service-wide leases. Refuse any pre-existing opted-in
  // account rather than ever deliver another fixture's pending notification.
  assert.equal(
    await sql(
      `select count(*) from private.delivery_preferences where email_enabled and user_id not in(${q(owner.id)},${q(peer.id)})`,
    ),
    "0",
    "No unrelated email-opted-in account belongs in this disposable fixture",
  );
  const preferences = await checked(
    owner.client.rpc("delivery_preferences"),
    "Read actual channel defaults",
  );
  assert.equal(preferences.email_enabled, false);
  let current = await checked(
    owner.client.rpc("save_delivery_preferences", {
      p_expected_version: preferences.version,
      p_payload: {
        email_enabled: true,
        quiet_start: null,
        quiet_end: null,
        time_zone: "Australia/Brisbane",
      },
    }),
    "Opt own fictional account in using real Auth",
  );
  for (const rpc of [
    ["lease_notification_emails", { p_limit: 1 }],
    ["refresh_notification_reminders", { p_limit: 1 }],
    [
      "prepare_notification_email",
      { p_id: randomUUID(), p_lease_token: randomUUID() },
    ],
    [
      "finish_notification_email",
      {
        p_id: randomUUID(),
        p_lease_token: randomUUID(),
        p_outcome: "accepted",
      },
    ],
  ]) {
    assert.equal(
      (await owner.client.rpc(...rpc)).error?.code,
      "42501",
      `Browser identity cannot call ${rpc[0]}`,
    );
  }
  assert.equal(
    (await checked(peer.client.rpc("delivery_preferences"), "Peer isolation"))
      .email_enabled,
    false,
  );
  async function createNotice() {
    const id = randomUUID();
    await checked(
      service.from("notifications").insert({
        id,
        user_id: owner.id,
        kind: "claim_cancelled",
        resource_id: randomUUID(),
      }),
      "Commit own fictional cancellation notice",
    );
    return id;
  }
  const state = (id) =>
    sql(
      `select state from private.notification_email_outbox where notification_id=${q(id)}`,
    );
  const accepted = await createNotice();
  assert.equal(await state(accepted), "pending");
  const first = await runWorker(url);
  assert.equal(first.counts.accepted, 1);
  assert.equal(first.counts.rpc_errors, 0);
  assert.equal(first.messages, 1);
  assert.deepEqual(first.recipients, [owner.email]);
  assert.equal(
    first.ids[0],
    `<luminovia-notification.${await sql(`select id from private.notification_email_outbox where notification_id=${q(accepted)}`)}@luminovia.org>`,
  );
  assert.equal(await state(accepted), "accepted");

  const uncertain = await createNotice();
  const lostReply = await runWorker(url, "ambiguous_data");
  assert.equal(lostReply.counts.uncertain, 1);
  assert.equal(lostReply.messages, 1);
  assert.equal(await state(uncertain), "uncertain");
  const repeated = await runWorker(url);
  assert.equal(
    repeated.messages,
    0,
    "A later scheduled batch cannot resend uncertain DATA",
  );
  assert.equal(await state(uncertain), "uncertain");

  const suppressed = await createNotice();
  assert.equal(await state(suppressed), "pending");
  current = await checked(
    owner.client.rpc("save_delivery_preferences", {
      p_expected_version: current.version,
      p_payload: {
        email_enabled: false,
        quiet_start: null,
        quiet_end: null,
        time_zone: "Australia/Brisbane",
      },
    }),
    "Withdraw opt-in after enqueue, before delivery",
  );
  assert.equal(current.email_enabled, false);
  const revoked = await runWorker(url);
  assert.equal(revoked.messages, 0);
  assert.equal(revoked.counts.suppressed, 1);
  assert.equal(await state(suppressed), "suppressed");
  console.log(
    "Actual Auth/PostgREST/Python/loopback-SMTP acceptance, uncertain fencing, opt-out recheck and browser worker denial passed.",
  );
});