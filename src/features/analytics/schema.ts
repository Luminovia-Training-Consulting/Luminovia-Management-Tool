import { z } from "zod";

export const analyticsScopes = ["personal", "company", "staff"] as const;
export type AnalyticsScope = (typeof analyticsScopes)[number];

export const analyticsAccessSchema = z.object({
  personal: z.boolean(),
  staff: z.boolean(),
  time_zone: z.string().nullable(),
  organisations: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      time_zone: z.string(),
      company: z.boolean(),
    }),
  ),
});

const timelineMoneySchema = z.object({
  past_net: z.number().nullable(),
  future_net: z.number().nullable(),
  past_gross: z.number().nullable(),
  future_gross: z.number().nullable(),
  missing_gross: z.number().int().nonnegative().nullable(),
  lecturer_cash: z.number().nullable(),
  customer_cash: z.number().nullable(),
});

export const analyticsReportSchema = z.object({
  time_zone: z.string(),
  can_model_pipeline: z.boolean(),
  months: z
    .array(
      z.object({
        month: z.iso.date(),
        history: z.boolean(),
        forecast: z.boolean(),
        past_assignments: z.number().int().nonnegative(),
        future_assignments: z.number().int().nonnegative(),
        past_minutes: z.number().nonnegative(),
        future_minutes: z.number().nonnegative(),
        open_positions: z.number().int().nonnegative().nullable(),
        currencies: z.object({
          EUR: timelineMoneySchema,
          AUD: timelineMoneySchema,
          USD: timelineMoneySchema.optional(),
        }),
      }),
    )
    .min(1)
    .max(26),
});

export type AnalyticsAccess = z.infer<typeof analyticsAccessSchema>;
export type AnalyticsReport = z.infer<typeof analyticsReportSchema>;
export type AnalyticsCurrency =
  keyof AnalyticsReport["months"][number]["currencies"];
