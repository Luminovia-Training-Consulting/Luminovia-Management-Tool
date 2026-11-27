/** Reconciliation keeps net, gross and recorded amounts within their source currency. */
import { z } from "zod";
import { currencyCodes } from "../../lib/currencies.ts";

const decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const optional = decimal.nullable();
const currency = z.enum(currencyCodes);
export const assignmentFinanceSchema = z.object({
  currency,
  claim_status: z.string(),
  agreed_lecturer: decimal,
  adjustment_lecturer: decimal,
  agreed_customer: optional,
  contract_margin: optional,
  approved_timesheet_minutes: z.number().int().nonnegative().nullable(),
  recorded_teaching_minutes: z.number().int().nonnegative().nullable(),
  delivered_minutes: z.number().int().nonnegative().nullable(),
  lecturer_invoices: z.array(
    z.object({
      id: z.uuid(),
      number: z.string(),
      state: z.string(),
      amount: decimal,
    }),
  ),
  lecturer_invoiced: optional,
  lecturer_paid: optional,
  lecturer_outstanding: optional,
  cancellation_compensation: optional,
  customer_invoice_id: z.uuid().nullable().optional(),
  customer_invoice_number: z.string().nullable(),
  customer_invoice_grouped: z.boolean().nullable(),
  customer_invoiced: optional,
  customer_net_invoiced: optional,
  customer_received: optional,
  customer_retained: optional,
  customer_outstanding: optional,
  expenses: z.array(
    z.object({
      currency,
      approved: decimal,
      paid: decimal,
      outstanding: decimal,
    }),
  ),
});

/** The export keeps each assignment and its already reconciled original-currency amounts intact. */
export const assignmentFinanceExportSchema = z.object({
  schema_version: z.literal(1),
  from: z.iso.date(),
  through: z.iso.date(),
  time_zone: z.string(),
  generated_at: z.iso.datetime({ offset: true }),
  assignments: z
    .array(
      z.object({
        claim_id: z.uuid(),
        job_id: z.uuid(),
        title: z.string(),
        lecturer_name: z.string(),
        customer_name: z.string(),
        finance: assignmentFinanceSchema,
      }),
    )
    .max(1000),
});
