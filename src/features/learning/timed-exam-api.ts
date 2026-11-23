import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";

import { timedExamSchema, examResultsSchema } from "./timed-exam-schema";

export const timedExamKey = (actor: string, course: string) =>
  ["timed-exam", actor, course] as const;
export const timedExamQuery = (actor: string, course: string) =>
  queryOptions({
    queryKey: timedExamKey(actor, course),
    gcTime: 0,
    refetchInterval: 5000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await db().rpc("course_exam_state", {
        p_run_id: course,
      });
      if (error) throw error;
      return timedExamSchema.nullable().parse(data);
    },
  });

export const publishedExamResultsQuery = (
  actor: string,
  participant?: string,
  organisation?: string,
) =>
  queryOptions({
    queryKey: ["published-exam-results", actor, participant, organisation],
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const { data, error } = await db().rpc("published_course_exam_results", {
        p_user_id: participant ?? null,
        p_organisation_id: organisation ?? null,
      });
      if (error) throw error;
      return examResultsSchema.parse(data);
    },
  });
