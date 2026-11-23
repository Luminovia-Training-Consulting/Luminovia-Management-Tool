import { DateTime } from "luxon";

export type CalendarDraftRange = {
  starts_at: string;
  ends_at: string;
  time_zone: string;
};

/** FullCalendar's date/time strings describe the visible civil slots. Keep
 * both wall times, including the exclusive all-day end. The existing editors
 * apply the IANA zone and reject gaps or ambiguous times before writing. */
export function calendarSelectionRange(
  start: string,
  end: string,
  allDay: boolean,
  zone: string,
): CalendarDraftRange {
  return {
    starts_at: allDay ? `${start}T00:00` : start.slice(0, 16),
    ends_at: allDay ? `${end}T00:00` : end.slice(0, 16),
    time_zone: zone,
  };
}

export function calendarClickRange(
  date: string,
  allDay: boolean,
  zone: string,
): CalendarDraftRange {
  if (allDay)
    return {
      starts_at: `${date}T09:00`,
      ends_at: `${date}T10:00`,
      time_zone: zone,
    };
  // Use UTC only for wall-clock arithmetic. Neither endpoint is a UTC
  // appointment until the form resolves it against the selected IANA zone.
  const start = date.slice(0, 16);
  return {
    starts_at: start,
    ends_at: DateTime.fromISO(start, { zone: "UTC" })
      .plus({ minutes: 30 })
      .toFormat("yyyy-MM-dd'T'HH:mm"),
    time_zone: zone,
  };
}
