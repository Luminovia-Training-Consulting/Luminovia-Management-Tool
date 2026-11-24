/** Reviewed native contracts for the actor-owned notification and device APIs. */
import { z } from "zod";
import {
  jsonContent as json,
  postgrestErrorResponse as error,
} from "./postgrest-content.ts";
import {
  attentionPayloadSchema,
  attentionWireSchema,
  deliveryPayloadSchema,
  deliveryWireSchema,
  inboxWireSchema,
  notificationPreferencesPayloadSchema,
  notificationPreferencesSchema,
  positiveVersion,
  pushDevicesWireSchema,
  savedAttentionSchema,
  zeroVersion,
} from "../notifications/schema.ts";
import type { nativeDownloadPaths } from "./native-contract.ts";

const id = z.uuid();
const instant = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();
const noBody = z.strictObject({});
const filters = {
  p_unread_only: z.boolean().optional().meta({ default: false }),
  p_limit: z.number().int().min(1).max(100).optional().meta({ default: 40 }),
};
const inboxRequest = z.union([
  z.strictObject({
    ...filters,
    p_before_at: z.null().optional(),
    p_before_id: z.null().optional(),
  }),
  z.strictObject({ ...filters, p_before_at: instant, p_before_id: id }),
]);
const markState = z.boolean().optional().meta({ default: true });
const markRequest = z.union([
  z.strictObject({
    p_ids: z.array(id).min(1).max(100).meta({ uniqueItems: true }),
    p_all_before: z.null().optional(),
    p_read: markState,
  }),
  z.strictObject({
    p_ids: z.null().optional(),
    p_all_before: instant,
    p_read: markState,
  }),
]);
const deviceSubscription = z.strictObject({
  endpoint: z
    .string()
    .min(20)
    .max(2048)
    .regex(
      /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com)\/[^\s?#\\]+$/,
    )
    .meta({ writeOnly: true }),
  expirationTime: z
    .number()
    .nullable()
    .optional()
    .describe(
      "Optional browser metadata. The server records a 90-day validity window.",
    ),
  keys: z.strictObject({
    p256dh: z
      .string()
      .regex(/^[A-Za-z0-9_-]{87}$/)
      .meta({ writeOnly: true }),
    auth: z
      .string()
      .regex(/^[A-Za-z0-9_-]{22}$/)
      .meta({ writeOnly: true }),
  }),
});
const conflict = error(
  "The expected version is stale. Reload the current preferences before editing.",
  z.literal("PT409"),
);

function operation(
  operationId: string,
  summary: string,
  description: string,
  request: z.ZodType,
  response: z.ZodType,
  options: {
    optionalBody?: boolean;
    versioned?: boolean;
    registration?: boolean;
  } = {},
) {
  return {
    post: {
      operationId,
      tags: ["Notifications"],
      summary,
      description,
      requestBody: { required: !options.optionalBody, content: json(request) },
      responses: {
        "200": {
          description: "The current result for the authenticated account.",
          content: json(response),
        },
        "400": error("The supplied data are invalid."),
        "401": error("Authentication required."),
        "403": error("The current account does not have access."),
        "404": error("The supplied named arguments do not match this RPC."),
        ...(options.versioned ? { "409": conflict } : {}),
        ...(options.registration
          ? {
              "500": error(
                "Device registration is disabled or the account has reached five current devices.",
                z.enum(["55000", "54000"]),
              ),
            }
          : {}),
      },
    },
  };
}
const versioned = (p_payload: z.ZodType, initialZero = false) =>
  z.strictObject({
    p_payload,
    p_expected_version: initialZero ? zeroVersion : positiveVersion,
  });

export const notificationPaths = {
  "/rest/v1/rpc/notification_inbox": operation(
    "readNotificationInbox",
    "Read the current account's notification inbox",
    "Returns currently visible notices, newest first by creation time and ID. Pass both cursor fields from the final row to page further. Unread count covers the current visible inbox independently of page and filter. Quiet mode adds the visible high-priority unread count. Destinations are scoped internal paths or null.",
    inboxRequest,
    inboxWireSchema,
    { optionalBody: true },
  ),
  "/rest/v1/rpc/mark_notifications": operation(
    "markOwnNotifications",
    "Change the read state of own notifications",
    "Select one to one hundred distinct own IDs or send the server's as_of timestamp as an inclusive cutoff. A mixed foreign-ID request fails atomically. Participant accounts can change currently visible receipts only. Returns the number of rows affected.",
    markRequest,
    count,
  ),
  "/rest/v1/rpc/refresh_my_notifications": operation(
    "refreshOwnNotifications",
    "Generate the current account's due reminders",
    "Checks due sessions, contracts and eligible work owned by the current account and returns the number of new notifications created. A refresh repeated within one minute returns zero.",
    noBody,
    count,
    { optionalBody: true },
  ),
  "/rest/v1/rpc/notification_preferences": operation(
    "readNotificationPreferences",
    "Read own notification category preferences",
    "Read the current values and expected version for the chat, forum, job update and reminder switches.",
    noBody,
    notificationPreferencesSchema,
    { optionalBody: true },
  ),
  "/rest/v1/rpc/save_notification_preferences": operation(
    "saveNotificationPreferences",
    "Save own notification category preferences",
    "Submit the four category switches and the version from the last read. The response contains the committed values and new version.",
    versioned(notificationPreferencesPayloadSchema),
    notificationPreferencesSchema,
    { versioned: true },
  ),
  "/rest/v1/rpc/attention_preferences": operation(
    "readAttentionPreferences",
    "Read own in-app quiet hours",
    "An account without a saved setting reports version zero, disabled quiet hours and its profile time zone.",
    noBody,
    attentionWireSchema,
    { optionalBody: true },
  ),
  "/rest/v1/rpc/save_attention_preferences": operation(
    "saveAttentionPreferences",
    "Save own in-app quiet hours",
    "Use distinct HH:mm start and end times with an IANA time zone. Windows may cross midnight. Send zero only for the initial save and the last read version for edits. Inbox records and their read state are retained.",
    versioned(attentionPayloadSchema, true),
    savedAttentionSchema,
    { versioned: true },
  ),
  "/rest/v1/rpc/delivery_preferences": operation(
    "readDeliveryPreferences",
    "Read own email delivery preferences",
    "Returns the email delivery switch, daily quiet-hour range, IANA time zone and expected version.",
    noBody,
    deliveryWireSchema,
    { optionalBody: true },
  ),
  "/rest/v1/rpc/save_delivery_preferences": operation(
    "saveDeliveryPreferences",
    "Save own email delivery preferences",
    "Provide both quiet hours as distinct HH:mm times or clear them together with null values. Use the current IANA time zone and expected version. Returns the saved values and their new version.",
    versioned(deliveryPayloadSchema),
    deliveryWireSchema,
    { versioned: true },
  ),
  "/rest/v1/rpc/remove_push_device": operation(
    "removeOwnPushDevice",
    "Deactivate an own push device",
    "Returns true if the device row belongs to the caller, including an already deactivated device. Unknown and other accounts' devices return false.",
    z.strictObject({ p_device_id: id }),
    z.boolean(),
  ),
};

const devicePaths = {
  "/rest/v1/rpc/my_push_devices": operation(
    "readOwnPushDevices",
    "Read own current push devices",
    "Returns up to five active unexpired registrations with their labels and device-binding tokens. The installation public VAPID key is optional while delivery is unconfigured. Endpoint URLs and authentication keys are omitted from the response.",
    noBody,
    pushDevicesWireSchema,
    { optionalBody: true },
  ),
  "/rest/v1/rpc/register_push_device": operation(
    "registerOwnPushDevice",
    "Register or renew an own browser push subscription",
    "Requires enabled installation delivery. The endpoint and encryption values are the browser's scoped subscription credentials. Re-registering the same own endpoint renews its 90-day validity. Another account's registered endpoint is denied. Returns the device ID.",
    z.strictObject({
      p_subscription: deviceSubscription,
      p_device_token: id,
      p_label: z.string().trim().min(1).max(80).regex(/[^ ]/),
    }),
    id,
    { registration: true },
  ),
};

export function notificationCredentialPaths(
  nativePaths: ReturnType<typeof nativeDownloadPaths>,
) {
  return Object.fromEntries(
    Object.entries(devicePaths).map(([path, { post }]) => [
      path,
      { post: { ...nativePaths[path].post, ...post } },
    ]),
  );
}
