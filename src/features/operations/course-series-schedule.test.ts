import { describe, expect, it } from "vitest";
import {
  courseSeriesSessions,
  courseSeriesWorkload,
} from "./course-series-schedule";

const input = {
  firstDay: "2027-03-26",
  days: 3,
  start: "09:00",
  end: "17:00",
  weekdays: [1, 2, 3, 4, 5],
  excludedDates: "2027-03-29\n2027-03-31",
  zone: "Europe/Berlin",
};
const now = Date.parse("2027-03-01T00:00:00Z");

describe("course series exact schedule", () => {
  it("skips excluded dates and weekends while preserving local times across daylight saving", () => {
    expect(courseSeriesSessions(input, now)).toEqual([
      {
        starts_at: "2027-03-26T08:00:00.000Z",
        ends_at: "2027-03-26T16:00:00.000Z",
      },
      {
        starts_at: "2027-03-30T07:00:00.000Z",
        ends_at: "2027-03-30T15:00:00.000Z",
      },
      {
        starts_at: "2027-04-01T07:00:00.000Z",
        ends_at: "2027-04-01T15:00:00.000Z",
      },
    ]);
  });

  it.each([
    { firstDay: "2027-03-28", days: 1, weekdays: [7], start: "02:30" },
    { firstDay: "2027-10-31", days: 1, weekdays: [7], start: "02:30" },
    { firstDay: "2027-02-20" },
    { firstDay: "2027-02-30" },
    { start: "17:00" },
    { days: 61 },
    { weekdays: [] },
    { excludedDates: "tomorrow" },
    { zone: "Not/A_Zone" },
  ])("rejects an invalid schedule: %j", (changes) => {
    expect(courseSeriesSessions({ ...input, ...changes }, now)).toBeNull();
  });
});

describe("course series teaching workload", () => {
  it("counts parallel demand at the peak and lets adjoining time slots share coverage", () => {
    const run = (starts_at: string, ends_at: string) => ({
      sessions: [{ starts_at, ends_at }],
    });
    expect(
      courseSeriesWorkload([
        run("2027-03-26T08:00:00Z", "2027-03-26T10:00:00Z"),
        run("2027-03-26T09:00:00Z", "2027-03-26T10:30:00Z"),
        run("2027-03-26T11:00:00+01:00", "2027-03-26T12:00:00+01:00"),
      ]),
    ).toEqual({
      runs: [
        { sessions: 1, hours: 2 },
        { sessions: 1, hours: 1.5 },
        { sessions: 1, hours: 1 },
      ],
      sessions: 3,
      hours: 4.5,
      simultaneous: 2,
    });
  });

  it("calculates elapsed hours for a session across daylight saving time", () => {
    const sessions = courseSeriesSessions(
      {
        ...input,
        firstDay: "2027-03-28",
        weekdays: [7],
        days: 1,
        start: "01:00",
        end: "04:00",
      },
      now,
    )!;
    expect(courseSeriesWorkload([{ sessions }])).toEqual({
      runs: [{ sessions: 1, hours: 2 }],
      sessions: 1,
      hours: 2,
      simultaneous: 1,
    });
  });
});
