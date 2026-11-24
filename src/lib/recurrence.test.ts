import { describe, expect, it } from "vitest";
import { zonedInstant } from "./dates";
import { expandRecurrence, type RecurrenceRule } from "./recurrence";

const berlin = "Europe/Berlin";
const start = { starts_at: "2027-03-19T09:15", ends_at: "2027-03-19T11:30" };
const count = (value: number) => ({ type: "count" as const, count: value });
const starts = (rows: ReturnType<typeof expandRecurrence>) =>
  rows.map(({ starts_at }) => starts_at);

describe("finite appointment recurrence", () => {
  it("holds the local hour when weekly appointments span a daylight-saving change", () => {
    const rule = {
      frequency: "weekly",
      interval: 1,
      end: count(3),
    } satisfies RecurrenceRule;
    const rows = expandRecurrence(start, berlin, rule, 60);
    expect(starts(rows)).toEqual([
      "2027-03-19T09:15",
      "2027-03-26T09:15",
      "2027-04-02T09:15",
    ]);
    expect(rows.map((entry) => zonedInstant(entry.starts_at, berlin))).toEqual([
      "2027-03-19T08:15:00.000Z",
      "2027-03-26T08:15:00.000Z",
      "2027-04-02T07:15:00.000Z",
    ]);
  });

  it("supports selected weekdays every other ISO week without dropping the first appointment", () => {
    const rows = expandRecurrence(
      start,
      berlin,
      {
        frequency: "weekly",
        interval: 2,
        weekdays: [7, 1, 3, 7],
        end: { type: "until", date: "2027-04-04" },
      },
      60,
    );
    expect(starts(rows)).toEqual([
      "2027-03-19T09:15",
      "2027-03-21T09:15",
      "2027-03-29T09:15",
      "2027-03-31T09:15",
      "2027-04-04T09:15",
    ]);
  });

  it("skips months without the calendar day without changing later months", () => {
    const rows = expandRecurrence(
      { starts_at: "2027-01-31T09:00", ends_at: "2027-01-31T10:00" },
      berlin,
      { frequency: "monthly", interval: 1, end: count(3) },
      60,
    );
    expect(starts(rows)).toEqual([
      "2027-01-31T09:00",
      "2027-03-31T09:00",
      "2027-05-31T09:00",
    ]);
  });

  it("supports a monthly weekday position and an inclusive last date", () => {
    const rows = expandRecurrence(
      { starts_at: "2027-01-11T09:00", ends_at: "2027-01-11T10:00" },
      berlin,
      {
        frequency: "monthly",
        monthlyPattern: "weekday",
        interval: 1,
        end: { type: "until", date: "2027-03-08" },
      },
      60,
    );
    expect(starts(rows)).toEqual([
      "2027-01-11T09:00",
      "2027-02-08T09:00",
      "2027-03-08T09:00",
    ]);
  });

  it("supports a fifth weekday and skips months without it", () => {
    const rows = expandRecurrence(
      { starts_at: "2027-01-29T09:00", ends_at: "2027-01-29T10:00" },
      berlin,
      {
        frequency: "monthly",
        monthlyPattern: "weekday",
        interval: 1,
        end: count(2),
      },
      60,
    );
    expect(starts(rows)).toEqual(["2027-01-29T09:00", "2027-04-30T09:00"]);
  });

  it("keeps the original length in local calendar days for overnight dates", () => {
    const rows = expandRecurrence(
      { starts_at: "2027-04-01T22:00", ends_at: "2027-04-02T02:00" },
      berlin,
      { frequency: "daily", interval: 3, end: count(2) },
      60,
    );
    expect(rows[1]).toEqual({
      starts_at: "2027-04-04T22:00",
      ends_at: "2027-04-05T02:00",
    });
  });

  it("schedules the next leap day for an annual leap-day meeting", () => {
    const rows = expandRecurrence(
      { starts_at: "2028-02-29T09:00", ends_at: "2028-02-29T10:00" },
      berlin,
      { frequency: "yearly", interval: 1, end: count(2) },
      60,
    );
    expect(starts(rows)).toEqual(["2028-02-29T09:00", "2032-02-29T09:00"]);
  });

  it.each(["2027-03-21", "2027-10-24"])(
    "fails closed when %s leads to an invalid or ambiguous local appointment",
    (day) => {
      expect(() =>
        expandRecurrence(
          { starts_at: `${day}T02:30`, ends_at: `${day}T04:00` },
          berlin,
          { frequency: "weekly", interval: 1, end: count(2) },
          60,
        ),
      ).toThrow(/local-time/);
    },
  );

  it("reports oversized and malformed rules without returning a partial series", () => {
    const daily = {
      frequency: "daily",
      interval: 1,
      end: count(7),
    } satisfies RecurrenceRule;
    expect(() => expandRecurrence(start, berlin, daily, 6)).toThrow(/limit/);
    expect(() =>
      expandRecurrence(
        start,
        berlin,
        { ...daily, end: { type: "until", date: "2077-03-23" } },
        60,
      ),
    ).toThrow(/limit/);
    expect(() =>
      expandRecurrence(start, berlin, { ...daily, interval: 0 }, 60),
    ).toThrow(/rule/);
    expect(() =>
      expandRecurrence(
        start,
        berlin,
        { ...daily, frequency: "weekly", weekdays: [] },
        60,
      ),
    ).toThrow(/rule/);
    expect(() =>
      expandRecurrence(
        start,
        berlin,
        { ...daily, end: { type: "until", date: "2027-03-19" } },
        60,
      ),
    ).toThrow(/rule/);
    expect(() =>
      expandRecurrence({ ...start, ends_at: "" }, berlin, daily, 60),
    ).toThrow(/anchor/);
  });
});
