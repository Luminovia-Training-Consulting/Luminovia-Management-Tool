/** Shared browser and API schema for immutable framework definitions and released assessment evidence. */
import { z } from "zod";

const id = z.uuid();
const revision = z.number().int().positive();
const level = z.strictObject({ id, title: z.string().trim().min(1).max(100) });
export const competencyDefinition = z.strictObject({
  id,
  code: z.string().trim().min(1).max(30),
  title: z.string().trim().min(1).max(140),
});
export const competencyFrameworkDefinition = z.strictObject({
  title: z.string().trim().min(1).max(150),
  levels: z.array(level).min(2).max(8),
  competencies: z.array(competencyDefinition).min(1).max(30),
});
const framework = z.strictObject({
  id,
  revision,
  content: competencyFrameworkDefinition,
  archived: z.boolean().optional(),
});
export const competencyAssignmentEvidenceReference = z.strictObject({
  assignment_id: id,
  attempt_id: id,
  review_version: revision,
});
const assignmentEvidence = competencyAssignmentEvidenceReference.extend({
  title: z.string().min(1).max(160),
  score: z.number().min(0).max(100),
});
export const competencyTextExamEvidenceReference = z.strictObject({
  exam_revision: revision,
  review_revision: revision,
});
const textExamEvidence = competencyTextExamEvidenceReference.extend({
  title: z.string().min(1).max(160),
  score: z.number().int().nonnegative(),
  max_points: z.number().int().positive(),
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
  assignment_evidence: assignmentEvidence.nullable().default(null),
  text_exam_evidence: textExamEvidence.nullable().optional(),
});
export const courseCompetenciesSchema = z.strictObject({
  can_manage: z.boolean(),
  can_assess: z.boolean(),
  pin_revision: z.number().int().nonnegative(),
  pinned_framework: framework.nullable(),
  frameworks: z.array(framework).max(20),
  decisions: z.array(decision).max(50),
  assignment_options: z.array(assignmentEvidence).max(100).default([]),
  text_exam_option: textExamEvidence.nullable().optional(),
  current_revisions: z.record(id, revision),
  has_more: z.boolean(),
});

export type CompetencyDefinition = z.infer<
  typeof competencyFrameworkDefinition
>;
export type CompetencyFramework = z.infer<typeof framework>;
export type CourseCompetencyState = z.infer<typeof courseCompetenciesSchema>;

export const competencyPageSize = 50;
