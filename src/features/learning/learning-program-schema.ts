import { z } from "zod";

export const learningProgramId = z.uuid();
const dateTime = z.iso.datetime({ offset: true });
const option = z.strictObject({ id: learningProgramId, name: z.string() });
const programCourse = z.strictObject({
  course_id: learningProgramId.nullable(),
  title: z.string(),
});

const prerequisiteMode = z.enum(["all", "any"]);
const programmePosition = z.number().int().min(1).max(30);
const prerequisiteRule = z.strictObject({
  mode: prerequisiteMode,
  positions: z.array(programmePosition).min(1).max(29),
});
export const programmePrerequisiteRequest = z.strictObject({
  p_program_id: learningProgramId,
  p_position: programmePosition.min(2),
  p_mode: prerequisiteMode,
  p_requires: z.array(programmePosition).max(29),
  p_expected_version: z.number().int().positive(),
});
export type ProgrammePrerequisiteRequest = z.infer<
  typeof programmePrerequisiteRequest
>;

export const learningProgramStates = [
  "completed",
  "unavailable",
  "locked",
  "in_progress",
  "ready",
] as const;
export const learningProgramProgress = z.strictObject({
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  completed_at: dateTime.nullable(),
  steps: z.array(
    programCourse.extend({
      receipt_id: learningProgramId.nullable(),
      state: z.enum(learningProgramStates),
      can_open: z.boolean(),
      prerequisites: z
        .strictObject({
          mode: prerequisiteMode,
          items: z.array(
            z.strictObject({
              position: programmePosition,
              title: z.string(),
              completed: z.boolean(),
            }),
          ),
        })
        .optional(),
    }),
  ),
});

const program = z.strictObject({
  id: learningProgramId,
  title: z.string(),
  organisation_name: z.string(),
  archived: z.boolean(),
});

const learnerEntry = option.extend({
  active: z.boolean(),
  progress: learningProgramProgress,
  placement: z
    .strictObject({
      class_id: learningProgramId.nullable(),
      version: z.number().int().positive(),
    })
    .nullable()
    .optional(),
});

const programDetail = program.extend({
  organisation_id: learningProgramId,
  description: z.string(),
  sequential: z.boolean(),
  version: z.number().int().positive(),
  manage: z.boolean(),
  can_write: z.boolean(),
  can_edit: z.boolean(),
  steps: z.array(programCourse).nullable(),
  path_rules: z.record(z.string(), prerequisiteRule).nullable().optional(),
  progress: learningProgramProgress.nullable(),
  learner_name: z.string().nullable(),
  roster: z.array(learnerEntry).nullable(),
  classes: z.array(option).nullable().optional(),
});
export type LearningProgramDetail = z.infer<typeof programDetail>;

export const learningProgramsResult = z.strictObject({
  programs: z.array(program),
  organisations: z.array(option),
  courses: z.array(
    z.strictObject({
      id: learningProgramId,
      title: z.string(),
      starts_at: dateTime.nullable(),
    }),
  ),
  candidates: z.array(option.extend({ reference: z.string() })),
  detail: programDetail.nullable(),
  writable: z.boolean(),
});

export const learningProgramClassProgressResult = z.array(
  z.strictObject({
    class_id: learningProgramId,
    class_name: z.string(),
    participants: z.number().int().positive(),
    participants_completed: z.number().int().nonnegative(),
    module_slots: z.number().int().positive(),
    modules_completed: z.number().int().nonnegative(),
  }),
);
export const readLearningProgramClassProgressRequest = z.strictObject({
  p_program_id: learningProgramId,
});

export const readLearningProgramsRequest = z.strictObject({
  p_program_id: learningProgramId.nullable().optional(),
  p_organisation_id: learningProgramId.nullable().optional(),
  p_search: z.string().max(120).optional(),
});
export type ReadLearningProgramsRequest = z.infer<
  typeof readLearningProgramsRequest
>;

export const saveLearningProgramRequest = z.strictObject({
  p_program_id: learningProgramId,
  p_organisation_id: learningProgramId,
  p_title: z.string().trim().min(1).max(140),
  p_description: z.string().trim().max(4000),
  p_sequential: z.boolean(),
  p_course_ids: z.array(learningProgramId.nullable()).min(2).max(30),
  p_archived: z.boolean(),
  p_expected_version: z.number().int().nonnegative(),
});
export type SaveLearningProgramRequest = z.infer<
  typeof saveLearningProgramRequest
>;

export const enrolLearningProgramRequest = z.strictObject({
  p_program_id: learningProgramId,
  p_user_id: learningProgramId,
  p_expected_version: z.number().int().positive(),
});
export type EnrolLearningProgramRequest = z.infer<
  typeof enrolLearningProgramRequest
>;

export const startLearningProgramCourseRequest = z.strictObject({
  p_program_id: learningProgramId,
  p_course_id: learningProgramId,
});
export type StartLearningProgramCourseRequest = z.infer<
  typeof startLearningProgramCourseRequest
>;

export const learningProgramClassPlacementRequest = z.strictObject({
  p_organisation_id: learningProgramId,
  p_user_id: learningProgramId,
  p_class_id: learningProgramId.nullable(),
  p_expected_version: z.number().int().positive(),
});
export type LearningProgramClassPlacementRequest = z.infer<
  typeof learningProgramClassPlacementRequest
>;
