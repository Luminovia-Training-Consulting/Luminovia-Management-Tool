import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { validZone } from "../../lib/dates";

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const waitlistSchema = z.object({
  job_id: uuid,
  title: z.string(),
  joined: z.boolean(),
  can_join: z.boolean(),
  available: z.boolean(),
});
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
      return z
        .array(waitlistSchema.extend({ joined_at: instant }))
        .max(100)
        .parse(data);
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
const candidatesSchema = z
  .array(z.object({ id: uuid, display_name: z.string() }))
  .max(50);
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
export const substitutionSchema = z.object({
  id: uuid,
  job_id: uuid,
  original_claim_id: uuid,
  target_user_id: uuid,
  target_name: z.string(),
  proposer_name: z.string(),
  reason: z.string(),
  quote_hash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum([
    "pending",
    "accepted",
    "declined",
    "withdrawn",
    "superseded",
    "expired",
  ]),
  expires_at: instant,
  created_at: instant,
  accepted_claim_id: uuid.nullable(),
  can_accept: z.boolean(),
  can_withdraw: z.boolean(),
  quote: z.object({
    title: z.string(),
    customer_name: z.string(),
    time_zone: z.string().refine(validZone),
    delivery_type: z.enum(["online", "onsite"]),
    location: z.string(),
    amount: z.number().nonnegative(),
    total_amount: z.number().nonnegative(),
    currency: z.enum(["EUR", "AUD"]),
    rate_unit: z.enum([
      "per_day",
      "per_hour",
      "per_teaching_unit",
      "fixed_total",
    ]),
    terms: z.string(),
    terms_version: z.number().int().positive(),
    requires_contract: z.boolean(),
    sessions: z
      .array(z.object({ starts_at: instant, ends_at: instant }))
      .min(1)
      .max(500),
  }),
});
export type Substitution = z.infer<typeof substitutionSchema>;
export const substitutionsKey = (actor: string, job?: string) =>
  ["job-substitutions", actor, job ?? "inbox"] as const;
export const substitutionsQuery = (actor: string, job?: string) =>
  queryOptions({
    queryKey: substitutionsKey(actor, job),
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("job_substitutions", { p_job_id: job ?? null })
        .abortSignal(signal);
      if (error) throw error;
      return z.array(substitutionSchema).max(100).parse(data);
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
  return z
    .object({ status: z.string(), claim_id: uuid.optional() })
    .parse(data);
}
