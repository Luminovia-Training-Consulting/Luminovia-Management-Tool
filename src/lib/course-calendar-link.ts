/** Carries only the chosen wall-clock range and display zone into the course draft. */
import { validZone } from "./dates";

type CalendarCourseSchedule = {
  starts_at: string;
  ends_at: string;
  time_zone: string;
};

export function calendarCourseHref(schedule: CalendarCourseSchedule) {
  return `/courses?${new URLSearchParams({
    creator: "new",
    planFrom: schedule.starts_at,
    planUntil: schedule.ends_at,
    planZone: schedule.time_zone,
  })}`;
}

/** The URL is a form prefill. Course permission and interval validation still govern writes. */
export function calendarCourseSchedule(
  starts_at: string | null,
  ends_at: string | null,
  time_zone: string | null,
): CalendarCourseSchedule | undefined {
  const minute = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  return starts_at &&
    ends_at &&
    time_zone &&
    minute.test(starts_at) &&
    minute.test(ends_at) &&
    validZone(time_zone)
    ? { starts_at, ends_at, time_zone }
    : undefined;
}
