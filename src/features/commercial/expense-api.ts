/** Read and mutate actor-scoped expenses through the original-currency finance authority. */
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { currencyCodes } from "../../lib/currencies";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";

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

const report = z.object({
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
const options = z.array(
  z.object({
    claim_id: uuid,
    title: z.string(),
    sessions: z.array(
      z.object({ id: uuid, starts_at: z.iso.datetime({ offset: true }) }),
    ),
  }),
);
const invoices = z.array(z.object({ id: uuid, number: z.string() }));
const result = expense.pick({ id: true, revision: true, state: true });

export type ExpenseReportFilters = {
  p_from: string;
  p_through: string;
  p_state: (typeof expenseStates)[number] | null;
  p_currency: (typeof currencyCodes)[number] | null;
  p_lecturer: string | null;
  p_customer: string | null;
  p_course: string | null;
  p_assignment: string | null;
};
export const expenseKey = (actor: string) =>
  ["lecturer-expenses", actor] as const;

export const expenseReportQuery = (
  actor: string,
  staff: boolean,
  filters: ExpenseReportFilters,
) =>
  queryOptions({
    queryKey: [...expenseKey(actor), "report", staff, filters] as const,
    queryFn: async ({ signal }) => {
      // PostgREST GET serializes null as literal text; omit optional filters.
      const present = Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value !== null),
      );
      const { data, error } = await db()
        .rpc(
          "lecturer_expense_report",
          { p_staff: staff, ...present },
          { get: true },
        )
        .abortSignal(signal);
      if (error) throw error;
      return report.parse(data);
    },
  });

export const expenseOptionsQuery = (actor: string) =>
  queryOptions({
    queryKey: [...expenseKey(actor), "options"] as const,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("lecturer_expense_options", {}, { get: true })
        .abortSignal(signal);
      if (error) throw error;
      return options.parse(data);
    },
  });

export const expenseInvoicesQuery = (actor: string, expenseId: string) =>
  queryOptions({
    queryKey: [...expenseKey(actor), "invoices", expenseId] as const,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc(
          "lecturer_expense_invoices",
          { p_expense_id: expenseId },
          { get: true },
        )
        .abortSignal(signal);
      if (error) throw error;
      return invoices.parse(data);
    },
  });

export type ExpenseAction =
  | "submit"
  | "resubmit"
  | "correction"
  | "rejected"
  | "approve"
  | "link"
  | "reimburse";

export async function saveExpense(
  action: ExpenseAction,
  original: Expense | null,
  payload: Record<string, string | null>,
  requestId: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("lecturer_expense_action", {
    p_action: action,
    p_expense_id: original?.id ?? null,
    p_expected_revision: original?.revision ?? 0,
    p_payload: payload,
    p_request_id: requestId,
  });
  if (error) throw error;
  return result.parse(data);
}
