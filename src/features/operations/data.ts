/**
 * DTOs and actor-scoped reads for organizations, contacts, course sources, templates and course
 * runs. Relational references keep reusable content separate from scheduled teaching.
 */
import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
/** Shared organization metadata from the permitted directory. */
export interface Organisation {
  id: string;
  name: string;
  country: string | null;
  time_zone: string;
  industry: string;
  city: string;
  tags: string[];
  archived_at: string | null;
}
/** Business contact in its separately authorized organization context. */
export interface Contact {
  id: string;
  organisation_id: string;
  name: string;
  position: string;
  email: string;
  phone: string;
  notes: string;
  archived_at: string | null;
}
/** Reusable course content without concrete sessions or copies of personal contracts. */
export interface Template {
  id: string;
  title: string;
  description: string;
  syllabus: string;
  prerequisites: string;
  archived_at: string | null;
  building_block_id: string | null;
  building_block_source_id: string | null;
  course_template_topics: { topic_id: string }[];
}
/** Exact original course revision with hash and provenance metadata. */
export interface BuildingBlockSource {
  id: string;
  building_block_id: string;
  file_name: string;
  sha256: string;
  page_count: number;
  content_pages: number[];
  created_on: string;
  revision_on: string;
  is_primary: boolean;
}
/** Canonical course curriculum with separately retained original source revisions. */
export interface BuildingBlock {
  id: string;
  provider: string;
  code: string;
  title: string;
  description: string;
  syllabus: string;
  prerequisites: string;
  duration_days: number;
  duration_hours: number;
  theory_percent: number | null;
  practice_percent: number | null;
  notes: string;
  default_template_id: string;
  building_block_sources: BuildingBlockSource[];
}
/** Read building_blocks through the native client, propagate access/read failures and scope cached data to the actor and requested resource. */
export const buildingBlocksQuery = (actor: string) =>
  queryOptions({
    queryKey: ["operations", "building-blocks", actor],
    queryFn: async () => {
      const { data, error } = await db()
        .from("building_blocks")
        .select("*,building_block_sources(*)")
        .order("code");
      if (error) throw error;
      return data as BuildingBlock[];
    },
  });
/** Actual run with customer, zone and concrete sessions, separate from its content template. */
export interface CourseRun {
  id: string;
  template_id: string;
  organisation_id: string | null;
  time_zone: string;
  delivery_type: "online" | "onsite";
  venue: string;
  published: boolean;
  archived_at: string | null;
  course_sessions: { id: string; starts_at: string; ends_at: string }[];
}
/** Read organisations through the native client, propagate access/read failures and scope cached data to the actor and requested resource. */
export const orgQuery = (actor: string) =>
  queryOptions({
    queryKey: ["operations", "organisations", actor],
    queryFn: async () => {
      const { data, error } = await db()
        .from("organisations")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as Organisation[];
    },
  });
/** Read organisation_contacts through the native client, propagate access/read failures and scope cached data to the actor and requested resource. */
export const contactsQuery = (actor: string) =>
  queryOptions({
    queryKey: ["operations", "contacts", actor],
    queryFn: async () => {
      const { data, error } = await db()
        .from("organisation_contacts")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as Contact[];
    },
  });
/**
 * Read organisation_private_details through the native client, propagate access/read failures
 * and scope cached data to the actor and requested resource.
 */
export const notesQuery = (actor: string) =>
  queryOptions({
    queryKey: ["operations", "notes", actor],
    queryFn: async () => {
      const { data, error } = await db()
        .from("organisation_private_details")
        .select("*");
      if (error) throw error;
      return data as { organisation_id: string; private_notes: string }[];
    },
  });
/** Read course_templates through the native client, propagate access/read failures and scope cached data to the actor and requested resource. */
export const templatesQuery = (actor: string) =>
  queryOptions({
    queryKey: ["operations", "templates", actor],
    queryFn: async () => {
      const { data, error } = await db()
        .from("course_templates")
        .select("*,course_template_topics(topic_id)")
        .order("title");
      if (error) throw error;
      return data as Template[];
    },
  });
/** Read course_runs through the native client, propagate access/read failures and scope cached data to the actor and requested resource. */
export const runsQuery = (actor: string) =>
  queryOptions({
    queryKey: ["operations", "runs", actor],
    queryFn: async () => {
      const { data, error } = await db()
        .from("course_runs")
        .select("*,course_sessions(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CourseRun[];
    },
  });
