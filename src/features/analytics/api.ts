import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import {
  analyticsAccessSchema,
  analyticsReportSchema,
  type AnalyticsScope,
} from "./schema";

import { analyticsUntil, type AnalyticsPeriod } from "./period";

export const analyticsAccessQuery = (actor: string) =>
  queryOptions({
    queryKey: ["analytics", actor, "access"],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("analytics_access")
        .abortSignal(signal);
      if (error) throw error;
      return analyticsAccessSchema.parse(data);
    },
    retry: false,
    refetchInterval: 30000,
  });

export const analyticsReportQuery = (
  actor: string,
  scope: AnalyticsScope,
  organisation: string | null,
  period: AnalyticsPeriod,
) => {
  const until = analyticsUntil(period);
  return queryOptions({
    queryKey: ["analytics", actor, scope, organisation, period],
    enabled: Boolean(until && (scope !== "company" || organisation)),
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("analytics_report", {
          p_scope: scope,
          p_from: period.from,
          p_until: until,
          p_organisation_id: organisation,
        })
        .abortSignal(signal);
      if (error) throw error;
      return analyticsReportSchema.parse(data);
    },
    retry: false,
    refetchInterval: 30000,
  });
};
