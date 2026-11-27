/** Shared company operational defaults and the exact reviewed preset selection. */
import { z } from "zod";
import { deliveryMode, meetingPlatforms } from "../training/delivery-schema.ts";
import { validZone } from "../../lib/dates.ts";

const clock = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
export const operationalPresetConfig = z.object({
  time_zone: z.string().refine(validZone).nullable(),
  starts_at: clock.nullable(),
  ends_at: clock.nullable(),
  contact_id: z.uuid().nullable(),
  delivery: z
    .object({
      mode: deliveryMode,
      venue_id: z.uuid().nullable(),
      meeting_platform: z.enum(meetingPlatforms).nullable(),
      teaching_instructions: z.string().max(2000),
    })
    .nullable(),
});
export const operationalPresetPayload = z.object({
  name: z.string().trim().min(1).max(120),
  config: operationalPresetConfig,
  archived: z.boolean(),
});
export const operationalPreset = operationalPresetPayload
  .omit({ archived: true })
  .extend({
    id: z.uuid(),
    revision: z.number().int().positive(),
    archived_at: z.iso.datetime({ offset: true }).nullable(),
  });
export const operationalPresetCommand = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().positive(),
  apply_delivery: z.boolean(),
});
export const operationalPresetSelection = operationalPresetCommand.extend({
  organisation_id: z.uuid(),
  starts_at: clock.nullable(),
  ends_at: clock.nullable(),
});
export type OperationalPreset = z.infer<typeof operationalPreset>;
