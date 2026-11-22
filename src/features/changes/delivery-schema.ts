import { z } from "zod";

export const deliveryOutcomes = [
  "completed",
  "partial",
  "interrupted",
  "cancelled",
] as const;
export const deliveryScopes = ["own", "management", "customer"] as const;
export const deliveryReviewActions = [
  "confirm",
  "dispute",
  "request_correction",
] as const;
export const deliveryStatuses = [
  "missing",
  "draft",
  "submitted",
  "confirmed",
  "disputed",
  "correction_requested",
] as const;

const time = z.iso.datetime({ offset: true });
export const deliveryDraftSchema = z.strictObject({
  outcome: z.enum(deliveryOutcomes),
  actual_start: time.nullable(),
  actual_end: time.nullable(),
  time_zone: z.string(),
  notes: z.string().max(4000),
  correction_reason: z.string().max(1000),
});
const submission = deliveryDraftSchema.extend({
  id: z.uuid(),
  revision: z.number().int().positive(),
  created_at: time,
  notes: deliveryDraftSchema.shape.notes.nullable(),
  correction_reason: deliveryDraftSchema.shape.correction_reason.nullable(),
});
export const deliverySessionSchema = z.object({
  session_id: z.uuid(),
  claim_id: z.uuid(),
  job_id: z.uuid(),
  course_run_id: z.uuid().nullable(),
  title: z.string(),
  lecturer_name: z.string(),
  scheduled_start: time,
  scheduled_end: time,
  time_zone: z.string(),
  status: z.enum(deliveryStatuses),
  version: z.number().int().nonnegative(),
  scheduled_minutes: z.number(),
  actual_minutes: z.number(),
  draft: z.union([deliveryDraftSchema, z.strictObject({})]).nullable(),
  submission: submission.nullable(),
  invoice_id: z.uuid().nullable(),
  can_edit: z.boolean(),
  can_review: z.boolean(),
  can_customer_confirm: z.boolean(),
  customer_confirmed: z.boolean(),
});
export const deliveryPageSchema = z.object({
  items: z.array(deliverySessionSchema),
  has_more: z.boolean(),
});
export const deliveryHistorySchema = z.object({
  submissions: z.array(
    submission.extend({ scheduled_start: time, scheduled_end: time }),
  ),
  events: z.array(
    z.object({
      id: z.uuid(),
      submission_id: z.uuid().nullable(),
      action: z.enum([
        "submitted",
        "confirmed",
        "disputed",
        "correction_requested",
        "customer_confirmed",
      ]),
      created_at: time,
      note: z.string().nullable(),
    }),
  ),
});

export type DeliverySession = z.infer<typeof deliverySessionSchema>;
export type DeliveryDraft = z.infer<typeof deliveryDraftSchema>;
export type DeliveryScope = (typeof deliveryScopes)[number];
export type DeliveryReviewAction = (typeof deliveryReviewActions)[number];
