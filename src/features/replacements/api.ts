/** Future whole-block replacements reuse the existing online claim contract; the original allocation stays confirmed until a complete transactional handover succeeds. Actor-scoped memory queries validate server projections; online mutations carry reviewed versions and retry identities. */
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";

const quoteSchema = z.object({
  amount: z.number().nonnegative(),
  total_amount: z.number().nonnegative(),
  currency: z.string(),
  rate_unit: z.string(),
  terms: z.string(),
  terms_version: z.number().int(),
});
const offerSchema = z.object({
  id: z.uuid(),
  job_id: z.uuid(),
  title: z.string(),
  time_zone: z.string(),
  status: z.enum(["open", "cancelled", "completed"]),
  mode: z.enum(["open", "selected"]),
  emergency: z.boolean(),
  version: z.number().int(),
  created_at: z.string(),
  can_cancel: z.boolean(),
  can_claim: z.boolean(),
  reason: z.string().nullable(),
  quote: quoteSchema.nullable(),
  sessions: z.array(z.object({ starts_at: z.string(), ends_at: z.string() })),
});
export type ReplacementOffer = z.infer<typeof offerSchema>;
export const replacementQuery = (actor: string) =>
  queryOptions({
    queryKey: ["replacements", actor],
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("replacement_marketplace")
        .abortSignal(signal);
      if (error) throw error;
      return z.array(offerSchema).parse(data);
    },
    refetchInterval: 30000,
    staleTime: 0,
  });
const assignmentSchema = z.object({
  claim_id: z.uuid(),
  job_id: z.uuid(),
  title: z.string(),
  lecturer: z.string(),
});
export const replacementAssignmentsQuery = (actor: string) =>
  queryOptions({
    queryKey: ["replacement-assignments", actor],
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("replacement_assignments")
        .abortSignal(signal);
      if (error) throw error;
      return z.array(assignmentSchema).parse(data);
    },
    staleTime: 0,
  });
export const replacementRequestSchema = z
  .object({
    claim: z.uuid(),
    reason: z.string().trim().min(5).max(1000),
    mode: z.enum(["open", "selected"]),
    invited: z.array(z.uuid()).max(50),
    emergency: z.boolean(),
  })
  .refine((v) =>
    v.mode === "open" ? v.invited.length === 0 : v.invited.length > 0,
  );

/** Validate the selected/open audience and submit an actor-bound idempotent search request. */
export async function requestReplacement(
  input: z.infer<typeof replacementRequestSchema>,
  request: string,
) {
  requireOnline();
  const values = replacementRequestSchema.parse(input);
  const { data, error } = await db().rpc("request_replacement", {
    p_claim_id: values.claim,
    p_reason: values.reason,
    p_mode: values.mode,
    p_invited_user_ids: values.invited,
    p_emergency: values.emergency,
    p_request_id: request,
  });
  if (error) throw error;
  return z.uuid().parse(data);
}

/** Close only the search at its reviewed version; the original assignment is not cancelled by this operation. */
export async function cancelReplacement(
  offer: ReplacementOffer,
  request: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("cancel_replacement", {
    p_offer_id: offer.id,
    p_expected_version: offer.version,
    p_request_id: request,
  });
  if (error) throw error;
  return z.uuid().parse(data);
}

/** Submit the reviewed quote token to the authoritative transaction; a returned refusal is never promoted to success. */
export async function claimReplacement(
  offer: ReplacementOffer,
  request: string,
) {
  requireOnline();
  if (!offer.quote || !offer.can_claim) throw new Error("unavailable");
  const { data, error } = await db().rpc("claim_replacement", {
    p_offer_id: offer.id,
    p_expected_version: offer.version,
    p_terms_version: offer.quote.terms_version,
    p_request_id: request,
  });
  if (error) throw error;
  return z
    .object({ status: z.string(), claim_id: z.uuid().optional() })
    .parse(data);
}
