import { DateTime } from "luxon";
import { zonedInstant } from "./dates";

export type LocalScheduleEntry = { starts_at: string; ends_at: string };

export type RecurrenceRule = {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  weekdays?: number[];
  monthlyPattern?: "day-of-month" | "weekday";
  end: { type: "count"; count: number } | { type: "until"; date: string };
};

export class RecurrenceError extends Error {
  constructor(
    readonly reason: "anchor" | "rule" | "limit" | "local-time",
    readonly localTime?: string,
  ) {
    super(reason);
  }
}

const minuteFormat = "yyyy-MM-dd'T'HH:mm";

function parseLocal(value: string, format: string) {
  // UTC is only the arithmetic frame for these wall-clock values.
  const date = DateTime.fromFormat(value, format, { zone: "UTC" });
  return date.isValid && date.year >= 1 && date.toFormat(format) === value
    ? date
    : null;
}

/** Expand and validate a finite series without changing its local start/end times. */
export function expandRecurrence(
  anchor: LocalScheduleEntry,
  zone: string,
  rule: RecurrenceRule,
  max: number,
): LocalScheduleEntry[] {
  const start = parseLocal(anchor.starts_at, minuteFormat);
  const end = parseLocal(anchor.ends_at, minuteFormat);
  if (!start || !end || end.toMillis() <= start.toMillis())
    throw new RecurrenceError("anchor");
  const count = rule.end.type === "count" ? rule.end.count : null;
  const until =
    rule.end.type === "until" ? parseLocal(rule.end.date, "yyyy-MM-dd") : null;
  if (
    !Number.isInteger(rule.interval) ||
    rule.interval < 1 ||
    rule.interval > 52
  )
    throw new RecurrenceError("rule");
  if (
    (count !== null && (!Number.isInteger(count) || count < 2)) ||
    (rule.end.type === "until" && (!until || until < start.startOf("day")))
  )
    throw new RecurrenceError("rule");
  if (count !== null && count > max) throw new RecurrenceError("limit");

  const firstDay = start.startOf("day");
  const nights = end.startOf("day").diff(firstDay, "days").days;
  const dates: DateTime[] = [];
  const add = (day: DateTime) => {
    if (day.year > 9999 || (until && day > until)) return false;
    if (dates.length >= max) throw new RecurrenceError("limit");
    dates.push(day);
    return dates.length !== count;
  };
  add(firstDay);
  const weekday = firstDay.weekday;
  if (rule.frequency === "weekly") {
    const days = [...new Set(rule.weekdays ?? [weekday])].sort((a, b) => a - b);
    if (
      days.length === 0 ||
      days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
    )
      throw new RecurrenceError("rule");
    const monday = firstDay.startOf("week");
    weekly: for (let week = 0; ; week += rule.interval) {
      const first = monday.plus({ weeks: week });
      for (const day of days) {
        const occurrence = first.plus({ days: day - 1 });
        if (occurrence > firstDay && !add(occurrence)) break weekly;
      }
    }
  } else {
    const boundary =
      rule.frequency === "monthly" ? firstDay.startOf("month") : firstDay;
    const ordinal = Math.floor((firstDay.day - 1) / 7);
    for (let step = rule.interval; ; step += rule.interval) {
      let next;
      if (rule.frequency === "daily") {
        next = boundary.plus({ days: step });
      } else if (rule.frequency === "yearly") {
        next = boundary.plus({ years: step });
        if (
          next.year <= 9999 &&
          (!until || next <= until) &&
          next.day !== firstDay.day
        )
          continue;
      } else {
        const month = boundary.plus({ months: step });
        if (month.year > 9999 || (until && month > until)) break;
        const day =
          rule.monthlyPattern === "weekday"
            ? 1 + ((weekday - month.weekday + 7) % 7) + ordinal * 7
            : firstDay.day;
        if (day > month.daysInMonth!) continue;
        next = month.set({ day });
      }
      if (!add(next)) break;
    }
  }
  if (dates.length < 2 || (count !== null && dates.length !== count))
    throw new RecurrenceError("rule");

  return dates.map((day) => {
    const endDay = day.plus({ days: nights });
    if (endDay.year > 9999) throw new RecurrenceError("rule");
    const starts_at = day
      .set({ hour: start.hour, minute: start.minute })
      .toFormat(minuteFormat);
    const ends_at = endDay
      .set({ hour: end.hour, minute: end.minute })
      .toFormat(minuteFormat);
    const instantStart = zonedInstant(starts_at, zone);
    if (!instantStart) throw new RecurrenceError("local-time", starts_at);
    const instantEnd = zonedInstant(ends_at, zone);
    if (!instantEnd || Date.parse(instantEnd) <= Date.parse(instantStart))
      throw new RecurrenceError("local-time", ends_at);
    return { starts_at, ends_at };
  });
}
