/** Actor-scoped withdrawal reads and server-confirmed actions. */
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";

const uuid = z.string().uuid();
const status = z.enum([
  "pending",
  "approved",
  "rejected",
  "withdrawn",
  "superseded",
]);
const receipt = z.object({ id: uuid, status });
const snapshot = z.object({
  can_review: z.boolean(),
  claims: z.array(
    z.object({
      claim_id: uuid,
      starts_at: z.string(),
      can_withdraw: z.boolean(),
      requires_approval: z.boolean(),
    }),
  ),
  items: z.array(
    z.object({
      id: uuid,
      claim_id: uuid,
      job_id: uuid,
      job_title: z.string(),
      lecturer_id: uuid,
      lecturer_name: z.string(),
      status,
      reason: z.string(),
      review_reason: z.string().nullable(),
      created_at: z.string(),
      resolved_at: z.string().nullable(),
      can_review: z.boolean(),
    }),
  ),
});

/** Load current actor-scoped applications and server-derived withdrawal capabilities. */
export const withdrawalsQuery = (actor: string, job: string) =>
  queryOptions({
    queryKey: ["assignment-withdrawals", actor, job],
    enabled: uuid.safeParse(job).success,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("assignment_withdrawals", { p_job_id: job })
        .abortSignal(signal);
      if (error) throw error;
      return snapshot.parse(data);
    },
    staleTime: 15000,
    retry: false,
  });

/** Submit an own withdrawal and validate its committed, retry-safe server receipt. */
export async function requestWithdrawal(
  claim: string,
  reason: string,
  request: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("request_assignment_withdrawal", {
    p_claim_id: claim,
    p_reason: reason,
    p_request_id: request,
  });
  if (error) throw error;
  return receipt.parse(data);
}

/** Confirm one explicit authorized decision and validate the returned workflow state. */
export async function reviewWithdrawal(
  id: string,
  approve: boolean,
  reason: string,
  request: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("review_assignment_withdrawal", {
    p_withdrawal_id: id,
    p_approve: approve,
    p_reason: reason,
    p_request_id: request,
  });
  if (error) throw error;
  return receipt.parse(data);
}
