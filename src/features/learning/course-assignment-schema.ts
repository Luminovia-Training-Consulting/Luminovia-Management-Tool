/** Runtime contracts for the course-assignment projection and author input. */
import { z } from "zod";

const label = z.string().trim().min(1).max(160);
const points = z.number().int().min(0).max(1000);
const rubric = z
  .array(
    z.object({
      label,
      levels: z.array(z.object({ label, points })).min(2).max(8),
    }),
  )
  .min(1)
  .max(20);
const instant = z.iso.datetime({ offset: true });
const version = z.number().int().positive();

export const assignmentDefinition = z.object({
  title: label,
  instructions: z.string().trim().min(1).max(8000),
  due_at: instant,
  max_attempts: z.number().int().min(1).max(10),
  rubric,
});

const attempt = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  display_name: z.string(),
  attempt_no: version,
  file_version_id: z.uuid().nullable(),
  file_name: z.string(),
  submitted_at: instant,
  rubric,
  review: z
    .object({
      version,
      state: z.enum(["draft", "revision_requested", "released"]),
      scores: z.array(points),
      feedback: z.string(),
      private_note: z.string().nullable(),
    })
    .nullable(),
});

export const courseAssignmentsProjection = z.object({
  can_manage: z.boolean(),
  assignments: z.array(
    z.object({
      id: z.uuid(),
      title: label,
      due_at: instant,
      published_version: version.nullable(),
    }),
  ),
  detail: assignmentDefinition
    .extend({
      assignment_id: z.uuid(),
      version,
      published_version: version.nullable(),
      can_submit: z.boolean(),
      effective_due_at: instant,
      extensions: z.array(
        z.object({ user_id: z.uuid(), version, due_at: instant }),
      ),
      attempts: z.array(attempt),
    })
    .nullable(),
});

export type AssignmentDefinition = z.infer<typeof assignmentDefinition>;
export type CourseAssignmentsProjection = z.infer<
  typeof courseAssignmentsProjection
>;
export type CourseAssignment = NonNullable<
  CourseAssignmentsProjection["detail"]
>;
export type CourseAssignmentAttempt = z.infer<typeof attempt>;

/** The server duplicates these shape/range checks and is the authority on scores. */
export function rubricIsOrdered(value: AssignmentDefinition["rubric"]) {
  const unique = (values: string[]) =>
    new Set(values.map((entry) => entry.trim().toLowerCase())).size ===
    values.length;
  return (
    unique(value.map(({ label }) => label)) &&
    value.every(
      ({ levels }) =>
        levels[0].points === 0 &&
        unique(levels.map(({ label }) => label)) &&
        levels.every(
          ({ points }, index) =>
            index === 0 || points > levels[index - 1].points,
        ),
    )
  );
}
