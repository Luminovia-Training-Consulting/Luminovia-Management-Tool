import { z } from "zod";

export const evaluationRater = z.enum(["learner", "company", "lecturer"]);
export const evaluationKind = z.enum([
  "lecturer",
  "company",
  "course",
  "class",
]);
export const evaluationScore = z.number().int().min(1).max(5);
export const evaluationTarget = z.object({
  rater_role: evaluationRater,
  subject_kind: evaluationKind,
  subject_id: z.uuid(),
  label: z.string(),
});
export const ownEvaluation = evaluationTarget.extend({
  score: evaluationScore,
  comment: z.string().max(2000),
  version: z.number().int().positive(),
});
export const evaluationSummary = evaluationTarget.extend({
  count: z.number().int().positive(),
  average: z.number().min(1).max(5),
  can_read_comments: z.boolean(),
});
export const courseEvaluations = z.object({
  completed: z.boolean(),
  writable: z.boolean(),
  targets: z.array(evaluationTarget),
  mine: z.array(ownEvaluation),
  summaries: z.array(evaluationSummary),
});
export const courseEvaluationComments = z.object({
  items: z
    .array(z.object({ id: z.uuid(), comment: z.string().max(2000) }))
    .max(25),
  next: z.uuid().nullable(),
});

export type EvaluationTarget = z.infer<typeof evaluationTarget>;
export type OwnEvaluation = z.infer<typeof ownEvaluation>;
