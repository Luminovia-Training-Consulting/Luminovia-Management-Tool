/** Own external delivery choices shared by the settings editor and native API contract. */
import { z } from "zod";
import { zeroVersion } from "./schema.ts";

const categoryDeliverySchema = z.strictObject({
  chat: z.boolean(),
  forum: z.boolean(),
  job_updates: z.boolean(),
  assignments: z.boolean(),
  courses: z.boolean(),
  events: z.boolean(),
  invoices: z.boolean(),
  company_orders: z.boolean(),
  reminders: z.boolean(),
  announcements: z.boolean(),
  other: z.boolean(),
});

/** Company order confirmations have email delivery only. */
export const notificationChannelPreferencesPayloadSchema = z.strictObject({
  email: categoryDeliverySchema,
  push: categoryDeliverySchema.omit({ company_orders: true }),
});

/** Version zero identifies an account that has never saved channel choices. */
export const notificationChannelPreferencesSchema = z.object({
  channels: notificationChannelPreferencesPayloadSchema,
  version: zeroVersion,
});

export const deliveryCategories = categoryDeliverySchema.keyof().options;

export type NotificationChannelPreferences = z.infer<
  typeof notificationChannelPreferencesSchema
>;
