import { z } from "zod";

export const contactVisibilityInput = z.object({
  email_visible: z.boolean(),
  phone_visible: z.boolean(),
});

export const contactPreferencesSchema = contactVisibilityInput.extend({
  version: z.number().int().nonnegative(),
  can_share: z.boolean(),
  email_address: z.string().nullable(),
  phone_number: z.string().nullable(),
});

export const personContactSchema = z.object({
  email: z.string().nullable(),
  phone: z.string().nullable(),
});

export const topicPreferencesSchema = z.object({
  visible: z.boolean(),
  version: z.number().int().nonnegative(),
  can_share: z.boolean(),
});
