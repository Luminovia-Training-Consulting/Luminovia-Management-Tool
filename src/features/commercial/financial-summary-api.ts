/** Minimal actor-scoped original-currency totals for the dashboard. */
import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { dashboardFinancialSummarySchema } from "./financial-summary-schema";

/** Reload on dashboard return after changes in a separate course or finance route. */
export const dashboardFinancialSummaryQuery = (actor: string) =>
  queryOptions({
    queryKey: ["dashboard-financial-summary", actor],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("dashboard_financial_summary")
        .abortSignal(signal);
      if (error) throw error;
      return dashboardFinancialSummarySchema.parse(data);
    },
    refetchOnMount: "always",
    staleTime: 1000,
  });
