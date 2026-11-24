import { DateTime } from "luxon";
import { resolveScheduleWindow } from "../../lib/dates";
import type { SeriesRun } from "./course-series-schema";

function localDate(value: string) {
  const date = DateTime.fromISO(value, { zone: "UTC" });
  return date.isValid && /^\d{4}-\d{2}-\d{2}$/.test(value) ? date : null;
}

/** Suggest exact future sessions from wall-clock dates in the selected course zone. */
export function courseSeriesSessions(
  input: {
    firstDay: string;
    days: number;
    start: string;
    end: string;
    weekdays: number[];
    excludedDates: string;
    zone: string;
  },
  now = Date.now(),
): SeriesRun["sessions"] | null {
  const date = localDate(input.firstDay);
  const excluded = new Set(
    input.excludedDates.split(/[\s,;]+/).filter(Boolean),
  );
  if (
    !date ||
    !Number.isInteger(input.days) ||
    input.days < 1 ||
    input.days > 60 ||
    input.weekdays.length === 0 ||
    input.weekdays.some(
      (day) => !Number.isInteger(day) || day < 1 || day > 7,
    ) ||
    excluded.size > 60 ||
    [...excluded].some((day) => !localDate(day))
  )
    return null;
  const sessions: SeriesRun["sessions"] = [];
  let current = date;
  while (sessions.length < input.days) {
    const day = current.toISODate()!;
    if (input.weekdays.includes(current.weekday) && !excluded.has(day)) {
      const slot = resolveScheduleWindow({
        starts_at: `${day}T${input.start}`,
        ends_at: `${day}T${input.end}`,
        time_zone: input.zone,
      });
      if (!slot || Date.parse(slot.starts_at) <= now) return null;
      sessions.push(slot);
    }
    current = current.plus({ days: 1 });
  }
  return sessions;
}
