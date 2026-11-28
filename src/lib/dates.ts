/**
 * Shared IANA local-time conversion and localized instant/money display. Reject
 * nonexistent/ambiguous DST input for new bookings; never perform implicit currency conversion.
 */
import { DateTime, IANAZone } from "luxon";

const localMinuteFormat = "yyyy-MM-dd'T'HH:mm";

/** Convert only existing, unambiguous local minute values to UTC; return null for DST gaps/duplicates. */
export function zonedInstant(value: string, zone: string): string | null {
  if (!IANAZone.isValidZone(zone)) return null;
  const date = DateTime.fromISO(value, { zone });
  // Luxon normalises nonexistent DST times: reject rather than silently move a booking.
  if (
    !date.isValid ||
    date.toFormat(localMinuteFormat) !== value ||
    date.getPossibleOffsets().length !== 1
  )
    return null;
  return date.toUTC().toISO();
}

/** Preserve an exact reviewed instant only while its wall-time editor is unchanged; new edits still reject DST gaps and duplicates. */
export function zonedInstantForEdit(
  value: string,
  zone: string,
  originalValue: string,
  originalInstant: string | null,
): string | null {
  if (value === originalValue) return originalInstant;
  return value ? zonedInstant(value, zone) : null;
}

/** A minute editor cannot reconstruct stored seconds or pick an offset in a DST fold. Keep the exact instant while the same zone and displayed minute are retained. */
export function zonedInstantForScheduleEdit(
  value: string,
  zone: string,
  originalInstant?: string,
  originalZone?: string,
): string | null {
  if (originalInstant && originalZone === zone) {
    const original = DateTime.fromISO(originalInstant, { zone });
    if (original.isValid && original.toFormat(localMinuteFormat) === value)
      return originalInstant;
  }
  return zonedInstant(value, zone);
}

type ScheduleWindow = { starts_at: string; ends_at: string; time_zone: string };

/** Resolve the two endpoints of a published window and require a positive duration. */
export function resolveScheduleWindow(
  value: ScheduleWindow,
  original?: ScheduleWindow,
) {
  const starts_at = zonedInstantForScheduleEdit(
    value.starts_at,
    value.time_zone,
    original?.starts_at,
    original?.time_zone,
  );
  const ends_at = zonedInstantForScheduleEdit(
    value.ends_at,
    value.time_zone,
    original?.ends_at,
    original?.time_zone,
  );
  if (!starts_at || !ends_at) return null;
  // Both endpoints were produced by the validated zoned-time conversion above.
  return compareScheduleInstants(starts_at, ends_at)! < 0
    ? { starts_at, ends_at }
    : null;
}

// Date.parse retains milliseconds. Keep the next three digits separately so
// the full PostgreSQL precision never has to fit in one JavaScript number.
function subMillisecondMicroseconds(instant: string): number {
  const digits = /\.\d{3}(\d{1,3})\d*(?:Z|[+-]\d{2}:?\d{2})$/i.exec(
    instant,
  )?.[1];
  return digits ? Number(digits.padEnd(3, "0")) : 0;
}

/** Compare absolute instants, retaining PostgreSQL microseconds when JavaScript milliseconds tie. Invalid endpoints return null. */
export function compareScheduleInstants(
  first: string,
  second: string,
): number | null {
  const firstMillis = Date.parse(first);
  const secondMillis = Date.parse(second);
  if (!Number.isFinite(firstMillis) || !Number.isFinite(secondMillis))
    return null;
  return (
    firstMillis - secondMillis ||
    subMillisecondMicroseconds(first) - subMillisecondMicroseconds(second)
  );
}

export function parseInstantPoint(value: string | null) {
  if (!value) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis)
    ? { millis, fraction: subMillisecondMicroseconds(value) }
    : null;
}

type InstantPoint = NonNullable<ReturnType<typeof parseInstantPoint>>;

export function compareInstantPoints(
  first: InstantPoint,
  second: InstantPoint,
) {
  return first.millis - second.millis || first.fraction - second.fraction;
}

/** Check every half-open interval, sorting parsed endpoints without changing form order. */
export function validScheduleIntervals(
  rows: readonly { starts_at: string | null; ends_at: string | null }[],
) {
  const intervals: { start: InstantPoint; end: InstantPoint }[] = [];
  for (const { starts_at, ends_at } of rows) {
    const start = parseInstantPoint(starts_at);
    const end = parseInstantPoint(ends_at);
    if (!start || !end || compareInstantPoints(start, end) >= 0) return false;
    intervals.push({ start, end });
  }
  intervals.sort((a, b) => compareInstantPoints(a.start, b.start));
  return intervals.every(
    (item, index) =>
      index === 0 ||
      compareInstantPoints(item.start, intervals[index - 1].end) >= 0,
  );
}

// Reuse ICU formatters in large lists while bounding the number of retained zones.
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const maxDateTimeFormatters = 32;

function dateTimeFormatter(
  language: string,
  zone: string,
  dateStyle: "medium" | "short",
) {
  const key = JSON.stringify([language, zone, dateStyle]);
  let formatter = dateTimeFormatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat(language, {
        dateStyle,
        timeStyle: "short",
        timeZone: zone,
      });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return null;
    }
    if (dateTimeFormatters.size >= maxDateTimeFormatters)
      dateTimeFormatters.delete(dateTimeFormatters.keys().next().value!);
    dateTimeFormatters.set(key, formatter);
  }
  return formatter;
}

/** Format a valid instant, or let semantic time elements omit unconfirmed data. */
export function dateTimeOrNull(
  value: string | number,
  language: string,
  zone: string,
  dateStyle: "medium" | "short" = "medium",
) {
  const instant = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(instant)
    ? (dateTimeFormatter(language, zone, dateStyle)?.format(instant) ?? null)
    : null;
}

/** Format an instant in the requested language and explicit display zone. */
export function dateTime(
  iso: string,
  language: string,
  zone: string,
  dateStyle: "medium" | "short" = "medium",
) {
  return dateTimeOrNull(iso, language, zone, dateStyle) ?? "–";
}

/** Format an ordered range; imports with unreadable timestamps render a placeholder. */
export function dateTimeRange(
  start: string,
  end: string,
  language: string,
  zone: string,
) {
  const from = Date.parse(start);
  const to = Date.parse(end);
  return Number.isFinite(from) && Number.isFinite(to) && from <= to
    ? (dateTimeFormatter(language, zone, "medium")?.formatRange(from, to) ??
        "–")
    : "–";
}

const moneyFormatters = new Map<string, Intl.NumberFormat>();
const maxMoneyFormatters = 32;

/** Format the supplied amount in its original currency without exchange-rate conversion. */
export function money(amount: number, currency: string, language: string) {
  const key = JSON.stringify([language, currency]);
  let formatter = moneyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(language, {
      style: "currency",
      currency,
    });
    if (moneyFormatters.size >= maxMoneyFormatters)
      moneyFormatters.delete(moneyFormatters.keys().next().value!);
    moneyFormatters.set(key, formatter);
  }
  return formatter.format(amount);
}

/** Validate an IANA zone through Luxon rather than accepting arbitrary fixed-offset text. */
export function validZone(zone: string) {
  return IANAZone.isValidZone(zone);
}

/** Display a finance date or timestamp as a calendar date in UTC. */
export function formatUtcDate(value: string, language: string) {
  return DateTime.fromISO(value, { zone: "UTC" })
    .setLocale(language)
    .toLocaleString(DateTime.DATE_MED);
}
