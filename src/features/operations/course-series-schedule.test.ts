import { describe, expect, it } from "vitest";
import { courseSeriesSessions } from "./course-series-schedule";

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
