/** Shared browser and API schema for immutable framework definitions and released assessment evidence. */
import { z } from "zod";

const id = z.uuid();
const revision = z.number().int().positive();
const level = z.strictObject({ id, title: z.string().trim().min(1).max(100) });
const competency = z.strictObject({
  id,
  code: z.string().trim().min(1).max(30),
  title: z.string().trim().min(1).max(140),
});
export const competencyFrameworkDefinition = z.strictObject({
  title: z.string().trim().min(1).max(150),
  levels: z.array(level).min(2).max(8),
  competencies: z.array(competency).min(1).max(30),
});
const framework = z.strictObject({
  id,
  revision,
  content: competencyFrameworkDefinition,
});
const decision = z.strictObject({
  pin_revision: revision,
  revision,
  competency_id: id,
  level_id: id,
  code: z.string(),
  competency_title: z.string(),
  level_title: z.string(),
  framework_title: z.string(),
  evidence_note: z.string(),
  created_at: z.iso.datetime({ offset: true }),
  quiz_evidence: z
    .strictObject({
      id,
      quiz_version: revision,
      score: z.number().int().min(0).max(100),
    })
    .nullable(),
});
export const courseCompetenciesSchema = z.strictObject({
  can_manage: z.boolean(),
  can_assess: z.boolean(),
  pin_revision: z.number().int().nonnegative(),
  pinned_framework: framework.nullable(),
  frameworks: z.array(framework).max(20),
  decisions: z.array(decision).max(50),
  current_revisions: z.record(id, revision),
  has_more: z.boolean(),
});

export type CompetencyDefinition = z.infer<
  typeof competencyFrameworkDefinition
>;
export type CompetencyFramework = z.infer<typeof framework>;
export type CourseCompetencyState = z.infer<typeof courseCompetenciesSchema>;

export const competencyPageSize = 50;
