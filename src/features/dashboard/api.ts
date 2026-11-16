/**
 * Bounded personal previews of recent clean files and upcoming own appointments. Avoid complete
 * file/calendar history requests and use existing RLS queries for data visibility.
 */
import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import type { PersonalEvent } from "../../lib/types";

/** Bounded dashboard metadata without private file bytes. */
export interface RecentDocument {
  id: string;
  original_name: string;
  created_at: string;
}

// Keep the existing invalidation prefixes, but fetch only bounded preview
// metadata instead of loading the file centre or a whole calendar history.
/** Read documents through the native client, propagate access/read failures and scope cached data to the actor and requested resource. */
export const recentDocumentsQuery = (actor: string) =>
  queryOptions({
    queryKey: ["documents", actor, "dashboard-recent"],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .from("documents")
        .select("id,original_name,created_at")
        .is("deleted_at", null)
        .eq("status", "clean")
        .order("created_at", { ascending: false })
        .limit(5)
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []) as RecentDocument[];
    },
    staleTime: 15000,
    retry: false,
  });

/** Read personal_events through the native client, propagate access/read failures and scope cached data to the actor and requested resource. */
export const nextPersonalEventsQuery = (actor: string) =>
  queryOptions({
    queryKey: ["events", actor, "dashboard-next"],
    queryFn: async ({ signal }) => {
      const now = new Date();
      const until = new Date(now.getTime() + 30 * 86400000);
      const { data, error } = await db()
        .from("personal_events")
        .select("id,user_id,title,starts_at,ends_at,time_zone")
        .eq("user_id", actor)
        .gt("ends_at", now.toISOString())
        .lt("starts_at", until.toISOString())
        .order("starts_at")
        .limit(5)
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []) as PersonalEvent[];
    },
    staleTime: 15000,
    retry: false,
  });
