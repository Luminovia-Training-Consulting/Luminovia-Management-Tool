import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";

export interface LifecycleClaim {
  id: string;
  lecturer_id: string;
  lecturer_name: string;
  status: "confirmed" | "cancelled";
  created_at: string;
  can_cancel: boolean;
  sessions: {
    starts_at: string;
    ends_at: string;
    released_at: string | null;
  }[];
  events: { type: string; created_at: string; reason: string | null }[];
}
export interface JobLifecycle {
  version: number;
  capacity?: number;
  capacity_basis?: "single_position" | "per_position";
  confirmed_count?: number;
  open_positions?: number;
  can_set_capacity?: boolean;
  gross_budget?: number | null;
  max_net_budget?: number | null;
  can_manage: boolean;
  can_edit: boolean;
  can_duplicate: boolean;
  claims: LifecycleClaim[];
}

export async function setCapacity(
  job: string,
  capacity: number,
  version: number,
  request: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("set_job_capacity", {
    p_job_id: job,
    p_capacity: capacity,
    p_expected_version: version,
    p_request_id: request,
  });
  if (error) throw error;
  return data as string;
}
export const lifecycleQuery = (actor: string, job: string) =>
  queryOptions({
    queryKey: ["job-lifecycle", actor, job],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("job_lifecycle", { p_job_id: job })
        .abortSignal(signal);
      if (error) throw error;
      return data as JobLifecycle;
    },
  });

export async function manageOffer(input: {
  job: string;
  action: "draft" | "published" | "archived" | "reopen" | "edit" | "duplicate";
  version: number;
  request: string;
  payload?: Record<string, unknown>;
}) {
  requireOnline();
  const { data, error } = await db().rpc("manage_job_offer", {
    p_job_id: input.job,
    p_action: input.action,
    p_expected_version: input.version,
    p_request_id: input.request,
    p_payload: input.payload ?? {},
  });
  if (error) throw error;
  return data as string;
}

export async function cancelAssignment(
  claim: string,
  reason: string,
  request: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("cancel_job_assignment", {
    p_claim_id: claim,
    p_reason: reason,
    p_request_id: request,
  });
  if (error) throw error;
  return data as string;
}

/** Refresh only state affected by job publication/allocation, rather than every
 * mounted profile, file, directory and knowledge query in the application. */
export async function refreshJobState(client: QueryClient) {
  await Promise.all(
    [
      "jobs",
      "job-board",
      "job-lifecycle",
      "claims",
      "finance",
      "commission-report",
      "client-requests",
      "client-spend",
      "notifications",
      "chat-rooms",
      "chat-members",
      "chat-messages",
      "operations",
    ].map((key) => client.invalidateQueries({ queryKey: [key] })),
  );
}
