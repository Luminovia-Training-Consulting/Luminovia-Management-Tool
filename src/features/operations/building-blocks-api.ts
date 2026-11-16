/**
 * Source bindings from course templates through actual course runs to derived offers. Source
 * revisions let the server reject stale offer drafts instead of silently replacing sessions.
 */
import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";

/** Reviewed course source for a new job, including its server-comparable revision. */
export interface CourseRunJobDefaults {
  source_revision: string;
  course_run_id: string;
  template_id: string;
  building_block_id: string | null;
  building_block_source_id: string | null;
  title: string;
  description: string;
  syllabus: string;
  prerequisites: string;
  organisation_id: string | null;
  customer_name: string;
  delivery_type: "online" | "onsite";
  location: string;
  time_zone: string;
  topic_ids: string[];
  sessions: {
    source_course_session_id: string;
    starts_at: string;
    ends_at: string;
  }[];
}
/** Read the course_run_job_defaults server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const courseRunJobDefaultsQuery = (actor: string, runId: string) =>
  queryOptions({
    queryKey: ["operations", "run-job-defaults", actor, runId],
    queryFn: async () => {
      const { data, error } = await db().rpc("course_run_job_defaults", {
        p_course_run_id: runId,
      });
      if (error) throw error;
      return data as CourseRunJobDefaults;
    },
  });

/** Authorized job provenance back to its original building block/template source. */
export interface JobBuildingBlockSource {
  template_id: string;
  building_block_id: string;
  source_id: string;
}
/** Read the job_building_block_reference server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const jobBuildingBlockQuery = (actor: string, jobId: string) =>
  queryOptions({
    queryKey: ["operations", "job-building-block", actor, jobId],
    queryFn: async () => {
      const { data, error } = await db().rpc("job_building_block_reference", {
        p_job_id: jobId,
      });
      if (error) throw error;
      return data as JobBuildingBlockSource | null;
    },
  });
