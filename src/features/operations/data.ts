/**
 * DTOs and actor-scoped reads for organizations, contacts, course sources, templates and course
 * runs. Relational references keep reusable content separate from scheduled teaching.
 */
import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
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

/** Read past the configured REST response cap using a stable order and abortable pages. */
async function readDirectoryPages<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: unknown[] | null;
    error: unknown;
  }>,
): Promise<T[]> {
  const size = 250;
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw error;
    const received = data ?? [];
    rows.push(...(received as T[]));
    if (received.length < size) return rows;
  }
}

/** Read building_blocks through the native client, propagate access/read failures and scope cached data to the actor and requested resource. */
export const buildingBlocksQuery = (actor: string) =>
  queryOptions({
    queryKey: ["operations", "building-blocks", actor],
    queryFn: ({ signal }) =>
      readDirectoryPages<BuildingBlock>((from, to) =>
        db()
          .from("building_blocks")
          .select("*,building_block_sources(*)")
          .order("code")
          .order("id")
          .range(from, to)
          .abortSignal(signal),
      ),
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
  creation_origin?: "staff" | "company" | "unknown";
  own_lecturers_only?: boolean;
  archived_at: string | null;
  course_sessions: { id: string; starts_at: string; ends_at: string }[];
  jobs?: {
    id: string;
    title: string;
    status: string;
    company_internal?: boolean;
    claim_deadline?: string | null;
    job_sessions?: { starts_at: string }[];
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
/** Read course_templates through the native client, propagate access/read failures and scope cached data to the actor and requested resource. */
export const templatesQuery = (actor: string) =>
  queryOptions({
    queryKey: ["operations", "templates", actor],
    queryFn: ({ signal }) =>
      readDirectoryPages<Template>((from, to) =>
        db()
          .from("course_templates")
          .select("*,course_template_topics(topic_id)")
          .order("title")
          .order("id")
          .range(from, to)
          .abortSignal(signal),
      ),
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
            `*,course_sessions(*),jobs(id,title,status,company_internal,claim_deadline,job_sessions(starts_at)${
              withAssignments
                ? ",capacity,job_claims(status,lecturer_id,profiles!job_claims_lecturer_id_fkey(display_name))"
                : ""
            })`,
          )
          .order("created_at", { ascending: false })
          .order("id");
        if (withAssignments) query.eq("jobs.job_claims.status", "confirmed");
        return query.range(from, to).abortSignal(signal);
      }),
  });
