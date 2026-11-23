import { currencyCodes } from "../../lib/currencies.ts";
import { z } from "zod";
import { invoiceExceptionOptionsSchema } from "./invoice-exception-schema.ts";

const amount = z.number().nonnegative();
export const invoiceSeriesKindSchema = z.enum(["interim", "final"]);
const invoiceSeriesCreditSchema = z.strictObject({
  payment_id: z.uuid(),
  invoice_id: z.uuid(),
  invoice_number: z.string(),
  amount: z.number().positive(),
  paid_at: z.iso.datetime({ offset: true }),
});

export const invoiceSeriesRecordSchema = z.strictObject({
  id: z.uuid(),
  claim_id: z.uuid(),
  title: z.string(),
  currency: z.enum(currencyCodes),
  kind: invoiceSeriesKindSchema,
  contract_version: z.int().positive(),
  gross_amount: z.number().positive(),
  credit_amount: amount,
  amount,
  due_on: z.iso.date(),
  approved_at: z.iso.datetime({ offset: true }),
  note: z.string().min(10).max(1000),
  state: z.enum(["ready", "stale", "submitted", "approved", "paid", "revoked"]),
  invoice_id: z.uuid().nullable(),
  invoice_number: z.string().nullable(),
  credits: z.array(invoiceSeriesCreditSchema),
});

export const invoiceSeriesRecordsSchema = z.array(invoiceSeriesRecordSchema);
export const invoiceSeriesOptionsSchema = z.strictObject({
  claim_id: z.uuid(),
  currency: z.enum(currencyCodes),
  ceiling: amount,
  credited: amount,
  contracts: invoiceExceptionOptionsSchema.shape.contracts,
  can_interim: z.boolean(),
  can_final: z.boolean(),
  approvals: invoiceSeriesRecordsSchema,
});

export type InvoiceSeriesRecord = z.infer<typeof invoiceSeriesRecordSchema>;
