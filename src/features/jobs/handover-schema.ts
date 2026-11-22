/** Wire schemas for the assignment waitlist and the direct substitution workflow. */
import { z } from "zod";
import { validZone } from "../../lib/dates.ts";

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });

export const waitlistSchema = z.object({
  job_id: uuid,
  title: z.string(),
  joined: z.boolean(),
  can_join: z.boolean(),
  available: z.boolean(),
});

export const ownWaitlistSchema = z
  .array(waitlistSchema.extend({ joined_at: instant }))
  .max(100);

export const candidatesSchema = z
  .array(z.object({ id: uuid, display_name: z.string() }))
  .max(50);

const substitutionSchema = z
  .object({
    id: uuid,
    job_id: uuid,
    original_claim_id: uuid,
    target_user_id: uuid,
    target_name: z.string(),
    proposer_name: z.string(),
    reason: z.string(),
    // Other lecturers may follow the handover without seeing the recipient's
    // private net quote or a fingerprint that could reveal it by guessing.
    quote_hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
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
      amount: z.number().nonnegative().nullable(),
      total_amount: z.number().nonnegative().nullable(),
      currency: z.enum(["EUR", "AUD"]).nullable(),
      rate_unit: z
        .enum(["per_day", "per_hour", "per_teaching_unit", "fixed_total"])
        .nullable(),
      terms: z.string().nullable(),
      terms_version: z.number().int().positive().nullable(),
      requires_contract: z.boolean(),
      sessions: z
        .array(z.object({ starts_at: instant, ends_at: instant }))
        .min(1)
        .max(500),
    }),
  })
  .refine(
    (offer) =>
      !offer.can_accept ||
      (offer.quote_hash !== null &&
        offer.quote.amount !== null &&
        offer.quote.total_amount !== null &&
        offer.quote.currency !== null &&
        offer.quote.rate_unit !== null &&
        offer.quote.terms !== null &&
        offer.quote.terms_version !== null),
    "An actionable recipient quote must contain its exact personal terms",
  );
export type Substitution = z.infer<typeof substitutionSchema>;

export const substitutionsSchema = z.array(substitutionSchema).max(100);

/** A business refusal is a JSON receipt, not a confirmed allocation. */
export const substitutionReceiptSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.enum(["confirmed", "cancelled"]),
    claim_id: uuid,
  }),
  z.object({
    status: z.enum([
      "declined",
      "withdrawn",
      "expired",
      "unavailable",
      "conflict",
      "not_eligible",
      "prerequisite_missing",
      "terms_changed",
      "financial_review",
      "idempotency_conflict",
    ]),
  }),
]);

/** Reviewed integration operations superseded by ordinary urgent job discovery. */
export const legacyHandoverOperations = [
  "replacement_marketplace",
  "replacement_assignments",
  "request_replacement",
  "claim_replacement",
  "cancel_replacement",
  "job_substitutions",
  "substitution_candidates",
  "propose_job_substitution",
  "respond_job_substitution",
] as const;
