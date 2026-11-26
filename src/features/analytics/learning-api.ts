import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { analyticsUntil, type AnalyticsPeriod } from "./period";
import {
  learningAnalyticsAccessSchema,
  learningAnalyticsReportSchema,
  type LearningAnalyticsAccess,
  type LearningReportStatus,
} from "./learning-schema";
import type { AnalyticsScope } from "./schema";

export function hasLearningAnalytics(
  access: LearningAnalyticsAccess | undefined,
) {
  return Boolean(
    access &&
    (access.personal ||
      access.staff ||
      access.organisations.some(({ company }) => company)),
  );
}

export const learningAnalyticsAccessQuery = (actor: string) =>
  queryOptions({
    queryKey: ["learning-analytics", actor, "access"],
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("learning_analytics_access")
        .abortSignal(signal);
      if (error) throw error;
      return learningAnalyticsAccessSchema.parse(data);
    },
    retry: false,
    gcTime: 0,
    refetchInterval: 30000,
  });

export const learningAnalyticsReportQuery = (
  actor: string,
  filters: {
    scope: AnalyticsScope;
    organisation: string | null;
    period: AnalyticsPeriod;
    status: LearningReportStatus;
    search: string;
    page: number;
  },
) =>
  queryOptions({
    queryKey: ["learning-analytics", actor, filters],
    queryFn: async ({ signal }) => {
      requireOnline();
      const until = analyticsUntil(filters.period);
      if (!until) throw new Error("invalid_learning_analytics_period");
      const { data, error } = await db()
        .rpc("learning_analytics_report", {
          p_scope: filters.scope,
          p_from: filters.period.from,
          p_until: until,
          p_organisation_id: filters.organisation,
          p_status: filters.status,
          p_search: filters.search,
          p_page: filters.page,
        })
        .abortSignal(signal);
      if (error) throw error;
      const report = learningAnalyticsReportSchema.parse(data);
      if (filters.scope === "company" && report.assessment)
        throw new Error("unexpected_company_assessment_report");
      return report;
    },
    retry: false,
    gcTime: 0,
    refetchInterval: 30000,
  });
