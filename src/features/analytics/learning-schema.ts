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

export const learningAnalyticsReportSchema = z.strictObject({
  time_zone: z.string(),
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
