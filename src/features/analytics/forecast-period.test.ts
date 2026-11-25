/** Protect forecast calendar boundaries while keeping ordinary finance periods bounded. */
import { DateTime } from "luxon";
import { expect, it } from "vitest";
import { forecastPeriod } from "./period";
import {
  financePeriodSchema,
  forecastPeriodSchema,
} from "../workbench/finance-api";

const now = DateTime.fromISO("2026-11-25T14:02:00", {
  zone: "Europe/Berlin",
});

it("selects a full calendar year and the next actual calendar quarter", () => {
  expect(forecastPeriod("year", 2027, now)).toEqual({
    from: "2027-01-01",
    until: "2028-01-01",
  });
  expect(forecastPeriod("quarter", 2027, now)).toEqual({
    from: "2027-01-01",
    until: "2027-04-01",
  });
});

it("allows a leap-year forecast without widening the ordinary finance period", () => {
  const leapYear = forecastPeriod("year", 2028, now);
  expect(forecastPeriodSchema.safeParse(leapYear).success).toBe(true);
  expect(financePeriodSchema.safeParse(leapYear).success).toBe(false);
  expect(
    financePeriodSchema.safeParse({ from: "2027-01-01", until: "2027-04-04" })
      .success,
  ).toBe(true);
});
