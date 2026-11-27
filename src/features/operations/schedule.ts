/** Generate local teaching windows before resolving their instants in the intended course time zone. */
import { DateTime } from "luxon";

export const maxScheduleSessions = 60;
export const teachingWeekdays = [1, 2, 3, 4, 5, 6, 7] as const;
export type TeachingWeekday = (typeof teachingWeekdays)[number];
export type TeachingWindow = { start: string; end: string };
export type LocalTeachingSession = { starts_at: string; ends_at: string };

const isoDay = /^\d{4}-\d{2}-\d{2}$/;
const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function calendarDate(value: string) {
  const parsed = DateTime.fromISO(value, { zone: "UTC" });
  if (!isoDay.test(value) || !parsed.isValid)
    throw new Error("invalid_schedule");
  return parsed;
}

/** Read a short, explicit list of inclusions or exclusions without guessing a holiday region. */
export function scheduleDates(input: string) {
  const dates = [...new Set(input.split(/[\s,;]+/).filter(Boolean))];
  if (dates.length > maxScheduleSessions) throw new Error("invalid_schedule");
  return dates.map(calendarDate);
}

type TeachingSchedule = {
  weekdays: Partial<Record<TeachingWeekday, readonly TeachingWindow[]>>;
  defaults: TeachingWindow;
  excludedDates?: string;
} & (
  | { kind: "count"; firstDay: string; days: number; everyWeeks?: number }
  | { kind: "range"; firstDay: string; lastDay: string; everyWeeks?: number }
  | { kind: "dates"; dates: string }
);

/** Expand a bounded schedule into ordered non-overlapping local minute windows for review. */
export function teachingSchedule(
  plan: TeachingSchedule,
): LocalTeachingSession[] {
  const excluded = new Set(
    scheduleDates(plan.excludedDates ?? "").map((date) => date.toISODate()),
  );
  const windows = new Map<number, TeachingWindow[]>(
    teachingWeekdays.map((weekday) => {
      const slots = [...(plan.weekdays[weekday] ?? [])].sort((a, b) =>
        a.start.localeCompare(b.start),
      );
      if (
        slots.some(
          ({ start, end }, index) =>
            !clock.test(start) ||
            !clock.test(end) ||
            start >= end ||
            (index > 0 && slots[index - 1].end > start),
        )
      )
        throw new Error("invalid_schedule");
      return [weekday, slots];
    }),
  );
  const sessions: LocalTeachingSession[] = [];

  // A count refers to teaching dates, not the number of windows on one date.
  function add(date: DateTime, selected: boolean) {
    const day = date.toISODate()!;
    if (excluded.has(day)) return false;
    const slots = windows.get(date.weekday)!;
    const effective = selected && slots.length === 0 ? [plan.defaults] : slots;
    for (const { start, end } of effective) {
      if (
        sessions.length === maxScheduleSessions ||
        !clock.test(start) ||
        !clock.test(end) ||
        start >= end
      )
        throw new Error("invalid_schedule");
      sessions.push({ starts_at: `${day}T${start}`, ends_at: `${day}T${end}` });
    }
    return effective.length > 0;
  }

  if (plan.kind === "dates") {
    for (const date of scheduleDates(plan.dates).sort(
      (a, b) => a.toMillis() - b.toMillis(),
    )) {
      add(date, true);
    }
  } else {
    const first = calendarDate(plan.firstDay);
    const last = plan.kind === "range" ? calendarDate(plan.lastDay) : null;
    const every = plan.everyWeeks ?? 1;
    const days = plan.kind === "count" ? plan.days : null;
    if (
      (last && (last < first || last.diff(first, "days").days > 1460)) ||
      (days !== null &&
        (!Number.isInteger(days) || days < 1 || days > maxScheduleSessions)) ||
      !Number.isInteger(every) ||
      every < 1 ||
      every > 4 ||
      ![...windows.values()].some((slots) => slots.length > 0)
    )
      throw new Error("invalid_schedule");
    const anchor = first.startOf("week");
    let count = 0;
    // Four weeks between dates, 60 dates and up to 60 exclusions fit within ten years.
    for (let offset = 0; offset < 3660; offset++) {
      const date = first.plus({ days: offset });
      if (last && date > last) break;
      if (
        Math.floor(date.diff(anchor, "weeks").weeks) % every === 0 &&
        add(date, false)
      )
        count++;
      if (count === days) break;
    }
  }
  if (sessions.length === 0) throw new Error("invalid_schedule");
  return sessions;
}
