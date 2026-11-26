/** Private answer and review projections shared by the signed-in UI and API catalogue. */
import { z } from "zod";

const revision = z.number().int().positive();
const expected = z.number().int().min(0).max(999_999_999);
const timestamp = z.iso.datetime({ offset: true });
const question = z.strictObject({
  prompt: z.string().trim().min(1).max(2000),
  max_points: z.number().int().min(1).max(999),
});
const answers = z.array(z.string().max(4000)).min(1).max(20);
export const textExamDraft = z.strictObject({
  title: z.string().trim().min(1).max(160),
  opens_at: timestamp,
  closes_at: timestamp,
  pass_percent: z.number().int().min(1).max(100),
  second_reviewer_required: z.boolean().optional(),
  questions: z.array(question).min(1).max(20),
});
const exam = textExamDraft.extend({
  revision,
  deadline: timestamp,
  published_at: timestamp.nullable(),
  questions: textExamDraft.shape.questions.nullable(),
});
const reviewPoints = z.array(z.number().int().min(0).max(999)).min(1).max(20);
const candidate = z.strictObject({
  learner_id: z.uuid(),
  name: z.string().nullable(),
  submitted_at: timestamp,
  review_state: z.enum(["ungraded", "draft", "released"]),
  import_draft: z
    .strictObject({
      revision: expected,
      points: reviewPoints.nullable(),
    })
    .nullish(),
});
const extraMinutes = z.number().int().min(0).max(480);
const allowance = z.strictObject({
  learner_id: z.uuid(),
  name: z.string().nullable(),
  revision: expected,
  extra_minutes: extraMinutes,
});
const review = z.strictObject({
  revision,
  points: reviewPoints,
  feedback: z.string().max(4000),
  released_at: timestamp.nullable(),
  score: z.number().int().nonnegative(),
  max_points: z.number().int().positive(),
  passed: z.boolean(),
  can_release: z.boolean().optional(),
});
export const textExamState = z.strictObject({
  now: timestamp,
  staff: z.boolean(),
  can_write: z.boolean(),
  can_author: z.boolean(),
  head_revision: expected.nullable(),
  versions: z.array(
    exam.pick({ revision: true, title: true, published_at: true }),
  ),
  exam: exam.nullable(),
  submissions: z.array(candidate).max(25),
  time_allowances: z
    .strictObject({ rows: z.array(allowance).max(25), has_more: z.boolean() })
    .nullish(),
  has_more: z.boolean(),
  attempt: z
    .strictObject({ revision, answers, submitted_at: timestamp.nullable() })
    .nullable(),
  review: review.nullable(),
});
export const textExamRead = z.strictObject({
  p_run_id: z.uuid(),
  p_revision: revision.nullish(),
  p_learner_id: z.uuid().nullish(),
  p_offset: z.number().int().min(0).max(1_000_000).optional(),
});

export const textExamExportRequest = z.strictObject({
  p_run_id: z.uuid(),
  p_revision: revision,
  p_after: z.uuid().nullish(),
  p_as_of: timestamp.nullish(),
});
export const textExamExportPage = z.strictObject({
  as_of: timestamp,
  next: z.uuid().nullable(),
  rows: z
    .array(
      z.strictObject({
        learner_id: z.uuid(),
        name: z.string().nullable(),
        submitted_at: timestamp,
        grade_revision: revision,
        score: z.number().int().nonnegative(),
        max_points: z.number().int().positive(),
        passed: z.boolean(),
        released_at: timestamp,
      }),
    )
    .max(100),
});

const command = { p_run_id: z.uuid(), p_expected: expected };
const target = z.strictObject({ learner_id: z.uuid() });
const empty = z.strictObject({});
export const textExamImportRow = target.extend({
  expected_revision: expected,
  points: reviewPoints,
});
export type TextExamImportRow = z.infer<typeof textExamImportRow>;
export const textExamCommand = z.discriminatedUnion("p_action", [
  z.strictObject({
    ...command,
    p_revision: z.null(),
    p_action: z.literal("save_exam"),
    p_payload: textExamDraft,
  }),
  z.strictObject({
    ...command,
    p_revision: z.null(),
    p_action: z.literal("publish"),
    p_payload: empty,
  }),
  z.strictObject({
    ...command,
    p_revision: revision,
    p_action: z.literal("set_extra_time"),
    p_payload: target.extend({ extra_minutes: extraMinutes }),
  }),
  z.strictObject({
    ...command,
    p_revision: revision,
    p_action: z.literal("save_answers"),
    p_payload: z.strictObject({ answers }),
  }),
  z.strictObject({
    ...command,
    p_revision: revision,
    p_action: z.literal("submit"),
    p_payload: z.strictObject({ answers }),
  }),
  z.strictObject({
    ...command,
    p_revision: revision,
    p_action: z.literal("save_review"),
    p_payload: target.extend({
      points: review.shape.points,
      feedback: review.shape.feedback,
    }),
  }),
  z.strictObject({
    ...command,
    p_expected: z.literal(0),
    p_revision: revision,
    p_action: z.literal("import_reviews"),
    p_payload: z.strictObject({
      rows: z.array(textExamImportRow).min(1).max(25),
    }),
  }),
  z.strictObject({
    ...command,
    p_revision: revision,
    p_action: z.literal("release"),
    p_payload: target,
  }),
]);
export type TextExamState = z.infer<typeof textExamState>;
export type TextExamCommand = z.infer<typeof textExamCommand>;
