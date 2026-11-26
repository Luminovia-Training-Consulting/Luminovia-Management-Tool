/** Learn report contracts shared by scoped React charts and generated OpenAPI. */
import { z } from "zod";

export const learningCourseStatus = z.enum([
  "draft",
  "upcoming",
  "running",
  "finished",
  "archived",
]);
export const learningReportStatus = z.enum([
  "all",
  ...learningCourseStatus.options,
]);
export type LearningReportStatus = z.infer<typeof learningReportStatus>;

const count = z.number().int().nonnegative();
const courseMetrics = {
  enrolments: count,
  completions: count,
  certificates: count,
  sessions: count,
  minutes: z.number().nonnegative(),
  present: count,
  absent: count,
  excused: count,
};

export const learningAnalyticsAccessSchema = z.strictObject({
  personal: z.boolean(),
  staff: z.boolean(),
  time_zone: z.string().nullable(),
  organisations: z.array(
    z.strictObject({ id: z.uuid(), name: z.string(), company: z.boolean() }),
  ),
});
export type LearningAnalyticsAccess = z.infer<
  typeof learningAnalyticsAccessSchema
>;

const percentage = z.number().min(0).max(100).nullable();
const assessmentMeasures = {
  quiz_learners: count.nullable(),
  quiz_attempts: count.nullable(),
  quiz_passes: count.nullable(),
  quiz_best_average: percentage,
  published_grades: count.nullable(),
  published_grade_average: percentage,
  submission_learners: count.nullable(),
  submission_attempts: count.nullable(),
  released_reviews: count.nullable(),
  competency_learners: count.nullable(),
  competency_decisions: count.nullable(),
};

export const learningAssessmentFields = [
  "quiz_learners",
  "quiz_attempts",
  "quiz_passes",
  "quiz_best_average",
  "published_grades",
  "published_grade_average",
  "submission_learners",
  "submission_attempts",
  "released_reviews",
  "competency_learners",
  "competency_decisions",
] as const satisfies readonly (keyof typeof assessmentMeasures)[];

const learningAssessmentSchema = z.strictObject({
  metric_version: z.literal(1),
  minimum_learner_count: z.literal(3),
  courses: z
    .array(z.strictObject({ course_id: z.uuid(), ...assessmentMeasures }))
    .max(25),
});

export const learningAnalyticsReportSchema = z.strictObject({
  time_zone: z.string(),
  assessment: learningAssessmentSchema.optional(),
  totals: z.strictObject({
    courses: count,
    upcoming: count,
    participants: count,
    ...courseMetrics,
  }),
  months: z
    .array(
      z.strictObject({
        month: z.iso.date(),
        finished: count,
        upcoming: count,
        enrolments: count,
        completions: count,
      }),
    )
    .min(1)
    .max(26),
  courses: z
    .array(
      z.strictObject({
        id: z.uuid(),
        title: z.string(),
        organisation: z.string(),
        class_name: z.string().nullable(),
        status: learningCourseStatus,
        starts_at: z.iso.datetime({ offset: true }).nullable(),
        ends_at: z.iso.datetime({ offset: true }).nullable(),
        cohort_date: z.iso.date(),
        ...courseMetrics,
      }),
    )
    .max(25),
});
export type LearningAnalyticsReport = z.infer<
  typeof learningAnalyticsReportSchema
>;
