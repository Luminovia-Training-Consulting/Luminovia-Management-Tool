/** Versioned weighted course grading and role-scoped projection contracts. */
import { z } from "zod";

const version = z.number().int().nonnegative();
const positiveVersion = version.min(1);
const percent = z.number().min(0).max(100);
const weight = percent.int().min(1);
const uuid = z.uuid();
const itemKey = z.union([z.enum(["quiz", "exam", "text_exam"]), uuid]);
const mode = z.enum(["required", "optional", "bonus"]);
const missing = z.enum(["block", "zero"]);
const date = z.iso.datetime({ offset: true });

const policyItem = z.strictObject({ key: itemKey, weight, treatment: mode });
export type WeightedPolicyItem = z.infer<typeof policyItem>;
export const weightedPolicyDraft = z
  .strictObject({
    threshold: percent.int(),
    missing_required: missing,
    separate_reviewer: z.boolean(),
    items: z.array(policyItem).min(1).max(30),
  })
  .refine(
    ({ items }) => new Set(items.map(({ key }) => key)).size === items.length,
  )
  .refine(
    ({ items }) =>
      items
        .filter(({ treatment }) => treatment !== "bonus")
        .reduce((sum, item) => sum + item.weight, 0) === 100 &&
      items
        .filter(({ treatment }) => treatment === "bonus")
        .reduce((sum, item) => sum + item.weight, 0) <= 100,
  );

const savedItem = policyItem.extend({ label: z.string().nullable() });
const policy = z.strictObject({
  threshold: percent.int(),
  missing_required: missing,
  separate_reviewer: z.boolean(),
  items: z.array(savedItem),
  version: positiveVersion,
  created_at: date,
});
export type WeightedPolicy = z.infer<typeof policy>;
const calculated = z.strictObject({
  policy_version: positiveVersion,
  threshold: percent,
  missing_required: missing,
  percent: percent.nullable(),
  passed: z.boolean().nullable(),
  components: z.array(
    savedItem.extend({
      status: z.enum(["graded", "excused", "unscored", "missing", "zero"]),
      score: percent.nullable(),
    }),
  ),
});
export type WeightedResult = z.infer<typeof calculated>;
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const reviewed = z.strictObject({
  revision: positiveVersion,
  policy_version: positiveVersion,
  prior_release: version,
  fingerprint: hash,
  own_review: z.boolean(),
  reason: z.string(),
  reviewed_at: date,
});
const release = z.strictObject({
  revision: positiveVersion,
  released_at: date,
  result: calculated,
  reason: z.string().nullable(),
});
export type WeightedRelease = z.infer<typeof release>;
const source = z.strictObject({ key: itemKey, label: z.string().nullable() });
export type WeightedSource = z.infer<typeof source>;
export const weightedGradebookResult = z.strictObject({
  can_manage: z.boolean(),
  policy: policy.nullable(),
  sources: z.array(source),
  preview: calculated.nullable(),
  fingerprint: hash.nullable(),
  review: reviewed.nullable(),
  exemptions: z.record(
    z.string(),
    z.strictObject({
      revision: positiveVersion,
      excused: z.boolean(),
      reason: z.string(),
    }),
  ),
  latest_release: version,
  history: z.array(release),
  next_before: positiveVersion.nullable(),
});
export type WeightedGradebook = z.infer<typeof weightedGradebookResult>;

export const weightedGradebookRequest = z.strictObject({
  p_run_id: uuid,
  p_user_id: uuid.nullable().optional(),
  p_before_revision: positiveVersion.nullable().optional(),
});
const write = { p_run_id: uuid, p_expected_policy: version };
const target = {
  user_id: uuid,
  expected_review: version,
  expected_release: version,
};
export const weightedGradeCommand = z.discriminatedUnion("p_action", [
  z.strictObject({
    ...write,
    p_action: z.literal("policy"),
    p_payload: weightedPolicyDraft,
  }),
  z.strictObject({
    ...write,
    p_action: z.literal("exempt"),
    p_payload: z.strictObject({
      user_id: uuid,
      key: itemKey,
      excused: z.boolean(),
      reason: z.string().trim().min(3).max(500),
      expected_exemption: version,
    }),
  }),
  z.strictObject({
    ...write,
    p_action: z.literal("review"),
    p_payload: z.strictObject({
      ...target,
      fingerprint: hash,
      reason: z.string().trim().max(500),
    }),
  }),
  z.strictObject({
    ...write,
    p_action: z.literal("release"),
    p_payload: z.strictObject(target),
  }),
]);
export type WeightedGradeCommand = z.infer<typeof weightedGradeCommand>;
