import { z } from "zod";
import {
  invoiceSeriesOptionsSchema,
  invoiceSeriesRecordSchema,
} from "./invoice-series-schema.ts";

const nonnegativeAmount = z.number().nonnegative();
const timestamp = z.iso.datetime({ offset: true });
const note = z.string().min(10).max(1000);

export const invoiceSeriesRepaymentSchema = z.strictObject({
  id: z.uuid(),
  amount: z.number().positive(),
  received_on: z.iso.date(),
  reference: z.string().min(3).max(200),
  recorded_at: timestamp,
  voided_at: timestamp.nullable(),
  void_note: note.nullable(),
});

export const invoiceSeriesCorrectionEntrySchema = z.strictObject({
  id: z.uuid(),
  claim_id: z.uuid(),
  title: z.string(),
  currency: z.enum(["EUR", "AUD"]),
  contract_version: z.int().positive(),
  reviewed_total: nonnegativeAmount,
  credited: z.number().positive(),
  balance: z.number().negative(),
  repaid: nonnegativeAmount,
  outstanding: nonnegativeAmount,
  due_on: z.iso.date(),
  note,
  proposed_at: timestamp,
  responded_at: timestamp.nullable(),
  dispute_note: note.nullable(),
  withdrawn_at: timestamp.nullable(),
  withdrawal_note: note.nullable(),
  state: z.enum([
    "proposed",
    "stale",
    "disputed",
    "acknowledged",
    "settled",
    "withdrawn",
  ]),
  credits: invoiceSeriesRecordSchema.shape.credits,
  repayments: z.array(invoiceSeriesRepaymentSchema),
});

export const invoiceSeriesCorrectionOptionsSchema = invoiceSeriesOptionsSchema
  .pick({
    claim_id: true,
    currency: true,
    ceiling: true,
    credited: true,
    contracts: true,
  })
  .extend({ can_propose: z.boolean() });

export const invoiceSeriesCorrectionsSchema = z.strictObject({
  options: invoiceSeriesCorrectionOptionsSchema.nullable(),
  entries: z.array(invoiceSeriesCorrectionEntrySchema),
});

export type InvoiceSeriesCorrection = z.infer<
  typeof invoiceSeriesCorrectionEntrySchema
>;
export type InvoiceSeriesCorrectionOptions = z.infer<
  typeof invoiceSeriesCorrectionOptionsSchema
>;
