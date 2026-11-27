/** Unfinished values and versioned receipts for both standalone and course-backed offers. */
import { z } from "zod";
import { validZone } from "../../lib/dates.ts";
import {
  courseOfferCurrencySchema,
  courseOfferRateUnitSchema,
} from "../operations/course-building-block-schema.ts";

export const offerInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000),
  customer_name: z.string().trim().min(1).max(200),
  organisation: z.union([z.uuid(), z.literal("")]),
  delivery_type: z.enum(["online", "onsite"]),
  location: z.string().max(500),
  time_zone: z.string().refine(validZone),
  amount: z.number().nonnegative().max(1000000),
  total_amount: z.number().nonnegative().max(1000000),
  currency: courseOfferCurrencySchema,
  rate_unit: courseOfferRateUnitSchema,
  terms: z.string().max(10000),
  publish: z.boolean(),
  requires_contract: z.boolean(),
  claim_deadline: z.string(),
  capacity: z.number().int().min(1).max(20),
  topic_ids: z.array(z.string()),
  sessions: z
    .array(
      z.object({
        starts_at: z.string().min(1),
        ends_at: z.string().min(1),
      }),
    )
    .min(1)
    .max(60),
});

export type OfferInput = z.infer<typeof offerInput>;
const offerDraftPreset = z.object({
  id: z.uuid(),
  name: z.string(),
  currency: courseOfferCurrencySchema,
  revision: z.number().int().positive(),
});

export const offerDraftSnapshot = z.object({
  values: offerInput.extend({
    title: z.string().max(200),
    description: z.string().max(12000),
    customer_name: z.string().max(200),
    amount: z.number().nullable(),
    total_amount: z.number().nullable(),
    capacity: z.number().nullable(),
    time_zone: z.string(),
    sessions: z
      .array(z.object({ starts_at: z.string(), ends_at: z.string() }))
      .max(60),
  }),
  commission: z.string(),
  internal_only: z.boolean(),
  preset: offerDraftPreset.nullable(),
  source_revision: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});

export const offerDraftReceipt = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  updated_at: z.iso.datetime({ offset: true }),
  title: z.string(),
  state: z.enum(["editing", "created", "discarded"]),
  job_id: z.uuid().nullable(),
  payload: offerDraftSnapshot.nullable(),
});
export const offerDraftIndex = z.array(offerDraftReceipt);
export type OfferDraft = z.infer<typeof offerDraftReceipt>;
export type OfferDraftSnapshot = z.infer<typeof offerDraftSnapshot>;
