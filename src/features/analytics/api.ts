import { queryOptions } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { db } from "../../lib/supabase";
import {
  analyticsAccessSchema,
  analyticsReportSchema,
  type AnalyticsScope,
} from "./schema";

export type AnalyticsPeriod = { from: string; through: string };
export type AnalyticsPreset = "around" | "historyYear" | "nextQuarter";

export function analyticsPreset(
  preset: AnalyticsPreset,
  now: DateTime,
): AnalyticsPeriod {
  const month = now.startOf("month");
  const from =
    preset === "historyYear"
      ? month.minus({ months: 11 })
      : preset === "nextQuarter"
        ? now
        : month.minus({ months: 5 });
  const through =
    preset === "historyYear"
      ? now
      : preset === "nextQuarter"
        ? now.plus({ days: 89 })
        : month.plus({ months: 7 }).minus({ days: 1 });
  return { from: from.toISODate() ?? "", through: through.toISODate() ?? "" };
}

/** Convert the inclusive date shown in the filter to the API's exclusive bound. */
export function analyticsUntil(period: AnalyticsPeriod) {
  const from = DateTime.fromISO(period.from, { zone: "UTC" });
  const through = DateTime.fromISO(period.through, { zone: "UTC" });
  if (
    from.toISODate() !== period.from ||
    through.toISODate() !== period.through ||
    period.from < "1900-01-01" ||
    period.through >= "2200-01-01" ||
    through < from ||
    through.diff(from, "days").days >= 731
  )
    return null;
  return through.plus({ days: 1 }).toISODate();
}

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
