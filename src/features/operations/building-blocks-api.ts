/**
 * Source bindings from course templates through actual course runs to derived offers. Source
 * revisions let the server reject stale offer drafts instead of silently replacing sessions.
 */
import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import {
  courseRunJobDefaultsSchema,
  jobBuildingBlockReferenceSchema,
} from "./course-building-block-schema";
export type {
  CourseRunJobDefaults,
  JobBuildingBlockSource,
} from "./course-building-block-schema";

/** Read the course_run_job_defaults server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const courseRunJobDefaultsQuery = (actor: string, runId: string) =>
  queryOptions({
    queryKey: ["operations", "run-job-defaults", actor, runId],
    queryFn: async () => {
      const { data, error } = await db().rpc("course_run_job_defaults", {
        p_course_run_id: runId,
      });
      if (error) throw error;
      return courseRunJobDefaultsSchema.parse(data);
    },
  });

/** Read the job_building_block_reference server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const jobBuildingBlockQuery = (actor: string, jobId: string) =>
  queryOptions({
    queryKey: ["operations", "job-building-block", actor, jobId],
    queryFn: async () => {
      const { data, error } = await db().rpc("job_building_block_reference", {
        p_job_id: jobId,
      });
      if (error) throw error;
      return jobBuildingBlockReferenceSchema.parse(data);
    },
  });
