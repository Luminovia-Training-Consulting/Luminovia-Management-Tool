import { describe, expect, it } from "vitest";
import { z } from "zod";
import { deliveryCategories } from "../notifications/channel-preferences-schema";
import { inboxWireSchema } from "../notifications/schema";
import { portalOpenApi } from "./contract";
import { isDocumentedRequest } from "./test/internal-explorer";
import { notificationPaths } from "./notifications-contract";

const backend = "https://portal.example.invalid";
const uuid = "a9bfdb1a-5094-41ee-80db-faf7161a184a";
const instant = "2041-01-01T00:00:00+00:00";
const json = "application/json";
const prefix = "/rest/v1/rpc/";
const request = (name: string) =>
  notificationPaths[(prefix + name) as keyof typeof notificationPaths].post
    .requestBody.content[json].schema;
const accepts = (name: string, body: object) =>
  z.fromJSONSchema(request(name)).safeParse(body).success;

describe("notification and device API", () => {
  it("keeps registration and device binding values in the downloadable contract", () => {
    const interactive = portalOpenApi(backend, false).paths;
    const download = portalOpenApi(backend, true).paths;
    for (const name of ["my_push_devices", "register_push_device"]) {
      const path = prefix + name;
      expect(download[path].post).toMatchObject({
        "x-luminovia-rest-gate": {
          participantSession: false,
          guestSession: false,
        },
        responses: { "200": {} },
      });
      expect(interactive).not.toHaveProperty(path);
      expect(isDocumentedRequest(backend + path, "POST", backend)).toBe(false);
    }
    expect(download[prefix + "my_push_devices"].post).toMatchObject({
      responses: {
        "200": {
          content: {
            [json]: {
              schema: {
                properties: {
                  devices: {
                    maxItems: 5,
                    items: {
                      additionalProperties: false,
                      required: [
                        "id",
                        "label",
                        "device_token",
                        "created_at",
                        "expires_at",
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(download[prefix + "register_push_device"].post).toMatchObject({
      requestBody: {
        content: {
          [json]: {
            schema: {
              properties: {
                p_subscription: {
                  properties: {
                    endpoint: { writeOnly: true },
                    keys: {
                      properties: {
                        auth: { writeOnly: true },
                        p256dh: { writeOnly: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        "500": {
          content: {
            [json]: {
              schema: {
                properties: { code: { enum: ["54000", "55000"] } },
              },
            },
          },
        },
      },
    });
    expect(interactive[prefix + "remove_push_device"].post).toBeDefined();
  });

  it("requires a complete inbox cursor and exactly one read-state selector", () => {
    expect(accepts("notification_inbox", {})).toBe(true);
    expect(
      accepts("notification_inbox", {
        p_before_at: instant,
        p_before_id: uuid,
      }),
    ).toBe(true);
    expect(accepts("notification_inbox", { p_before_at: instant })).toBe(false);
    expect(accepts("notification_inbox", { p_limit: 101 })).toBe(false);
    expect(accepts("mark_notifications", { p_ids: [uuid], p_read: true })).toBe(
      true,
    );
    expect(accepts("mark_notifications", { p_all_before: instant })).toBe(true);
    expect(
      accepts("mark_notifications", { p_all_before: instant, p_ids: [uuid] }),
    ).toBe(false);
    expect(accepts("mark_notifications", { p_ids: [] })).toBe(false);
    expect(request("mark_notifications")).toMatchObject({
      anyOf: [
        { properties: { p_ids: { uniqueItems: true, maxItems: 100 } } },
        {},
      ],
    });
  });

  it("publishes current quiet-count output and retains the learner's inbox operations", () => {
    const page = { items: [], unread_count: 0, as_of: instant };
    expect(
      inboxWireSchema.safeParse({ ...page, quiet_active: true }).success,
    ).toBe(false);
    expect(
      inboxWireSchema.safeParse({
        ...page,
        quiet_active: true,
        attention_count: 0,
      }).success,
    ).toBe(true);
    for (const name of ["notification_inbox", "mark_notifications"]) {
      expect(portalOpenApi(backend).paths[prefix + name].post).toMatchObject({
        "x-luminovia-rest-gate": {
          participantSession: true,
          guestSession: false,
        },
      });
    }
  });

  it("requires separate complete channel maps and rejects email-only receipts in Push", () => {
    const email = Object.fromEntries(
      deliveryCategories.map((category) => [category, category !== "chat"]),
    );
    const push = Object.fromEntries(
      deliveryCategories
        .filter((category) => category !== "company_orders")
        .map((category) => [category, true]),
    );
    const name = "save_notification_channel_preferences";
    const valid = { p_expected_version: 0, p_payload: { email, push } };
    expect(accepts(name, valid)).toBe(true);
    expect(
      accepts(name, {
        ...valid,
        p_payload: { email, push: { ...push, company_orders: false } },
      }),
    ).toBe(false);
    expect(
      accepts(name, { ...valid, p_payload: { email, push: { chat: true } } }),
    ).toBe(false);
  });

  it("describes separate version rules and current conflict responses for personal preferences", () => {
    for (const name of [
      "notification",
      "delivery",
      "attention",
      "notification_channel",
    ]) {
      expect(
        portalOpenApi(backend).paths[prefix + "save_" + name + "_preferences"]
          .post,
      ).toMatchObject({
        responses: {
          "409": {
            content: {
              [json]: { schema: { properties: { code: { const: "PT409" } } } },
            },
          },
        },
      });
      expect(request("save_" + name + "_preferences")).toMatchObject({
        required: ["p_payload", "p_expected_version"],
        properties: {
          p_expected_version: {
            minimum: ["attention", "notification_channel"].includes(name)
              ? 0
              : 1,
          },
        },
      });
    }
    expect(
      accepts("save_delivery_preferences", {
        p_expected_version: 1,
        p_payload: {
          email_enabled: true,
          time_zone: "Australia/Brisbane",
          quiet_start: "22:00",
          quiet_end: null,
        },
      }),
    ).toBe(false);
  });
});
