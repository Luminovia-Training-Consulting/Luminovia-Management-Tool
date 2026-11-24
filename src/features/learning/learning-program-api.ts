import { queryOptions } from "@tanstack/react-query";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  enrolLearningProgramRequest,
  learningProgramId,
  learningProgramsResult,
  readLearningProgramsRequest,
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

export async function saveLearningProgram(input: SaveLearningProgramRequest) {
  requireOnline();
  const { data, error } = await db().rpc(
    "save_learning_program",
    saveLearningProgramRequest.parse(input),
  );
  if (error) throw error;
  return learningProgramId.parse(data);
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
