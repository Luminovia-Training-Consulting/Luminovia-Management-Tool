/**
 * DTOs and actor-scoped reads for organizations, contacts, course sources, templates and course
 * runs. Relational references keep reusable content separate from scheduled teaching.
 */
import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { readDirectoryPages } from "../../lib/paged-read";
import { companyPremiumSettingsSchema } from "./company-premium-schema";

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

/** Read current company LMS flags for staff who may already manage the organization directory. */
export const companyPremiumSettingsQuery = (actor: string) =>
  queryOptions({
    queryKey: ["operations", "company-premium", actor],
    queryFn: async () => {
      const { data, error } = await db().rpc("company_premium_settings");
      if (error) throw error;
      return companyPremiumSettingsSchema.parse(data);
    },
  });

type Lecturer = { id: string; display_name: string };
type Roster = { members: Lecturer[]; candidates: Lecturer[]; can_add: boolean };

export const companyLecturersQuery = (actor: string, organisation: string) =>
  queryOptions({
    queryKey: ["company-lecturers", actor, organisation],
    enabled: Boolean(organisation),
    queryFn: async () => {
      const { data, error } = await db().rpc(
        "company_lecturer_roster",
        {
          p_organisation_id: organisation,
        },
        { get: true },
      );
      if (error) throw error;
      return data as Roster;
    },
  });

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
  owner_organisation_id?: string | null;
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
  code: string;
  duration_days: number;
  duration_hours: number;
  notes: string;
  building_block_sources: BuildingBlockSource[];
}

/** Lightweight course codes and durations for template search and schedule planning. */
export const buildingBlockPlanningQuery = (actor: string) =>
  queryOptions({
    queryKey: ["operations", "building-block-planning", actor],
    queryFn: ({ signal }) =>
      readDirectoryPages<
        Pick<BuildingBlock, "id" | "code" | "duration_days" | "duration_hours">
      >((from, to) =>
        db()
          .from("building_blocks")
          .select("id,code,duration_days,duration_hours")
          .order("code")
          .order("id")
          .range(from, to)
          .abortSignal(signal),
      ),
  });

/** Read provenance only for the requested course source. */
export const buildingBlockQuery = (actor: string, id: string | undefined) =>
  queryOptions({
    queryKey: ["operations", "building-block", actor, id],
    enabled: Boolean(id),
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .from("building_blocks")
        .select(
          "id,code,duration_days,duration_hours,notes,building_block_sources(id,file_name,sha256,page_count,content_pages,created_on,revision_on,is_primary)",
        )
        .eq("id", id!)
        .abortSignal(signal)
        .maybeSingle<BuildingBlock>();
      if (error) throw error;
      return data;
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
  teaching_language?: "de" | "en" | null;
  creation_origin?: "staff" | "company" | "unknown";
  own_lecturers_only?: boolean;
  archived_at: string | null;
  created_at?: string;
  course_sessions: { id: string; starts_at: string; ends_at: string }[];
  jobs?: {
    id: string;
    title: string;
    status: string;
    company_internal?: boolean;
    claim_deadline?: string | null;
    first_session?: { starts_at: string }[];
    capacity?: number;
    job_claims?: {
      status: string;
      lecturer_id?: string;
      profiles: { display_name: string } | null;
    }[];
  }[];
}

/** Read organisations through the native client, propagate access/read failures and scope cached data to the actor and requested resource. */
export const orgQuery = (actor: string) =>
  queryOptions({
    queryKey: ["operations", "organisations", actor],
    queryFn: ({ signal }) =>
      readDirectoryPages<Organisation>((from, to) =>
        db()
          .from("organisations")
          .select("*")
          .order("name")
          .order("id")
          .range(from, to)
          .abortSignal(signal),
      ),
  });
/** Read organisation_contacts through the native client, propagate access/read failures and scope cached data to the actor and requested resource. */
export const contactsQuery = (
  actor: string,
  organisation: string | undefined,
) =>
  queryOptions({
    queryKey: ["operations", "contacts", actor, organisation],
    enabled: Boolean(organisation),
    queryFn: ({ signal }) =>
      readDirectoryPages<Contact>((from, to) =>
        db()
          .from("organisation_contacts")
          .select("*")
          .eq("organisation_id", organisation!)
          .order("name")
          .order("id")
          .range(from, to)
          .abortSignal(signal),
      ),
  });
/** Fetch only the selected organisation's private notes under the existing RLS policy. */
export const notesQuery = (actor: string, organisation: string | undefined) =>
  queryOptions({
    queryKey: ["operations", "notes", actor, organisation],
    enabled: Boolean(organisation),
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .from("organisation_private_details")
        .select("private_notes")
        .eq("organisation_id", organisation!)
        .abortSignal(signal)
        .maybeSingle<{ private_notes: string }>();
      if (error) throw error;
      return data?.private_notes ?? "";
    },
  });
/** Keep the selected company's library separate from the actor's run metadata and global library. */
export const templatesQuery = (actor: string, company?: string) =>
  queryOptions({
    queryKey: company
      ? ["operations", "templates", actor, company]
      : ["operations", "templates", actor],
    queryFn: ({ signal }) =>
      readDirectoryPages<Template>((from, to) => {
        const query = db()
          .from("course_templates")
          .select("*,course_template_topics(topic_id)");
        if (company) query.eq("owner_organisation_id", company);
        return query
          .order("title")
          .order("id")
          .range(from, to)
          .abortSignal(signal);
      }),
  });
/** Read course_runs through the native client, propagate access/read failures and scope cached data to the actor and requested resource. */
export const runsQuery = (actor: string, withAssignments = false) =>
  queryOptions({
    queryKey: withAssignments
      ? ["operations", "runs", actor, "assignments"]
      : ["operations", "runs", actor],
    queryFn: ({ signal }) =>
      readDirectoryPages<CourseRun>((from, to) => {
        const query = db()
          .from("course_runs")
          .select(
            `id,template_id,organisation_id,time_zone,delivery_type,venue,published,teaching_language,creation_origin,own_lecturers_only,archived_at,created_at,course_sessions(id,starts_at,ends_at),jobs(id,title,status,company_internal,claim_deadline,first_session:job_sessions(starts_at)${
              withAssignments
                ? ",capacity,job_claims(status,lecturer_id,profiles!job_claims_lecturer_id_fkey(display_name))"
                : ""
            })`,
          )
          .order("created_at", { ascending: false })
          .order("id")
          .order("starts_at", { referencedTable: "course_sessions" })
          .order("starts_at", { referencedTable: "jobs.first_session" })
          .limit(1, { referencedTable: "jobs.first_session" });
        if (withAssignments) query.eq("jobs.job_claims.status", "confirmed");
        return query.range(from, to).abortSignal(signal);
      }),
  });

/** Only published course sessions that overlap the current calendar range. */
type CalendarCourseRun = Pick<
  CourseRun,
  "id" | "template_id" | "organisation_id" | "course_sessions"
> & {
  course_templates: {
    title: string;
    course_template_topics: {
      topics: { id: string; label_de: string; label_en: string } | null;
    }[];
  } | null;
  organisations: { name: string } | null;
};

export const calendarCourseRunsQuery = (
  actor: string,
  from: string,
  to: string,
) =>
  queryOptions({
    queryKey: ["operations", "calendar-runs", actor, from, to],
    queryFn: ({ signal }) =>
      readDirectoryPages<CalendarCourseRun>((start, end) =>
        db()
          .from("course_runs")
          .select(
            "id,template_id,organisation_id,course_sessions!inner(id,starts_at,ends_at)," +
              "course_templates(title,course_template_topics(topics(id,label_de,label_en))),organisations(name)",
          )
          .eq("published", true)
          .is("archived_at", null)
          .lt("course_sessions.starts_at", to)
          .gt("course_sessions.ends_at", from)
          .order("id")
          .range(start, end)
          .abortSignal(signal),
      ),
  });
