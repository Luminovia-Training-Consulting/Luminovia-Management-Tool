import { DateTime, IANAZone } from "luxon";
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
export function dateTime(iso: string, language: string, zone: string) {
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: zone,
  }).format(new Date(iso));
}
export function money(amount: number, currency: string, language: string) {
  return new Intl.NumberFormat(language, {
    style: "currency",
    currency,
  }).format(amount);
}
export function validZone(zone: string) {
  return IANAZone.isValidZone(zone);
}
