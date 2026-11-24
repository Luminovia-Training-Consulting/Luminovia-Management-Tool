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

/** Count planning demand for reviewed sessions with one instructor per run. */
export function courseSeriesWorkload(
  runs: readonly Pick<SeriesRun, "sessions">[],
) {
  const events: { at: number; count: number }[] = [];
  const workloads = runs.map(({ sessions }) => ({
    sessions: sessions.length,
    hours: sessions.reduce((hours, session) => {
      const start = Date.parse(session.starts_at);
      const end = Date.parse(session.ends_at);
      events.push({ at: start, count: 1 }, { at: end, count: -1 });
      return hours + (end - start) / 3_600_000;
    }, 0),
  }));
  // An instructor finishing at the exact start time can cover the next slot.
  events.sort((a, b) => a.at - b.at || a.count - b.count);
  let active = 0;
  let simultaneous = 0;
  for (const { count } of events) {
    active += count;
    simultaneous = Math.max(simultaneous, active);
  }
  return {
    runs: workloads,
    sessions: workloads.reduce((count, run) => count + run.sessions, 0),
    hours: workloads.reduce((hours, run) => hours + run.hours, 0),
    simultaneous,
  };
}
