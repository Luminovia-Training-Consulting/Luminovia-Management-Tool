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
  return starts_at && ends_at && Date.parse(starts_at) < Date.parse(ends_at)
    ? { starts_at, ends_at }
    : null;
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
  const difference = firstMillis - secondMillis;
  if (difference) return difference;
  // PostgreSQL timestamps retain up to six fractional digits. Equal JavaScript
  // milliseconds still need that precision; whole-minute ISO offsets do not
  // affect the fractional component within the same absolute second.
  const microseconds = (instant: string) =>
    Number(
      (/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i.exec(instant)?.[1] ?? "")
        .padEnd(6, "0")
        .slice(0, 6),
    );
  return microseconds(first) - microseconds(second);
}

/** Check all half-open intervals without rounding stored microseconds or changing form order. */
export function validScheduleIntervals(
  rows: readonly { starts_at: string | null; ends_at: string | null }[],
) {
  const intervals = rows.flatMap(({ starts_at, ends_at }) =>
    starts_at &&
    ends_at &&
    (compareScheduleInstants(starts_at, ends_at) ?? 0) < 0
      ? [{ starts_at, ends_at }]
      : [],
  );
  if (intervals.length !== rows.length) return false;
  intervals.sort(
    (a, b) => compareScheduleInstants(a.starts_at, b.starts_at) ?? 0,
  );
  return intervals.every(
    (item, index) =>
      index === 0 ||
      (compareScheduleInstants(item.starts_at, intervals[index - 1].ends_at) ??
        -1) >= 0,
  );
}

// Reuse ICU formatters in large lists while bounding the number of retained zones.
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const maxDateTimeFormatters = 32;

/** Format an instant in the requested language and explicit display zone. */
export function dateTime(
  iso: string,
  language: string,
  zone: string,
  dateStyle: "medium" | "short" = "medium",
) {
  const key = JSON.stringify([language, zone, dateStyle]);
  let formatter = dateTimeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(language, {
      dateStyle,
      timeStyle: "short",
      timeZone: zone,
    });
    if (dateTimeFormatters.size >= maxDateTimeFormatters)
      dateTimeFormatters.delete(dateTimeFormatters.keys().next().value!);
    dateTimeFormatters.set(key, formatter);
  }
  return formatter.format(new Date(iso));
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
