/** Actor-owned portfolio and named-instructor snapshot contracts. */
import { z } from "zod";

const uuid = z.uuid();
const revisionNumber = z.number().int().min(1).max(30);
const date = z.iso.datetime({ offset: true });
export const portfolioEvidence = z.strictObject({
  version_id: uuid,
  name: z.string().min(1).max(200),
});
export type PortfolioEvidence = z.infer<typeof portfolioEvidence>;
const evidenceList = z.array(portfolioEvidence).max(5).default([]);
const reflectionSection = z.string().trim().max(1200).optional();
export const portfolioReflection = z.strictObject({
  goal: reflectionSection,
  outcome: reflectionSection,
  next_step: reflectionSection,
});
export type PortfolioReflection = z.infer<typeof portfolioReflection>;
const revision = z.strictObject({
  revision: revisionNumber,
  title: z.string(),
  body: z.string(),
  reflection: portfolioReflection.optional(),
  created_at: date,
  evidence: evidenceList,
});
export const portfolioEntry = z.strictObject({
  id: uuid,
  archived_at: date.nullable().default(null),
  state_revision: z.number().int().nonnegative().default(0),
  current: revision,
  history: z.array(revision).nullable(),
  shares: z.array(
    z.strictObject({
      id: uuid,
      revision: revisionNumber,
      shared_at: date,
      revoked_at: date.nullable(),
      course: z.string().nullable(),
      teacher: z.string().nullable(),
    }),
  ),
});
export type PortfolioEntry = z.infer<typeof portfolioEntry>;

const shareTarget = z.strictObject({
  course_id: uuid,
  course: z.string(),
  teacher_id: uuid,
  teacher: z.string(),
});
export type PortfolioShareTarget = z.infer<typeof shareTarget>;
export const portfolioOwner = z.strictObject({
  entries: z.array(portfolioEntry),
  targets: z.array(shareTarget),
});
export const portfolioTeacher = z.strictObject({
  shares: z.array(
    z.strictObject({
      id: uuid,
      title: z.string(),
      body: z.string(),
      reflection: portfolioReflection.optional(),
      revision: revisionNumber,
      shared_at: date,
      learner: z.string(),
      evidence: evidenceList,
    }),
  ),
  has_more: z.boolean(),
});
export const portfolioReadRequest = z.strictObject({
  p_course_id: uuid.nullable().optional(),
  p_entry_id: uuid.nullable().optional(),
  p_export: z.boolean().optional(),
  p_offset: z.number().int().nonnegative().optional(),
});

const commandKey = {
  p_entry_id: uuid,
  p_expected_revision: z.number().int().min(0).max(30),
};
const stateRevision = z.number().int().min(0).max(999_999_999);
export const portfolioCommand = z.discriminatedUnion("p_action", [
  z.strictObject({
    ...commandKey,
    p_action: z.literal("save"),
    p_payload: z.strictObject({
      title: z.string().trim().min(1).max(140),
      body: z.string().trim().min(1).max(4000),
      reflection: portfolioReflection.optional(),
    }),
  }),
  z.strictObject({
    ...commandKey,
    p_action: z.enum(["link", "unlink"]),
    p_payload: z.strictObject({ version_id: uuid }),
  }),
  z.strictObject({
    ...commandKey,
    p_action: z.literal("share"),
    p_payload: z.strictObject({ course_id: uuid, teacher_id: uuid }),
  }),
  z.strictObject({
    ...commandKey,
    p_action: z.literal("revoke"),
    p_payload: z.strictObject({ share_id: uuid }),
  }),
  z.strictObject({
    ...commandKey,
    p_action: z.enum(["archive", "restore"]),
    p_payload: z.strictObject({ state_revision: stateRevision }),
  }),
  z.strictObject({
    ...commandKey,
    p_action: z.literal("delete"),
    p_payload: z.strictObject({
      state_revision: stateRevision,
      title: z.string().min(1).max(140),
    }),
  }),
]);
export type PortfolioCommand = z.infer<typeof portfolioCommand>;
