import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import {
  candidatesSchema,
  ownWaitlistSchema,
  substitutionReceiptSchema,
  substitutionsSchema,
  waitlistSchema,
  type Substitution,
} from "./handover-schema";
export type { Substitution } from "./handover-schema";

const uuid = z.string().uuid();
export const waitlistKey = (actor: string, job: string) =>
  ["job-waitlist", actor, job] as const;
export const waitlistQuery = (actor: string, job: string) =>
  queryOptions({
    queryKey: waitlistKey(actor, job),
    enabled: uuid.safeParse(job).success,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("job_waitlist", { p_job_id: job })
        .abortSignal(signal);
      if (error) throw error;
      return waitlistSchema.parse(data);
    },
    staleTime: 15000,
    retry: false,
  });
export const myWaitlistQuery = (actor: string) =>
  queryOptions({
    queryKey: ["my-job-waitlist", actor],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("my_job_waitlist")
        .abortSignal(signal);
      if (error) throw error;
      return ownWaitlistSchema.parse(data);
    },
    staleTime: 15000,
    retry: false,
  });

export async function setWaitlist(job: string, join: boolean) {
  requireOnline();
  const { data, error } = await db().rpc("set_job_waitlist", {
    p_job_id: job,
    p_join: join,
  });
  if (error) throw error;
  return waitlistSchema.parse(data);
}

export const substitutionCandidatesQuery = (
  actor: string,
  claim: string | null,
  search: string,
) =>
  queryOptions({
    queryKey: ["substitution-candidates", actor, claim, search],
    enabled: claim !== null,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("substitution_candidates", {
          p_claim_id: claim!,
          p_search: search,
          p_limit: 30,
        })
        .abortSignal(signal);
      if (error) throw error;
      return candidatesSchema.parse(data);
    },
    staleTime: 15000,
    retry: false,
  });
const substitutionsKey = (actor: string, job?: string) =>
  ["job-substitutions", actor, job ?? "inbox"] as const;
export const substitutionsQuery = (actor: string, job?: string) =>
  queryOptions({
    queryKey: substitutionsKey(actor, job),
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("job_substitutions", { p_job_id: job ?? null })
        .abortSignal(signal);
      if (error) throw error;
      return substitutionsSchema.parse(data);
    },
    staleTime: 15000,
    retry: false,
  });

export async function proposeSubstitution(
  claim: string,
  target: string,
  reason: string,
  request: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("propose_job_substitution", {
    p_claim_id: claim,
    p_target_user_id: target,
    p_reason: reason.trim(),
    p_request_id: request,
  });
  if (error) throw error;
  return uuid.parse(data);
}

export async function respondSubstitution(
  offer: Substitution,
  action: "accept" | "decline" | "withdraw",
  request: string,
  consent: boolean,
) {
  requireOnline();
  const { data, error } = await db().rpc("respond_job_substitution", {
    p_offer_id: offer.id,
    p_action: action,
    p_quote_hash: offer.quote_hash,
    p_request_id: request,
    p_accept_terms: consent,
  });
  if (error) throw error;
  return substitutionReceiptSchema.parse(data);
}
