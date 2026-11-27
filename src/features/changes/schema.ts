/** Shared runtime and OpenAPI shapes for permission-scoped assignment amendments. */
import { currencyCodes } from "../../lib/currencies.ts";
import { z } from "zod";

const uuid = z.string().uuid(),
  instant = z.string().datetime({ offset: true });
// The same shape compares current assignment data with an immutable proposal;
// redacted prices remain null rather than being guessed or coerced to zero.
const snapshotSchema = z.object({
  claim_id: uuid,
  job_id: uuid,
  course_run_id: uuid.nullable(),
  lecturer_id: uuid,
  title: z.string(),
  time_zone: z.string(),
  delivery_type: z.enum(["online", "onsite"]),
  location: z.string(),
  location_hidden: z.boolean().optional(),
  scope: z.string(),
  amount: z.number().nullable(),
  total_amount: z.number().nullable(),
  currency: z.enum(currencyCodes).nullable(),
  rate_unit: z
    .enum(["per_day", "per_hour", "per_teaching_unit", "fixed_total"])
    .nullable(),
  terms: z.string().nullable(),
  cancel: z.boolean(),
  sessions: z.array(z.object({ starts_at: instant, ends_at: instant })),
});
const sharedScheduleSchema = z.object({
  required: z.number().int().min(1).max(20),
  accepted: z.number().int().min(0).max(20),
  state: z.enum(["awaiting_consent", "ready", "blocked", "applied"]),
});
export const assignmentChangeSchema = z.object({
  id: uuid,
  claim_id: uuid,
  requester_id: uuid,
  lecturer_id: uuid,
  reason: z.string(),
  status: z.enum([
    "draft",
    "submitted",
    "awaiting_response",
    "accepted",
    "rejected",
    "withdrawn",
    "applied",
  ]),
  version: z.number().int().positive(),
  original: snapshotSchema,
  proposed: snapshotSchema,
  can_price: z.boolean(),
  customer_view: z.boolean().optional(),
  requested_by_customer: z.boolean().optional(),
  commissioned: z.boolean().optional(),
  schedule_editable: z.boolean().optional(),
  shared_schedule_only: z.boolean().optional(),
  shared_commercial_editable: z.boolean().optional(),
  shared_schedule: sharedScheduleSchema.nullable().optional(),
  can_edit: z.boolean(),
  can_submit: z.boolean(),
  awaiting_coordination: z.boolean().optional(),
  can_coordinate: z.boolean().optional(),
  can_respond: z.boolean(),
  awaits_location_disclosure: z.boolean().optional(),
  can_apply: z.boolean(),
  can_withdraw: z.boolean(),
  manager_approved: z.boolean(),
  lecturer_approved: z.boolean(),
  created_at: instant,
  updated_at: instant,
  applied_at: instant.nullable(),
  events: z.array(
    z.object({
      action: z.string(),
      actor_name: z.string(),
      note: z.string(),
      created_at: instant,
    }),
  ),
});
export const candidateSchema = z.object({
  claim_id: uuid,
  title: z.string(),
  lecturer_name: z.string(),
  time_zone: z.string(),
  can_price: z.boolean(),
  customer_view: z.boolean().optional(),
  commissioned: z.boolean(),
  schedule_editable: z.boolean().optional(),
  shared_schedule_only: z.boolean().optional(),
  shared_commercial_editable: z.boolean().optional(),
  current: snapshotSchema,
});
export type AssignmentChange = z.infer<typeof assignmentChangeSchema>;
export type ChangeCandidate = z.infer<typeof candidateSchema>;
export type AssignmentSnapshot = z.infer<typeof snapshotSchema>;

export const assignmentChangeActions = [
  "submit",
  "coordinate",
  "accept",
  "reject",
  "withdraw",
  "apply",
] as const;
export type AssignmentChangeAction = (typeof assignmentChangeActions)[number];
