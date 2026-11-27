/** Canonical transport schemas for original-currency expense records. */
import { z } from "zod";
import { currencyCodes } from "../../lib/currencies.ts";

export const expenseStates = [
  "submitted",
  "correction",
  "approved",
  "rejected",
  "reimbursed",
] as const;
export const expenseCategories = [
  "travel",
  "parking",
  "accommodation",
  "meals",
  "materials",
  "other",
] as const;
const expenseState = z.enum(expenseStates);
const currency = z.enum(currencyCodes);
const money = z.string().regex(/^\d+(?:\.\d{1,2})?$/);
const uuid = z.uuid();
const date = z.iso.date();
const expense = z.object({
  id: uuid,
  claim_id: uuid,
  lecturer_id: uuid,
  lecturer_name: z.string().nullable(),
  customer_id: uuid.nullable(),
  customer_name: z.string().nullable(),
  course_id: uuid.nullable(),
  session_id: uuid.nullable(),
  session_starts_at: z.iso.datetime({ offset: true }).nullable(),
  state: expenseState,
  revision: z.number().int().positive(),
  category: z.enum(expenseCategories),
  spent_on: date,
  description: z.string(),
  currency,
  requested_amount: money,
  approved_amount: money.nullable(),
  receipt_version_id: uuid,
  receipt_name: z.string(),
  review_note: z.string(),
  invoice_id: uuid.nullable(),
  invoice_number: z.string().nullable(),
  invoice_state: z.string().nullable(),
  paid_on: date.nullable(),
  payment_reference: z.string().nullable(),
  title: z.string(),
});
export type Expense = z.infer<typeof expense>;

export const expenseReportSchema = z.object({
  items: z.array(expense).max(5000),
  totals: z.array(
    z.object({
      currency,
      submitted: money,
      approved: money,
      paid: money,
      outstanding: money,
    }),
  ),
});
export const expenseOptionsSchema = z.array(
  z.object({
    claim_id: uuid,
    title: z.string(),
    sessions: z.array(
      z.object({ id: uuid, starts_at: z.iso.datetime({ offset: true }) }),
    ),
  }),
);
export const expenseInvoicesSchema = z.array(
  z.object({ id: uuid, number: z.string() }),
);
export const expenseResultSchema = expense.pick({
  id: true,
  revision: true,
  state: true,
});
