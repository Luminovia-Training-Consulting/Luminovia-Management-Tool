import { expect, it } from "vitest";
import { coursePhase, scheduledCoursePhase } from "./course-phase";

const start = "2026-11-23T09:00:00+10:00";
const end = "2026-11-23T11:00:00+10:00";

it("switches status at the exact start and end instants", () => {
  expect(coursePhase(start, end, Date.parse(start) - 1)).toBe("upcoming");
  expect(coursePhase(start, end, Date.parse(start))).toBe("current");
  expect(coursePhase(start, end, Date.parse(end))).toBe("completed");
  expect(coursePhase(null, null, Date.parse(end))).toBe("unscheduled");
});

it("treats a multi-session course as ongoing between dated sessions", () => {
  const dates = [
    {
      starts_at: "2026-11-25T09:00:00+10:00",
      ends_at: "2026-11-25T11:00:00+10:00",
    },
    { starts_at: start, ends_at: end },
  ];
  expect(scheduledCoursePhase(dates, Date.parse("2026-11-24T00:00:00Z"))).toBe(
    "current",
  );
  expect(scheduledCoursePhase(dates, Date.parse("2026-11-25T03:00:00Z"))).toBe(
    "completed",
  );
  expect(scheduledCoursePhase([], Date.parse(end))).toBe("unscheduled");
});
