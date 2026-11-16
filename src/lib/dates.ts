/**
 * Shared IANA local-time conversion and localized instant/money display. Reject
 * nonexistent/ambiguous DST input for new bookings; never perform implicit currency conversion.
 */
import { DateTime, IANAZone } from "luxon";
/** Convert only existing, unambiguous local minute values to UTC; return null for DST gaps/duplicates. */
export function zonedInstant(value: string, zone: string): string | null {
  if (!IANAZone.isValidZone(zone)) return null;
  const date = DateTime.fromISO(value, { zone });
  // Luxon normalises nonexistent DST times: reject rather than silently move a booking.
  if (
    !date.isValid ||
    date.toFormat("yyyy-MM-dd'T'HH:mm") !== value ||
    date.getPossibleOffsets().length !== 1
  )
    return null;
  return date.toUTC().toISO();
}
/** Format an instant in the requested language and explicit display zone. */
export function dateTime(iso: string, language: string, zone: string) {
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: zone,
  }).format(new Date(iso));
}
/** Format the supplied amount in its original currency without exchange-rate conversion. */
export function money(amount: number, currency: string, language: string) {
  return new Intl.NumberFormat(language, {
    style: "currency",
    currency,
  }).format(amount);
}
/** Validate an IANA zone through Luxon rather than accepting arbitrary fixed-offset text. */
export function validZone(zone: string) {
  return IANAZone.isValidZone(zone);
}
