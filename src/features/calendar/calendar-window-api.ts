/** Calendar-only reads for the selected time window, within the actor's existing table policies. */
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { readDirectoryPages } from "../../lib/paged-read";
import { db } from "../../lib/supabase";
import type { PersonalEvent } from "../../lib/types";

type CalendarWindow = { from: string; to: string };

/** Read private appointments overlapping the window, including ones that start earlier. */
export const privateCalendarEventsQuery = (
  actor: string,
  window: CalendarWindow,
) =>
  queryOptions({
    // Editing, importing and recurring-event actions invalidate this actor prefix.
    queryKey: ["events", actor, window.from, window.to],
    queryFn: ({ signal }) =>
      readDirectoryPages<PersonalEvent>((start, end) =>
        db()
          .from("personal_events")
          .select(
            "id,user_id,title,description,meeting_url,starts_at,ends_at,time_zone,recurrence_series_id",
          )
          .eq("user_id", actor)
          .lt("starts_at", window.to)
          .gt("ends_at", window.from)
          .order("starts_at")
          .order("id")
          .range(start, end)
          .abortSignal(signal),
      ),
  });

type AssignmentSlot = {
  id: string;
  starts_at: string;
  ends_at: string;
  job_claims: { job_id: string };
};

/** Fetch just the actor's active teaching intervals; accepted fees never enter this result. */
export const calendarAssignmentsQuery = (
  actor: string,
  window: CalendarWindow,
) =>
  queryOptions({
    // Assignment and job mutations already invalidate the ["claims", actor] prefix.
    queryKey: ["claims", actor, "calendar", window.from, window.to],
    queryFn: ({ signal }) =>
      readDirectoryPages<AssignmentSlot>((start, end) =>
        db()
          .from("assignment_sessions")
          .select("id,starts_at,ends_at,job_claims!inner(job_id)")
          .eq("lecturer_id", actor)
          .eq("job_claims.lecturer_id", actor)
          .eq("job_claims.status", "confirmed")
          .is("released_at", null)
          .lt("starts_at", window.to)
          .gt("ends_at", window.from)
          .order("starts_at")
          .order("id")
          .range(start, end)
          .abortSignal(signal),
      ),
  });

/** Deep links can jump to an assignment outside the current window without loading its history. */
export const calendarAssignmentStartQuery = (
  actor: string,
  assignment: string | null,
) => {
  const parsed = z.uuid().safeParse(assignment);
  const id = parsed.data;
  return queryOptions({
    queryKey: ["claims", actor, "calendar-start", id],
    enabled: parsed.success,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .from("assignment_sessions")
        .select("starts_at,job_claims!inner()")
        .eq("lecturer_id", actor)
        .eq("job_claims.lecturer_id", actor)
        .eq("job_claims.status", "confirmed")
        .eq("job_claims.job_id", id!)
        .is("released_at", null)
        .order("starts_at")
        .limit(1)
        .abortSignal(signal)
        .maybeSingle<{ starts_at: string }>();
      if (error) throw error;
      return data?.starts_at ?? null;
    },
  });
};
