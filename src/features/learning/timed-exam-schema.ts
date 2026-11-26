import { z } from "zod";

export const examScore = z.number().int().min(0).max(100);
export const examExtraMinutes = z.number().int().min(0).max(480);
export const examInstant = z.iso.datetime({ offset: true });
export const timedExamSchema = z.object({
  title: z.string(),
  visible_from: examInstant,
  starts_at: examInstant,
  ends_at: examInstant,
  pass_percent: examScore,
  version: z.number().int(),
  required: z.boolean(),
  published: z.boolean(),
  open: z.boolean(),
  grading_open: z.boolean(),
  can_submit: z.boolean(),
  can_grade: z.boolean(),
  can_set_extra_time: z.boolean().optional(),
  learner_ends_at: examInstant.nullable().optional(),
  submitted_at: examInstant.nullable(),
  draft: z.object({ version_id: z.uuid(), name: z.string() }).nullable(),
  rows: z.array(
    z.object({
      participant_id: z.uuid(),
      name: z.string(),
      submitted_at: examInstant.nullable(),
      version_id: z.uuid().nullable(),
      file_name: z.string().nullable(),
      score: examScore.nullable(),
      time_allowance: z
        .object({
          extra_minutes: examExtraMinutes,
          revision: z.number().int().nonnegative(),
        })
        .nullable()
        .optional(),
    }),
  ),
});

export const examResultsSchema = z.object({
  average: z.number().nullable(),
  results: z.array(
    z.object({
      run_id: z.uuid(),
      course: z.string(),
      title: z.string(),
      score: examScore,
      passed: z.boolean(),
      published_at: examInstant,
    }),
  ),
});

export type TimedExam = z.infer<typeof timedExamSchema>;
