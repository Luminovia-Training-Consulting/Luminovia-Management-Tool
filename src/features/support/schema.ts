/** Wire projections decoded by the portal and documented by OpenAPI. */
import { z } from "zod";

const instant = z.iso.datetime({ offset: true });

export const supportCategories = [
  "technical",
  "account",
  "assignment",
  "scheduling",
  "documents",
  "contract",
  "invoice",
  "general",
  "feature",
] as const;
export const supportStatuses = [
  "open",
  "in_progress",
  "waiting_for_user",
  "resolved",
  "closed",
] as const;
const ticketSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  category: z.enum(supportCategories),
  status: z.enum(supportStatuses),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  version: z.number().int().positive(),
  requester_name: z.string(),
  assigned_name: z.string().nullable(),
  created_at: instant,
  updated_at: instant,
  mine: z.boolean(),
});
export const supportTicketDetailSchema = ticketSchema.extend({
  description: z.string(),
  assigned_to: z.uuid().nullable(),
  resolved_at: instant.nullable(),
  closed_at: instant.nullable(),
  can_manage: z.boolean(),
  can_reopen: z.boolean(),
  course_run_id: z.uuid().nullable(),
  claim_id: z.uuid().nullable(),
  organisation_id: z.uuid().nullable(),
  messages: z.array(
    z.object({
      id: z.uuid(),
      author_name: z.string(),
      body: z.string(),
      internal: z.boolean(),
      created_at: instant,
    }),
  ),
  events: z.array(
    z.object({
      id: z.uuid(),
      actor_name: z.string(),
      action: z.string(),
      reason: z.string(),
      previous_status: z.string().nullable(),
      new_status: z.string().nullable(),
      created_at: instant,
    }),
  ),
  attachments: z.array(
    z.object({
      id: z.uuid(),
      document_id: z.uuid(),
      version_id: z.uuid(),
      name: z.string(),
      internal: z.boolean(),
      created_at: instant,
    }),
  ),
});
export const supportContextSchema = z.object({
  can_manage: z.boolean(),
  staff: z.array(z.object({ id: z.uuid(), name: z.string() })),
  courses: z.array(z.object({ id: z.uuid(), label: z.string() })),
  claims: z.array(z.object({ id: z.uuid(), label: z.string() })),
  organisations: z.array(z.object({ id: z.uuid(), label: z.string() })),
  report: z.array(
    z.object({
      category: z.enum(supportCategories),
      total: z.number(),
      outstanding: z.number(),
      resolution_hours: z.number().nullable(),
    }),
  ),
});
export const supportPageSchema = z.object({
  items: z.array(ticketSchema).max(100),
  has_more: z.boolean(),
  next_cursor: z.object({ at: instant, id: z.uuid() }).nullable(),
});
export const newTicketSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.enum(supportCategories),
  description: z.string().trim().min(1).max(12000),
  course_run_id: z.union([z.literal(""), z.uuid()]),
  claim_id: z.union([z.literal(""), z.uuid()]),
  organisation_id: z.union([z.literal(""), z.uuid()]),
});
export type SupportTicket = z.infer<typeof supportTicketDetailSchema>;
export type Cursor = z.infer<typeof supportPageSchema>["next_cursor"];
export type SupportContext = z.infer<typeof supportContextSchema>;
export type SupportAction =
  | "reply"
  | "internal_note"
  | "status"
  | "assign"
  | "priority"
  | "reopen"
  | "links"
  | "attach";
