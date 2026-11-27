/** Persist explicit defaults and nullable session changes, with separate venue and meeting facts. */
import { z } from "zod";

export const venueFields = [
  "name",
  "street",
  "house_number",
  "address_line",
  "postal_code",
  "city",
  "region",
  "country",
  "building",
  "floor",
  "room",
  "time_zone",
  "contact_name",
  "contact_phone",
  "contact_email",
  "reception",
  "access",
  "parking",
  "transport",
  "accessibility",
  "equipment",
  "notes",
] as const;
export type VenueField = (typeof venueFields)[number];
export const venueDetails = z.partialRecord(
  z.enum(venueFields),
  z.string().max(1000),
);
export const venueSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  details: venueDetails,
  is_default: z.boolean(),
  archived_at: z.iso.datetime({ offset: true }).nullable(),
});
export type Venue = z.infer<typeof venueSchema>;
export const deliveryModes = ["online", "onsite", "hybrid"] as const;
export const deliveryMode = z.enum(deliveryModes);
export const reportingMode = z.enum(["online", "onsite", "hybrid", "mixed"]);
export const meetingPlatforms = [
  "teams",
  "zoom",
  "meet",
  "webex",
  "other",
] as const;

export const deliveryConfig = z.object({
  mode: deliveryMode.optional(),
  venue_id: z.uuid().nullish(),
  venue: venueDetails.nullish(),
  meeting_platform: z.enum(meetingPlatforms).nullish(),
  meeting_url: z.string().nullish(),
  meeting_id: z.string().nullish(),
  meeting_access: z.string().nullish(),
  teaching_instructions: z.string().nullish(),
});
export type DeliveryConfig = z.infer<typeof deliveryConfig>;
export const deliveryView = z.object({
  organisation_id: z.uuid().nullable(),
  revision: z.number().int().nonnegative(),
  mode: reportingMode,
  can_edit: z.boolean(),
  overrides_enabled: z.boolean(),
  defaults: deliveryConfig.nullable(),
  sessions: z.array(
    z.object({
      id: z.uuid(),
      starts_at: z.iso.datetime({ offset: true }),
      ends_at: z.iso.datetime({ offset: true }),
      effective: deliveryConfig.nullable(),
      override: deliveryConfig.nullable(),
    }),
  ),
});
export const offerDelivery = z.object({
  mode: reportingMode,
  locations: z.array(
    z.object({ city: z.string().nullable(), country: z.string().nullable() }),
  ),
});
