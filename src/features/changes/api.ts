/** Typed frontend boundary for persisted assignment amendments. Every read uses
 * the current actor cache; writes require confirmed online RPC responses and
 * leave the accepted original claim untouched. */
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { refreshJobState } from "../jobs/lifecycle-api";
import { assignmentChangeSchema, candidateSchema } from "./schema";
export type {
  AssignmentChange,
  AssignmentSnapshot,
  ChangeCandidate,
} from "./schema";
const uuid = z.string().uuid();
export interface ChangeInput {
  reason: string;
  changes: {
    sessions?: { starts_at: string; ends_at: string }[];
    location: string;
    scope: string;
    terms?: string;
    cancel?: boolean;
    amount?: number;
    total_amount?: number;
    rate_unit?: string;
  };
}
/** Fetch the current permission-checked request list or one detail. An error
 * propagates so callers remove previously allowed cached presentation. */
export const changesQuery = (actor: string, id?: string) =>
  queryOptions({
    queryKey: ["assignment-changes", actor, id ?? "all"],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("assignment_changes", { p_id: id ?? null })
        .abortSignal(signal);
      if (error) throw error;
      return z.array(assignmentChangeSchema).parse(data);
    },
    staleTime: 10000,
    refetchInterval: 30000,
    retry: false,
  });
/** Candidate discovery is convenience only; eligibility is checked again at
 * draft creation and atomically at apply, including newly added conflicts. */
export const changeCandidatesQuery = (actor: string) =>
  queryOptions({
    queryKey: ["changeable-assignments", actor],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("changeable_assignments")
        .abortSignal(signal);
      if (error) throw error;
      return z.array(candidateSchema).parse(data);
    },
    staleTime: 10000,
    retry: false,
  });
/** Persist an own versioned draft; the caller retains its request UUID for an
 * unchanged uncertain retry. The server captures and fingerprints originals. */
export async function saveAssignmentChange(
  id: string | null,
  claim: string,
  payload: ChangeInput,
  version: number,
  request: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("save_assignment_change", {
    p_id: id,
    p_claim_id: claim,
    p_payload: payload,
    p_expected_version: version,
    p_request_id: request,
  });
  if (error) throw error;
  return uuid.parse(data);
}
/** Request a single audited state transition. Both consent and apply bind the
 * exact server version; a rejected/invalid response never confirms a mutation. */
export async function changeAssignmentAction(
  id: string,
  action: "submit" | "accept" | "reject" | "withdraw" | "apply",
  version: number,
  note: string,
  request: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("assignment_change_action", {
    p_id: id,
    p_action: action,
    p_expected_version: version,
    p_note: note,
    p_request_id: request,
  });
  if (error) throw error;
  return uuid.parse(data);
}
/** A committed amendment affects calendar, current quote, finance and readiness.
 * Invalidate their established cache prefixes only after server confirmation. */
export async function refreshAssignmentChanges(client: QueryClient) {
  await refreshJobState(client);
}
