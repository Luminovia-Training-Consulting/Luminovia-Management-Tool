import { expect, test } from "@playwright/test";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import * as webPush from "web-push";
import { actor, api, checked, login } from "./helpers/accounts-support";
test("push device consent is private, removable, bilingual and online-confirmed", async ({
  page,
}, testInfo) => {
  const owner = await actor("Fictional Push owner", "lecturer"),
    peer = await actor("Fictional Push peer", "lecturer");
  const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
    client = api(process.env.SUPABASE_ANON_KEY!),
    other = api(process.env.SUPABASE_ANON_KEY!);
  const vapid = webPush.generateVAPIDKeys();
  try {
    await checked(
      service.rpc("configure_web_push", {
        p_public_key: vapid.publicKey,
        p_enabled: true,
      }),
    );
    await checked(
      client.auth.signInWithPassword({
        email: owner.email,
        password: process.env.E2E_PASSWORD!,
      }),
    );
    await checked(
      other.auth.signInWithPassword({
        email: peer.email,
        password: process.env.E2E_PASSWORD!,
      }),
    );
    function subscription() {
      const curve = createECDH("prime256v1");
      curve.generateKeys();
      return {
        endpoint: `https://fcm.googleapis.com/fcm/send/fictional-${randomUUID()}`,
        keys: {
          p256dh: curve.getPublicKey().toString("base64url"),
          auth: randomBytes(16).toString("base64url"),
        },
      };
    }
    await checked(
      client.rpc("register_push_device", {
        p_subscription: subscription(),
        p_device_token: randomUUID(),
        p_label: "Fictional own device",
      }),
    );
    await checked(
      other.rpc("register_push_device", {
        p_subscription: subscription(),
        p_device_token: randomUUID(),
        p_label: "PRIVATE FOREIGN DEVICE",
      }),
    );
    await login(page, owner.email);
    await page.goto("/settings");
    const delivery = page
      .locator("details.settings-section")
      .filter({ hasText: "Ruhezeiten & Zustellung" });
    await delivery.locator("summary").click();
    await expect(delivery).toHaveJSProperty("open", true);
    const panel = page.locator("section").filter({
      has: page.getByRole("heading", {
        name: /Push auf deinen Geräten|Push on your devices/,
      }),
    });
    await expect(
      panel.getByText("Fictional own device", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByText("PRIVATE FOREIGN DEVICE", { exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Sprache", { exact: true }).selectOption("en");
    await expect(
      page.getByRole("heading", { name: "Push on your devices", exact: true }),
    ).toBeVisible();
    await page.context().setOffline(true);
    await expect(
      panel.getByRole("button", { name: "Remove device", exact: true }),
    ).toBeDisabled();
    await page.context().setOffline(false);
    await panel
      .getByRole("button", { name: "Remove device", exact: true })
      .click();
    await expect(
      panel.getByText("Push setting confirmed.", { exact: true }),
    ).toBeVisible();
    expect((await checked(client.rpc("my_push_devices"))).devices).toEqual([]);
    expect((await checked(other.rpc("my_push_devices"))).devices).toHaveLength(
      1,
    );
    await page.reload();
    await expect(
      page.getByText("Fictional own device", { exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("push-device-settings.png"),
      fullPage: true,
    });
  } finally {
    await page.context().setOffline(false);
    await checked(
      service.rpc("configure_web_push", {
        p_public_key: vapid.publicKey,
        p_enabled: false,
      }),
    );
    await client.auth.signOut();
    await other.auth.signOut();
    for (const id of [owner.id, peer.id]) {
      await checked(service.from("notifications").delete().eq("user_id", id));
      await checked(service.from("audit_events").delete().eq("actor_id", id));
      await checked(service.auth.admin.deleteUser(id));
    }
  }
});
