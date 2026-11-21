/** Calendar-day grouping uses the reader's zone, never the sender device's clock. */
import { DateTime } from "luxon";

export function messageDay(iso: string, zone: string): string {
  const day = DateTime.fromISO(iso, { setZone: true })
    .setZone(zone)
    .toISODate();
  if (!day) throw new RangeError("Invalid message timestamp or time zone");
  return day;
}

/** The full local date avoids ambiguous labels across month and year boundaries. */
export function messageDayLabel(
  iso: string,
  zone: string,
  language: string,
): string {
  return new Intl.DateTimeFormat(language, {
    dateStyle: "full",
    timeZone: zone,
  }).format(new Date(iso));
}
