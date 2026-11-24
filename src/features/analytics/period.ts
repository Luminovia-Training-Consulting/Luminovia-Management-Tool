import { DateTime } from "luxon";

export type AnalyticsPeriod = { from: string; through: string };
export const analyticsPresets = [
  "around",
  "historyYear",
  "nextQuarter",
] as const;
export const staffAnalyticsPresets = ["yearToDate", "previousQuarter"] as const;
export type AnalyticsPreset =
  (typeof analyticsPresets)[number] | (typeof staffAnalyticsPresets)[number];

export function analyticsPreset(
  preset: AnalyticsPreset,
  now: DateTime,
): AnalyticsPeriod {
  const month = now.startOf("month");
  const quarter = now.startOf("quarter");
  const ranges = {
    around: [
      month.minus({ months: 5 }),
      month.plus({ months: 7 }).minus({ days: 1 }),
    ],
    historyYear: [month.minus({ months: 11 }), now],
    nextQuarter: [now, now.plus({ days: 89 })],
    yearToDate: [now.startOf("year"), now],
    previousQuarter: [
      quarter.minus({ quarters: 1 }),
      quarter.minus({ days: 1 }),
    ],
  };
  const [from, through] = ranges[preset];
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
