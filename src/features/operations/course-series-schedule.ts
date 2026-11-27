import { resolveScheduleWindow } from "../../lib/dates";
import { teachingSchedule } from "./schedule";
import type { SeriesRun } from "./course-series-schema";

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
  if (
    input.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
  )
    return null;
  const defaults = { start: input.start, end: input.end };
  try {
    const local = teachingSchedule({
      kind: "count",
      firstDay: input.firstDay,
      days: input.days,
      defaults,
      weekdays: Object.fromEntries(
        input.weekdays.map((day) => [day, [defaults]]),
      ),
      excludedDates: input.excludedDates,
    });
    const sessions = local.map((slot) =>
      resolveScheduleWindow({ ...slot, time_zone: input.zone }),
    );
    return sessions.every((slot): slot is NonNullable<typeof slot> =>
      Boolean(slot && Date.parse(slot.starts_at) > now),
    )
      ? sessions
      : null;
  } catch {
    return null;
  }
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
