/** Wire projections decoded by the portal and documented by OpenAPI. */
import { z } from "zod";

const instant = z.iso.datetime({ offset: true });

export const enquiryStatuses = [
  "received",
  "reviewing",
  "awaiting_customer",
  "converted",
  "closed",
] as const;
const choice = z.object({ id: z.uuid(), label: z.string() });
export const enquiryContextSchema = z.object({
  organisations: z.array(choice),
  templates: z.array(choice),
  staff: z.array(choice),
  can_convert: z.boolean(),
});
const listItem = z.object({
  id: z.uuid(),
  company_name: z.string(),
  topic: z.string(),
  status: z.enum(enquiryStatuses),
  version: z.number().int().positive(),
  received_at: instant,
  updated_at: instant,
  responsible_name: z.string().nullable(),
});
export const enquiryPageSchema = z.object({
  items: z.array(listItem).max(100),
  has_more: z.boolean(),
  next_cursor: z.object({ at: instant, id: z.uuid() }).nullable(),
});
export const enquiryDetailSchema = z.object({
  id: z.uuid(),
  status: z.enum(enquiryStatuses),
  responsible_id: z.uuid().nullable(),
  organisation_id: z.uuid().nullable(),
  course_run_id: z.uuid().nullable(),
  version: z.number().int().positive(),
  received_at: instant,
  updated_at: instant,
  payload: z.object({
    company_name: z.string(),
    contact_name: z.string(),
    email: z.email(),
    phone: z.string(),
    topic: z.string(),
    message: z.string(),
    preferred_dates: z.string(),
    duration: z.string(),
    delivery_type: z.enum(["online", "onsite", "flexible"]),
    time_zone: z.string(),
    locale: z.enum(["de", "en"]),
    privacy_notice_version: z.string(),
    consent: z.literal(true),
  }),
  history: z.array(
    z.object({
      id: z.uuid(),
      action: z.string(),
      reason: z.string(),
      actor_name: z.string().nullable(),
      created_at: instant,
    }),
  ),
});
export type Enquiry = z.infer<typeof enquiryDetailSchema>;
export type EnquiryContext = z.infer<typeof enquiryContextSchema>;
export type Cursor = z.infer<typeof enquiryPageSchema>["next_cursor"];
export type EnquiryAction =
  | "status"
  | "assign"
  | "link_customer"
  | "create_customer"
  | "convert"
  | "note";
