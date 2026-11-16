/** Actual disposable Auth/PostgREST + standard encryption; no provider network. */
import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import * as webPush from "web-push";
import ece from "http_ece";
import { withApiFixture } from "./testing/api.mjs";
import { quoteSql as q } from "./testing/database.mjs";
import { run, requestDetails } from "./notification-push-worker.mjs";
await withApiFixture(async ({ actor, service, checked, sql, defer, url }) => {
  const owner = await actor("push-owner", "lecturer"),
    peer = await actor("push-peer", "lecturer");
  assert.equal(
    await sql("select count(*) from private.push_subscriptions where active"),
    "0",
    "No unrelated active push device may enter a global worker fixture",
  );
  const previous = JSON.parse(
    await sql("select to_jsonb(c) from private.push_configuration c"),
  );
  defer(async () => {
    await checked(
      service.from("notifications").delete().in("user_id", [owner.id, peer.id]),
      "Delete only own push notices/outbox",
    );
    await sql(
      `update private.push_configuration set enabled=${previous.enabled},public_key=${previous.public_key === null ? "null" : q(previous.public_key)} where singleton=true`,
    );
  });
  const vapid = webPush.generateVAPIDKeys();
  await checked(
    service.rpc("configure_web_push", {
      p_public_key: vapid.publicKey,
      p_enabled: true,
    }),
    "Configure disposable public push key",
  );
  const configured = await checked(owner.client.rpc("my_push_devices"));
  assert.equal(configured.enabled, true);
  assert.equal(configured.public_key, vapid.publicKey);
  assert.equal(
    (
      await owner.client.rpc("configure_web_push", {
        p_public_key: vapid.publicKey,
        p_enabled: true,
      })
    ).error?.code,
    "42501",
  );
  const curve = createECDH("prime256v1");
  curve.generateKeys();
  const auth = randomBytes(16).toString("base64url");
  const deviceToken = randomUUID();
  const subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/fictional-api-token",
    keys: { p256dh: curve.getPublicKey().toString("base64url"), auth },
  };
  const device = await checked(
    owner.client.rpc("register_push_device", {
      p_subscription: subscription,
      p_device_token: deviceToken,
      p_label: "Fictional browser",
    }),
    "Register own real Auth push device",
  );
  assert.equal(
    (await checked(owner.client.rpc("my_push_devices"))).devices[0].id,
    device,
  );
  assert.deepEqual(
    (await checked(peer.client.rpc("my_push_devices"))).devices,
    [],
  );
  assert.equal(
    (
      await peer.client.rpc("register_push_device", {
        p_subscription: subscription,
        p_device_token: randomUUID(),
        p_label: "Forged",
      })
    ).error?.code,
    "42501",
  );
  assert.equal(
    (await owner.client.rpc("lease_notification_push", { p_limit: 1 })).error
      ?.code,
    "42501",
  );
  const notice = randomUUID();
  await checked(
    service.from("notifications").insert({
      id: notice,
      user_id: owner.id,
      kind: "claim_cancelled",
      resource_id: randomUUID(),
    }),
    "Commit scoped push notification",
  );
  let sent = 0;
  const config = {
    api: url,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    publicKey: vapid.publicKey,
    privateKey: vapid.privateKey,
    subject: "mailto:info@example.invalid",
  };
  const result = await run(config, {
    send: async (config, row) => {
      sent++;
      const details = requestDetails(config, row);
      const message = JSON.parse(
        ece
          .decrypt(details.body, {
            version: "aes128gcm",
            privateKey: curve,
            authSecret: auth,
          })
          .toString(),
      );
      assert.equal(message.token, deviceToken);
      assert.equal(message.locale, "de");
      assert.deepEqual(Object.keys(message).sort(), ["id", "locale", "token"]);
      return { outcome: "accepted", code: null };
    },
  });
  assert.equal(sent, 1);
  assert.equal(result.accepted, 1);
  assert.equal(result.rpc_errors, 0);
  assert.equal(
    await sql(
      `select state from private.notification_push_outbox where notification_id=${q(notice)}`,
    ),
    "accepted",
  );
  await checked(
    owner.client.rpc("remove_push_device", { p_device_id: device }),
    "Remove own push consent",
  );
  assert.deepEqual(
    (await checked(owner.client.rpc("my_push_devices"))).devices,
    [],
  );
  console.log(
    "PASS actual Auth/REST push consent/foreign isolation/worker denial, committed outbox through real worker/standard encryption, accepted completion and device removal; no provider network",
  );
});
