/** Current-actor discovery/detail/dashboard contracts preserve restricted compensation as null. */
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { throwPagedReadError } from "../../lib/paged-read";
import { requireOnline } from "../../lib/online";
import {
  assignmentCalendarMetadataLimit,
  assignmentCalendarMetadataSchema,
  type AssignmentCalendarMetadata,
  defaultJobFilters,
  discoveryPageSchema,
  jobDashboardSchema,
  jobFilterFieldsSchema,
  jobFiltersSchema,
  jobSchema,
  savedViewSchema,
  savedViewsSchema,
  type JobCursor,
  type JobFilters,
  type SavedJobView,
} from "./discovery-schema";
export {
  assignmentCalendarMetadataSchema,
  defaultJobFilters,
  discoveryPageSchema,
  jobFiltersSchema,
  type AssignmentCalendarMetadata,
  type JobCursor,
  type JobFilters,
  type SavedJobView,
} from "./discovery-schema";

function filterInputFromParams(params: URLSearchParams) {
  const input: Record<string, unknown> = {};
  for (const key of Object.keys(defaultJobFilters)) {
    if (key === "topic_ids")
      input[key] = params.getAll("topic").filter(Boolean);
    else if (key === "available_only")
      input[key] = params.get("available") === "1";
    else if (key === "include_history")
      input[key] = params.get("history") === "1";
    else if (key.startsWith("min_") || key.startsWith("max_")) {
      const value =
        params.get(key) ?? (key === "min_total" ? params.get("min") : null);
      if (value !== null && value !== "") input[key] = Number(value);
    } else if (params.has(key)) input[key] = params.get(key);
  }
  return input;
}

export function filtersFromParams(params: URLSearchParams) {
  return jobFiltersSchema.safeParse(filterInputFromParams(params));
}

export function filterDraftFromParams(params: URLSearchParams) {
  const parsed = jobFilterFieldsSchema.safeParse(filterInputFromParams(params));
  return parsed.success ? parsed.data : defaultJobFilters;
}

export function filterParams(filters: JobFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (key === "topic_ids")
      for (const id of value as string[]) params.append("topic", id);
    else if (key === "available_only") {
      if (value) params.set("available", "1");
    } else if (key === "include_history") {
      if (value) params.set("history", "1");
    } else if (
      value !== null &&
      value !== "" &&
      value !== defaultJobFilters[key as keyof JobFilters]
    )
      params.set(key, String(value));
  }
  return params;
}

/** Start fresh infinite pages when an observed role changes; SQL checks unobserved cursor changes. */
export const jobDiscoveryQuery = (
  actor: string,
  filters: JobFilters,
  quoteContext = "",
) =>
  infiniteQueryOptions({
    // Known role transitions reset infinite pages; SQL also binds opaque cursors
    // to fresh role/policy context for changes the browser has not observed.
    queryKey: ["jobs", "discovery", actor, filters, quoteContext],
    initialPageParam: null as JobCursor | null,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error, status } = await db()
        .rpc("job_discovery", {
          p_filters: filters,
          p_cursor: pageParam,
          p_limit: 50,
        })
        .abortSignal(signal);
      if (error) throwPagedReadError(error, status);
      return discoveryPageSchema.parse(data);
    },
    getNextPageParam: (page) =>
      page.has_more ? (page.next_cursor ?? undefined) : undefined,
    staleTime: 15000,
    refetchOnWindowFocus: "always",
    refetchInterval: 30000,
  });
/** Validate the complete exact detail DTO, including a possibly restricted quote. */
export const jobDetailQuery = (actor: string, id: string) =>
  queryOptions({
    queryKey: ["jobs", "detail", actor, id],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("job_detail", { p_job_id: id })
        .abortSignal(signal);
      if (error) throw error;
      return jobSchema.parse(data);
    },
    enabled: Boolean(id),
    refetchOnWindowFocus: "always",
    refetchInterval: 15000,
  });
export const savedJobViewsQuery = (actor: string) =>
  queryOptions({
    queryKey: ["saved-job-views", actor],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("saved_job_views")
        .abortSignal(signal);
      if (error) throw error;
      return savedViewsSchema.parse(data);
    },
  });

export async function saveJobView(
  id: string,
  name: string,
  filters: JobFilters,
  version: number,
) {
  requireOnline();
  const { data, error } = await db().rpc("save_job_view", {
    p_id: id,
    p_name: name,
    p_filters: jobFiltersSchema.parse(filters),
    p_expected_version: version,
  });
  if (error) throw error;
  return savedViewSchema.parse(data);
}

export async function removeJobView(view: SavedJobView) {
  requireOnline();
  const { error } = await db().rpc("remove_job_view", {
    p_id: view.id,
    p_expected_version: view.version,
  });
  if (error) throw error;
}

/** Share strict quote/null validation with marketplace items so suggestions never coerce restricted amounts. */
export const jobDashboardQuery = (actor: string) =>
  queryOptions({
    queryKey: ["jobs", "dashboard", actor],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("job_dashboard")
        .abortSignal(signal);
      if (error) throw error;
      return jobDashboardSchema.parse(data);
    },
  });
export const assignmentCalendarMetadataQuery = (
  actor: string,
  ids: string[],
) => {
  const identities = [...new Set(ids)].sort();
  return queryOptions({
    queryKey: ["jobs", "assignment-calendar-metadata", actor, identities],
    queryFn: async ({ signal }) => {
      const rows: AssignmentCalendarMetadata[] = [];
      for (
        let start = 0;
        start < identities.length;
        start += assignmentCalendarMetadataLimit
      ) {
        const p_job_ids = identities.slice(
          start,
          start + assignmentCalendarMetadataLimit,
        );
        const { data, error } = await db()
          .rpc("assignment_calendar_metadata", { p_job_ids })
          .abortSignal(signal);
        if (error) throw error;
        rows.push(...assignmentCalendarMetadataSchema.parse(data));
      }
      return rows;
    },
    enabled: identities.length > 0,
    retry: false,
  });
};
