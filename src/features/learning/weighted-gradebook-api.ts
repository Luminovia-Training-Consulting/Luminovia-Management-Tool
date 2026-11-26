/** Native course result queries and compare-and-swap mutations. */
import { queryOptions } from "@tanstack/react-query";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  weightedGradebookResult,
  weightedGradeCommand,
  type WeightedGradeCommand,
} from "./weighted-gradebook-schema";

export const weightedGradebookKey = (actor: string, run: string) =>
  ["weighted-course-gradebook", actor, run] as const;

/** Keep named learner and release history data scoped to authenticated queries. */
export const weightedGradebookQuery = (
  actor: string,
  run: string,
  learner: string | null,
  before: number | null = null,
) =>
  queryOptions({
    queryKey: [...weightedGradebookKey(actor, run), learner, before],
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("course_weighted_gradebook", {
          p_run_id: run,
          p_user_id: learner,
          p_before_revision: before,
        })
        .abortSignal(signal);
      if (error) throw error;
      return weightedGradebookResult.parse(data);
    },
    retry: false,
    gcTime: 0,
  });

/** The server validates the currently reviewed policy, exemption or preview. */
export async function saveWeightedGrade(command: WeightedGradeCommand) {
  requireOnline();
  const { error } = await db().rpc(
    "course_weighted_gradebook_command",
    weightedGradeCommand.parse(command),
  );
  if (error) throw error;
}
