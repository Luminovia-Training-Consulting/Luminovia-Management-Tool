/**
 * Quellenbindung zwischen CBW-Vorlagen, tatsächlichen Kursläufen und daraus erstellten Angeboten. Eine Quellenrevision erlaubt dem Server, veraltete Angebotsentwürfe zurückzuweisen statt Termine still auszutauschen.
 */
import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";

/** Überprüfter Kursquellenstand für einen neuen Auftrag, einschließlich serverseitig vergleichbarer Quellenrevision. */
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
/** Lädt die Serverprojektion über course_run_job_defaults und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
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

/** Berechtigte Provenienzprojektion eines Auftrags zur ursprünglichen Baustein-/Vorlagenquelle. */
export interface JobBuildingBlockSource {
  template_id: string;
  building_block_id: string;
  source_id: string;
}
/** Lädt die Serverprojektion über job_building_block_reference und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
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
