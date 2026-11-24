/**
 * Bounded personal previews and count-only reads. The dashboard uses existing row-level
 * permissions without requesting complete histories.
 */
import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import type { PersonalEvent } from "../../lib/types";
import { commercialKeys } from "../commercial/api";
import type { ContractRecord } from "../commercial/types";

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
      return (data ?? []) as Omit<
        PersonalEvent,
        "description" | "meeting_url"
      >[];
    },
    staleTime: 15000,
    retry: false,
  });

/** Read current own unacknowledged receipts before applying the dashboard limit. */
export const pendingContractPreviewQuery = (actor: string) =>
  queryOptions({
    queryKey: [...commercialKeys.contracts(actor), "dashboard-pending"],
    queryFn: async ({ signal }) => {
      const now = new Date().toISOString();
      const { data, error } = await db()
        .from("contracts")
        .select("id,title,expires_at,contract_acceptances()")
        .eq("user_id", actor)
        .eq("status", "active")
        .not("document_version_id", "is", null)
        .not("document_sha256", "is", null)
        .lte("effective_from", now)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .eq("contract_acceptances.user_id", actor)
        .is("contract_acceptances", null)
        .order("created_at", { ascending: false })
        .order("version", { ascending: false })
        .order("id", { ascending: false })
        .limit(3)
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []) as Pick<
        ContractRecord,
        "id" | "title" | "expires_at"
      >[];
    },
  });

/** Count every permitted expertise row, even when the row response would be capped. */
export const dashboardExpertiseCountQuery = (actor: string) =>
  queryOptions({
    queryKey: ["expertise", actor, "dashboard-count"],
    queryFn: async ({ signal }) => {
      const { count, error } = await db()
        .from("lecturer_topics")
        .select("topic_id", { count: "exact", head: true })
        .eq("user_id", actor)
        .abortSignal(signal);
      if (error) throw error;
      if (count === null) throw new Error("Expertise count is missing");
      return count;
    },
  });
