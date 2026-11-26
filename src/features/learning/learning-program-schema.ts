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

export const programmePathExceptionRevision = z.number().int().positive();
const programmePathException = z.strictObject({
  active: z.boolean(),
  revision: programmePathExceptionRevision,
});
export const programmePathExceptionRequest = z.strictObject({
  p_program_id: learningProgramId,
  p_participant_id: learningProgramId,
  p_position: programmePosition.min(2),
  p_active: z.boolean(),
  p_reason: z.string().trim().min(3).max(500),
  p_expected_revision: z.number().int().min(0).max(1_000_000_000),
});
export type ProgrammePathExceptionRequest = z.infer<
  typeof programmePathExceptionRequest
>;

const programmeCurriculumStep = z.strictObject({
  objectives: z.string().max(1200),
  remediation: z.string().max(1200),
  required: z.boolean(),
});

const programmeCurriculumShape = z.strictObject({
  overview: z.string().max(4000),
  elective_count: z.number().int().min(0).max(29),
  steps: z.record(learningProgramId, programmeCurriculumStep),
});

export const programmeCurriculum = programmeCurriculumShape.refine(
  ({ steps, elective_count }) => {
    const list = Object.values(steps);
    return (
      list.length >= 2 &&
      list.length <= 30 &&
      list.some(({ required }) => required) &&
      elective_count <= list.filter(({ required }) => !required).length
    );
  },
  { message: "Invalid programme completion requirements" },
);
export type ProgrammeCurriculum = z.infer<typeof programmeCurriculum>;

export const configureProgrammeCurriculumRequest = z.strictObject({
  p_program_id: learningProgramId,
  p_curriculum: programmeCurriculum.nullable(),
  p_expected_version: z.number().int().positive(),
});
export type ConfigureProgrammeCurriculumRequest = z.infer<
  typeof configureProgrammeCurriculumRequest
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
      completion_credited: z.boolean().optional(),
      state: z.enum(learningProgramStates),
      can_open: z.boolean(),
      prerequisite_exception: programmePathException.nullish(),
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
  can_read_grades: z.boolean().optional(),
  can_manage_path_exceptions: z.boolean().optional(),
  can_write: z.boolean(),
  can_edit: z.boolean(),
  steps: z.array(programCourse).nullable(),
  path_rules: z.record(z.string(), prerequisiteRule).nullable().optional(),
  curriculum: programmeCurriculumShape
    .extend({ revision: z.number().int().positive() })
    .nullish(),
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

/** A report projects the currently visible release for each course, with no review evidence. */
export const learningProgramGradeReport = z.strictObject({
  grade_count: z.number().int().min(0).max(30),
  mean_percent: z.number().min(0).max(100).nullable(),
  grades: z
    .array(
      z.strictObject({
        position: programmePosition,
        course_id: learningProgramId,
        title: z.string(),
        revision: z.number().int().positive(),
        policy_version: z.number().int().positive(),
        released_at: dateTime,
        percent: z.number().min(0).max(100),
        passed: z.boolean(),
      }),
    )
    .max(30),
});
export const readLearningProgramGradeReportRequest = z.strictObject({
  p_program_id: learningProgramId,
  p_user_id: learningProgramId.nullable().optional(),
});

export const programmeCohortPageSize = 30;
export const learningProgramCohortGrades = z.strictObject({
  more: z.boolean(),
  rows: z
    .array(
      z.strictObject({
        participant_id: learningProgramId,
        name: z.string(),
        report: learningProgramGradeReport,
      }),
    )
    .max(programmeCohortPageSize),
});
export const readLearningProgramCohortGradesRequest = z.strictObject({
  p_program_id: learningProgramId,
  p_search: z.string().max(120).optional(),
  p_offset: z.number().int().min(0).max(2_147_483_647).optional(),
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
