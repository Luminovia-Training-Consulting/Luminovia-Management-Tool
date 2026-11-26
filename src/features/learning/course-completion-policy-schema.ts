/** Versioned completion policy projection and evaluator evidence, shared with OpenAPI. */
import { z } from "zod";

const uuid = z.uuid();
const version = z.number().int().positive();
const instant = z.iso.datetime({ offset: true }).nullable();
const attendancePercent = z.number().int().min(1).max(100);
const choice = z.strictObject({ id: uuid, title: z.string() });
const completionDecision = z.strictObject({
  accepted: z.boolean(),
  revision: z.number().int().nonnegative(),
});
const completionReview = z.strictObject({
  user_id: uuid,
  policy_version: version,
  accepted: z.boolean(),
  reason: z.string().trim().min(3).max(500),
});
const exceptionRequirement = z.enum(["assignment", "competency"]);
const policyPayload = z.strictObject({
  attendance_percent: attendancePercent,
  assignment_id: uuid.nullable(),
  competency_pin: version.nullable(),
  competency_id: uuid.nullable(),
  minimum_level_id: uuid.nullable(),
  lecturer_verification: z.boolean(),
  target_at: instant,
});

export const courseCompletionPolicyProjection = z.strictObject({
  can_manage: z.boolean(),
  head: policyPayload
    .extend({ version, created_at: z.iso.datetime({ offset: true }) })
    .nullable(),
  assignments: z.array(choice),
  framework: z
    .strictObject({
      title: z.string(),
      pin_version: version,
      competencies: z.array(choice.extend({ code: z.string() })).max(30),
      levels: z.array(choice).max(8),
    })
    .nullable(),
});

export const courseCompletionPinnedPolicy = z.strictObject({
  version,
  attendance_percent: attendancePercent,
  assignment: z
    .strictObject({
      title: z.string(),
      met: z.boolean(),
      exception: completionDecision,
    })
    .nullable(),
  competency: z
    .strictObject({
      title: z.string(),
      minimum_level: z.string(),
      met: z.boolean(),
      exception: completionDecision,
      review_available: z.boolean(),
    })
    .nullable(),
  verification: completionDecision.nullable(),
  target_at: instant,
});

export const courseCompletionPolicyActionSchema = z.discriminatedUnion(
  "p_action",
  [
    z.strictObject({
      p_run_id: uuid,
      p_action: z.literal("publish"),
      p_expected_version: z.number().int().nonnegative(),
      p_payload: policyPayload,
    }),
    z.strictObject({
      p_run_id: uuid,
      p_action: z.literal("pin"),
      p_expected_version: z.number().int().nonnegative(),
      p_payload: z.strictObject({ user_id: uuid, policy_version: version }),
    }),
    z.strictObject({
      p_run_id: uuid,
      p_action: z.literal("verify"),
      p_expected_version: z.number().int().nonnegative(),
      p_payload: completionReview,
    }),
    z.strictObject({
      p_run_id: uuid,
      p_action: z.literal("exception"),
      p_expected_version: z.number().int().nonnegative(),
      p_payload: completionReview.extend({ requirement: exceptionRequirement }),
    }),
  ],
);

export type CompletionPolicyPayload = z.infer<typeof policyPayload>;
export type CompletionPolicyProjection = z.infer<
  typeof courseCompletionPolicyProjection
>;
export type CompletionPinnedPolicy = z.infer<
  typeof courseCompletionPinnedPolicy
>;
export type CompletionPolicyAction = z.infer<
  typeof courseCompletionPolicyActionSchema
>;
export type CompletionReviewDecision = z.infer<typeof completionDecision>;
export type CompletionExceptionRequirement = z.infer<
  typeof exceptionRequirement
>;
