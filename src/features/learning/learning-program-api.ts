import { queryOptions } from "@tanstack/react-query";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  configureProgrammeCurriculumRequest,
  type ConfigureProgrammeCurriculumRequest,
  enrolLearningProgramRequest,
  learningProgramId,
  learningProgramClassProgressResult,
  learningProgramGradeReport,
  learningProgramCohortGrades,
  readLearningProgramCohortGradesRequest,
  learningProgramClassPlacementRequest,
  type LearningProgramClassPlacementRequest,
  readLearningProgramClassProgressRequest,
  readLearningProgramGradeReportRequest,
  learningProgramsResult,
  readLearningProgramsRequest,
  programmePrerequisiteRequest,
  programmePathExceptionRequest,
  programmePathExceptionRevision,
  type ProgrammePathExceptionRequest,
  type ProgrammePrerequisiteRequest,
  saveLearningProgramRequest,
  startLearningProgramCourseRequest,
  type EnrolLearningProgramRequest,
  type ReadLearningProgramsRequest,
  type SaveLearningProgramRequest,
  type StartLearningProgramCourseRequest,
} from "./learning-program-schema";

export const learningProgramsKey = (actor: string) =>
  ["learning-programs", actor] as const;

export const learningProgramsQuery = (
  actor: string,
  args: ReadLearningProgramsRequest,
) =>
  queryOptions({
    queryKey: [...learningProgramsKey(actor), args],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("learning_programs", readLearningProgramsRequest.parse(args), {
          get: true,
        })
        .abortSignal(signal);
      if (error) throw error;
      return learningProgramsResult.parse(data);
    },
    staleTime: 0,
    retry: false,
  });

export const learningProgramClassProgressQuery = (
  actor: string,
  program: string,
) =>
  queryOptions({
    queryKey: [...learningProgramsKey(actor), "class-progress", program],
    queryFn: async ({ signal }) => {
      const args = readLearningProgramClassProgressRequest.parse({
        p_program_id: program,
      });
      const { data, error } = await db()
        .rpc("learning_program_class_progress", args, { get: true })
        .abortSignal(signal);
      if (error) throw error;
      return learningProgramClassProgressResult.parse(data);
    },
    staleTime: 0,
    refetchOnMount: "always" as const,
    retry: false,
  });

/** Share the programme invalidation scope while separating staff selections and self reports. */
export const learningProgramGradeReportQuery = (
  actor: string,
  program: string,
  learner?: string,
) =>
  queryOptions({
    queryKey: [
      ...learningProgramsKey(actor),
      "grade-report",
      program,
      learner ?? null,
    ],
    queryFn: async ({ signal }) => {
      const args = readLearningProgramGradeReportRequest.parse({
        p_program_id: program,
        p_user_id: learner,
      });
      const { data, error } = await db()
        .rpc("learning_program_grade_report", args, { get: true })
        .abortSignal(signal);
      if (error) throw error;
      return learningProgramGradeReport.parse(data);
    },
    staleTime: 0,
    refetchOnMount: "always" as const,
    retry: false,
  });

/** Fetch only one authorised page of current cohort grades. */
export const learningProgramCohortGradesQuery = (
  actor: string,
  program: string,
  search: string,
  offset: number,
) =>
  queryOptions({
    queryKey: [
      ...learningProgramsKey(actor),
      "cohort-grades",
      program,
      search,
      offset,
    ],
    queryFn: async ({ signal }) => {
      const args = readLearningProgramCohortGradesRequest.parse({
        p_program_id: program,
        p_search: search,
        p_offset: offset,
      });
      const { data, error } = await db()
        .rpc("learning_program_cohort_grades", args, { get: true })
        .abortSignal(signal);
      if (error) throw error;
      return learningProgramCohortGrades.parse(data);
    },
    staleTime: 0,
    refetchOnMount: "always" as const,
    retry: false,
  });

export async function saveLearningProgram(input: SaveLearningProgramRequest) {
  requireOnline();
  const { data, error } = await db().rpc(
    "save_learning_program",
    saveLearningProgramRequest.parse(input),
  );
  if (error) throw error;
  return learningProgramId.parse(data);
}

/** Save immutable programme content against the reviewed programme version. */
export async function configureLearningProgramCurriculum(
  input: ConfigureProgrammeCurriculumRequest,
) {
  requireOnline();
  const { error } = await db().rpc(
    "configure_learning_program_curriculum",
    configureProgrammeCurriculumRequest.parse(input),
  );
  if (error) throw error;
}

/** Save one programme step's explicit gates against the version shown in the editor. */
export async function setLearningProgramPrerequisite(
  input: ProgrammePrerequisiteRequest,
) {
  requireOnline();
  const { error } = await db().rpc(
    "set_learning_program_prerequisite",
    programmePrerequisiteRequest.parse(input),
  );
  if (error) throw error;
}

/** Confirm the next version of one learner's exception against the reviewed state. */
export async function setLearningProgramPathException(
  input: ProgrammePathExceptionRequest,
) {
  requireOnline();
  const { data, error } = await db().rpc(
    "set_learning_program_path_exception",
    programmePathExceptionRequest.parse(input),
  );
  if (error) throw error;
  return programmePathExceptionRevision.parse(data);
}

export async function enrolLearningProgram(input: EnrolLearningProgramRequest) {
  requireOnline();
  const { error } = await db().rpc(
    "enrol_learning_program",
    enrolLearningProgramRequest.parse(input),
  );
  if (error) throw error;
}

export async function startLearningProgramCourse(
  input: StartLearningProgramCourseRequest,
) {
  requireOnline();
  const { error } = await db().rpc(
    "start_learning_program_course",
    startLearningProgramCourseRequest.parse(input),
  );
  if (error) throw error;
}

export async function placeLearningProgramParticipant(
  input: LearningProgramClassPlacementRequest,
) {
  requireOnline();
  const { error } = await db().rpc(
    "set_company_participant_class",
    learningProgramClassPlacementRequest.parse(input),
  );
  if (error) throw error;
}
