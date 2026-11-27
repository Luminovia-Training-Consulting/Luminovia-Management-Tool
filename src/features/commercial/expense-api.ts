/** Read and mutate actor-scoped expenses through the original-currency finance authority. */
import { queryOptions } from "@tanstack/react-query";
import type { currencyCodes } from "../../lib/currencies";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";

import {
  expenseReportSchema,
  expenseOptionsSchema,
  expenseInvoicesSchema,
  expenseResultSchema,
  type Expense,
  expenseStates,
} from "./expense-schema";
export {
  expenseCategories,
  expenseStates,
  type Expense,
} from "./expense-schema";

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
      const { data, error } = await db()
        .rpc(
          "lecturer_expense_report",
          {
            p_staff: staff,
            p_from: filters.p_from,
            p_through: filters.p_through,
            p_state: filters.p_state ?? undefined,
            p_currency: filters.p_currency ?? undefined,
            p_assignment: filters.p_assignment ?? undefined,
            p_lecturer: filters.p_lecturer ?? undefined,
            p_customer: filters.p_customer ?? undefined,
            p_course: filters.p_course ?? undefined,
          },
          { get: true },
        )
        .abortSignal(signal);
      if (error) throw error;
      return expenseReportSchema.parse(data);
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
      return expenseOptionsSchema.parse(data);
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
      return expenseInvoicesSchema.parse(data);
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
  return expenseResultSchema.parse(data);
}
