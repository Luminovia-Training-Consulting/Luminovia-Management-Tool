/**
 * Regressions for weekday generation and invalid date/time/day-count input. Pure calendar
 * arithmetic does not replace session/claim database acceptance.
 */
import { describe, expect, it } from "vitest";
import { teachingSchedule } from "./schedule";

function weekdaySessions(
  firstDay: string,
  start: string,
  end: string,
  days: number,
) {
  const defaults = { start, end };
  return teachingSchedule({
    kind: "count",
    firstDay,
    days,
    defaults,
    weekdays: Object.fromEntries(
      [1, 2, 3, 4, 5].map((day) => [day, [defaults]]),
    ),
  });
}
import { zonedInstant } from "../../lib/dates";

describe("Course weekday planning", () => {
  it("generates the complete ten-day block across weekends without changing local daily times", () => {
    const sessions = weekdaySessions("2027-03-26", "09:00", "17:00", 10);
    expect(sessions).toHaveLength(10);
    expect(sessions[0]).toEqual({
      starts_at: "2027-03-26T09:00",
      ends_at: "2027-03-26T17:00",
    });
    expect(sessions[1]).toEqual({
      starts_at: "2027-03-29T09:00",
      ends_at: "2027-03-29T17:00",
    });
    expect(zonedInstant(sessions[0].starts_at, "Europe/Berlin")).toBe(
      "2027-03-26T08:00:00.000Z",
    );
    expect(zonedInstant(sessions[1].starts_at, "Europe/Berlin")).toBe(
      "2027-03-29T07:00:00.000Z",
    );
    expect(new Set(sessions.map((session) => session.starts_at)).size).toBe(10);
  });
  it("moves an explicit weekend start to Monday but leaves holiday review to the planner", () => {
    expect(
      weekdaySessions("2027-03-27", "08:30", "14:30", 1)[0].starts_at,
    ).toBe("2027-03-29T08:30");
    expect(
      weekdaySessions("2026-12-24", "09:00", "15:00", 2)[1].starts_at,
    ).toBe("2026-12-25T09:00");
  });
  it("rejects invalid calendar dates, reversed times and unbounded block lengths", () => {
    const invalid: Parameters<typeof weekdaySessions>[] = [
      ["2027-02-30", "09:00", "17:00", 10],
      ["2027-03-26T09:00", "09:00", "17:00", 10],
      ["2027-03-26", "25:00", "17:00", 10],
      ["2027-03-26", "09:00", "08:00", 10],
      ["2027-03-26", "09:00", "09:00", 10],
      ["2027-03-26", "09:00", "17:00", 0],
      ["2027-03-26", "09:00", "17:00", 61],
      ["2027-03-26", "09:00", "17:00", 1.5],
    ];
    for (const args of invalid)
      expect(() => weekdaySessions(...args)).toThrow("invalid_schedule");
  });
});

it("generates selected ranges, weekend blocks and multiple windows per day", () => {
  const defaults = { start: "09:00", end: "10:00" };
  const weekdays = {
    1: [defaults, { start: "13:00", end: "14:00" }],
    6: [{ start: "12:00", end: "16:00" }],
  };
  const range = teachingSchedule({
    kind: "range",
    firstDay: "2030-04-01",
    lastDay: "2030-04-20",
    everyWeeks: 2,
    weekdays,
    defaults,
    excludedDates: "2030-04-06",
  });
  expect(range.map((row) => row.starts_at)).toEqual([
    "2030-04-01T09:00",
    "2030-04-01T13:00",
    "2030-04-15T09:00",
    "2030-04-15T13:00",
    "2030-04-20T12:00",
  ]);
  expect(
    teachingSchedule({
      kind: "dates",
      dates: "2030-04-07 2030-04-06 2030-04-07",
      weekdays,
      defaults,
      excludedDates: "2030-04-06",
    }),
  ).toEqual([{ starts_at: "2030-04-07T09:00", ends_at: "2030-04-07T10:00" }]);
  expect(() =>
    teachingSchedule({
      kind: "count",
      days: 1,
      firstDay: "2030-04-01",
      defaults,
      weekdays: { 1: [defaults, { start: "09:30", end: "11:00" }] },
    }),
  ).toThrow("invalid_schedule");
});

describe("schedule expansion limits", () => {
  const defaults = { start: "09:00", end: "10:00" };
  const dates = {
    kind: "dates" as const,
    dates: "2027-01-18",
    weekdays: {},
    defaults,
  };
  const range = {
    kind: "range" as const,
    firstDay: "2027-01-18",
    lastDay: "2027-01-25",
    weekdays: { 1: [defaults] },
    defaults,
  };

  it.each([
    { ...dates, dates: "" },
    { ...dates, excludedDates: dates.dates },
    { ...dates, defaults: { ...defaults, start: "25:00" } },
    { ...dates, defaults: { ...defaults, end: "25:00" } },
    { ...dates, defaults: { ...defaults, end: "08:00" } },
    {
      ...dates,
      dates: Array.from({ length: 61 }, (_, index) => `date-${index}`).join(
        " ",
      ),
    },
    { ...range, lastDay: "2027-01-17" },
    { ...range, lastDay: "2032-01-18" },
    { ...range, lastDay: "2029-01-18" },
    { ...range, everyWeeks: 0 },
    { ...range, everyWeeks: 5 },
    { ...range, everyWeeks: 1.5 },
    { ...range, weekdays: {} },
    { ...range, weekdays: { 1: [{ ...defaults, end: "25:00" }] } },
  ])("rejects an invalid schedule %#", (plan) => {
    expect(() => teachingSchedule(plan)).toThrow("invalid_schedule");
  });
});
