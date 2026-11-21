/** Scoped finance forecast and operations queries, with bounded period validation. */
import { queryOptions } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { controlSchema, forecastSchema } from "./finance-schema";
export type { ControlCenter } from "./finance-schema";

export const financePeriodSchema = z
  .object({ from: z.string(), until: z.string() })
  .refine((value) => {
    const from = DateTime.fromISO(value.from, { zone: "UTC" }),
      until = DateTime.fromISO(value.until, { zone: "UTC" });
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(value.from) &&
      /^\d{4}-\d{2}-\d{2}$/.test(value.until) &&
      from.isValid &&
      until.isValid &&
      until > from &&
      until.diff(from, "days").days <= 93
    );
  });
export type FinancePeriod = z.infer<typeof financePeriodSchema>;
export const forecastQuery = (
  actor: string,
  period: FinancePeriod,
  probability: number,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: ["finance-forecast", actor, period, probability],
    enabled,
    queryFn: async ({ signal }) => {
      financePeriodSchema.parse(period);
      const { data, error } = await db()
        .rpc("finance_forecast", {
          p_from: period.from,
          p_until: period.until,
          p_pipeline_probability: probability,
        })
        .abortSignal(signal);
      if (error) throw error;
      return forecastSchema.parse(data);
    },
    staleTime: 15000,
    retry: false,
  });
export const controlCenterQuery = (
  actor: string,
  period: FinancePeriod,
  enabled: boolean,
) =>
  queryOptions({
    queryKey: ["control-center", actor, period],
    enabled,
    queryFn: async ({ signal }) => {
      financePeriodSchema.parse(period);
      const { data, error } = await db()
        .rpc("control_center", { p_from: period.from, p_until: period.until })
        .abortSignal(signal);
      if (error) throw error;
      return controlSchema.parse(data);
    },
    staleTime: 15000,
    retry: false,
  });
