/** Shared notification, preference and push projections for the browser and OpenAPI. */
import { z } from "zod";
import { validZone } from "../../lib/dates.ts";

const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const zeroVersion = z.number().int().min(0).max(2147483647);
export const positiveVersion = zeroVersion.min(1);

// eslint-disable-next-line no-control-regex
const localPath = z.string().regex(/^\/(?!\/)[^\\\x00-\x20\x7f]*$/);

/** Validate notification data and require a strictly internal, non-executable navigation destination. */
const notificationItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  assignment_replaced: z.literal(true).optional(),
  created_at: z.string().datetime({ offset: true }),
  read_at: z.string().datetime({ offset: true }).nullable(),
  // Server-resolved internal destinations only; malformed API data must never
  // turn a notification into an external or executable link.
  href: localPath.nullable(),
  title: z.string(),
});
/**
 * Accept legacy inbox pages and validate quiet-hour attention when present.
 * Active quiet summaries require a count bounded by the complete unread total;
 * inactive/legacy pages omit that count. The server decides current visibility.
 */
const inboxProjection = z.object({
  items: z.array(notificationItemSchema).max(100),
  unread_count: z.number().int().nonnegative(),
  as_of: z.iso.datetime({ offset: true }),
});

export const inboxWireSchema = z.discriminatedUnion("quiet_active", [
  inboxProjection.extend({ quiet_active: z.literal(false) }),
  inboxProjection.extend({
    quiet_active: z.literal(true),
    attention_count: z.number().int().nonnegative(),
  }),
]);

// Accept legacy pages in the browser. The current deployed wire projection
// always carries quiet_active, and only quiet mode includes attention_count.
export const inboxPageSchema = inboxProjection
  .extend({
    quiet_active: z.boolean().optional(),
    attention_count: z.number().int().nonnegative().optional(),
  })
  .refine((page) =>
    page.quiet_active === true
      ? page.attention_count !== undefined &&
        page.attention_count <= page.unread_count
      : page.attention_count === undefined,
  );
/** Four category flags retain their independent positive CAS version; quiet-hour settings use a separate API. */
const categoryFields = {
  chat: z.boolean(),
  forum: z.boolean(),
  job_updates: z.boolean(),
  reminders: z.boolean(),
};
export const notificationPreferencesPayloadSchema =
  z.strictObject(categoryFields);
export const notificationPreferencesSchema = z.object({
  ...categoryFields,
  version: positiveVersion,
});
/** Notification type derived from runtime-validated inbox data. */
export type NotificationItem = z.infer<typeof notificationItemSchema>;
/** Validated inbox page with server-provided unread count and read-state timestamp. */
export type InboxPage = z.infer<typeof inboxPageSchema>;
/** Versioned personal categories derived directly from the validated schema. */
export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;

const attentionFields = {
  enabled: z.boolean(),
  start_time: localTime,
  end_time: localTime,
  time_zone: z
    .string()
    .min(1)
    .max(100)
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: zone }).format();
        return true;
      } catch {
        return false;
      }
    }),
};
const differs = (value: { start_time: string; end_time: string }) =>
  value.start_time !== value.end_time;
export const attentionPayloadSchema = z
  .strictObject(attentionFields)
  .refine(differs);
export const attentionSchema = z
  .object({
    ...attentionFields,
    version: zeroVersion,
  })
  .refine(differs);
export const savedAttentionSchema = z
  .object({
    ...attentionFields,
    version: positiveVersion,
  })
  .refine(differs);
export const attentionWireSchema = z.union([
  z.strictObject({
    enabled: z.literal(false),
    start_time: z.literal("22:00"),
    end_time: z.literal("07:00"),
    time_zone: attentionFields.time_zone,
    version: z.literal(0),
  }),
  savedAttentionSchema,
]);
export type AttentionPreferences = z.infer<typeof attentionSchema>;

const deliveryFields = {
  email_enabled: z.boolean(),
  time_zone: z.string().min(1).refine(validZone),
};
const clearedDelivery = z.strictObject({
  ...deliveryFields,
  quiet_start: z.null(),
  quiet_end: z.null(),
});
const timedDelivery = z.strictObject({
  ...deliveryFields,
  quiet_start: localTime,
  quiet_end: localTime,
});
export const deliveryPayloadSchema = z
  .union([clearedDelivery, timedDelivery])
  .refine(
    ({ quiet_start, quiet_end }) =>
      quiet_start === null || quiet_start !== quiet_end,
  );
export const deliveryWireSchema = z.union([
  clearedDelivery.extend({ version: positiveVersion }),
  timedDelivery.extend({ version: positiveVersion }),
]);
export const deliveryPreferencesSchema = z
  .object({
    ...deliveryFields,
    quiet_start: localTime.nullable(),
    quiet_end: localTime.nullable(),
    version: positiveVersion,
  })
  .refine(
    ({ quiet_start, quiet_end }) =>
      (quiet_start === null && quiet_end === null) ||
      (quiet_start !== null && quiet_end !== null && quiet_start !== quiet_end),
  );
export type DeliveryPreferences = z.infer<typeof deliveryPreferencesSchema>;

export const pushDevicesSchema = z.object({
  enabled: z.boolean(),
  public_key: z
    .string()
    .regex(/^[A-Za-z0-9_-]{87}$/)
    .nullable(),
  devices: z.array(
    z.object({
      id: z.string().uuid(),
      label: z.string(),
      device_token: z.string().uuid(),
      created_at: z.string().datetime({ offset: true }),
      expires_at: z.string().datetime({ offset: true }),
    }),
  ),
});
export const pushDevicesWireSchema = pushDevicesSchema.extend({
  devices: pushDevicesSchema.shape.devices.max(5),
});
