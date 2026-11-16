/** Current-organisation request projections and online-only CAS writes; browser IDs never grant access. */
import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
export interface RequestBrief {
  teaching_units: number;
  unit_minutes: 45 | 60;
  instructions: string;
  required_documents: string[];
  documents: { version_id: string; category: "material" | "report" }[];
}
export interface RequestBriefView {
  version: number;
  brief: RequestBrief | null;
  editable: boolean;
  documents: {
    version_id: string;
    category: "material" | "report";
    name: string;
    sha256: string;
  }[];
}
export interface RequestRevision {
  id: number;
  event: string;
  created_at: string;
  snapshot: {
    status: string;
    brief_version: number;
    brief: RequestBrief | null;
    payload: { title: string };
    job_id: string | null;
  };
}
export const requestBriefKey = (actor: string, request: string) =>
  ["client-request-brief", actor, request] as const;
/** Fetches the exact request brief with actor-keyed caching and abortable navigation. */
export const requestBriefQuery = (actor: string, request: string) =>
  queryOptions({
    queryKey: requestBriefKey(actor, request),
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("client_request_brief", { p_request_id: request })
        .abortSignal(signal);
      if (error || !data) throw error ?? new Error("unconfirmed");
      return data as RequestBriefView;
    },
    staleTime: 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
/** Returns only the server-confirmed new version; conflicts leave the caller draft intact. */
export async function saveRequestBrief(
  request: string,
  brief: RequestBrief,
  version: number,
) {
  requireOnline();
  const { data, error } = await db().rpc("save_client_request_brief", {
    p_request_id: request,
    p_brief: brief,
    p_expected_version: version,
  });
  if (error || !data) throw error ?? new Error("unconfirmed");
  return data as number;
}
/** Reads immutable snapshots using a strictly decreasing server cursor. */
export async function requestHistory(
  request: string,
  before: number | null,
  signal: AbortSignal,
) {
  const { data, error } = await db()
    .rpc("client_request_history", { p_request_id: request, p_before: before })
    .abortSignal(signal);
  if (error) throw error;
  return (data ?? []) as RequestRevision[];
}
export const initialRequestBrief = (): RequestBrief => ({
  teaching_units: 8,
  unit_minutes: 45,
  instructions: "",
  required_documents: [],
  documents: [],
});
/** Mirrors useful form constraints; authoritative duration and file validation remains in SQL. */
export function validRequestBrief(
  brief: RequestBrief,
  sessions: { starts_at: string; ends_at: string }[],
) {
  const minutes = sessions.reduce(
    (sum, s) => sum + (Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60000,
    0,
  );
  return (
    Number.isInteger(brief.teaching_units) &&
    brief.teaching_units > 0 &&
    brief.teaching_units <= 9999 &&
    [45, 60].includes(brief.unit_minutes) &&
    brief.teaching_units * brief.unit_minutes <= minutes &&
    brief.instructions.length <= 4000 &&
    brief.required_documents.length <= 30 &&
    brief.required_documents.every(
      (s) => s.trim().length > 0 && s.length <= 300,
    )
  );
}

export const cleanRequestBrief = (brief: RequestBrief): RequestBrief => ({
  ...brief,
  required_documents: brief.required_documents
    .map((s) => s.trim())
    .filter(Boolean),
});
