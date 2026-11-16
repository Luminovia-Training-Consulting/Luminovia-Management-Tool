/**
 * Gemeinsame Umrechnung lokaler IANA-Zeiten und lokalisierte Anzeige von Instants/Geld. Nicht existierende oder doppeldeutige lokale Sommerzeitwerte werden für neue Buchungen abgewiesen; Währungen werden niemals implizit umgerechnet.
 */
import { DateTime, IANAZone } from "luxon";
/** Wandelt nur existierende, eindeutige lokale Minutenwerte in UTC um; DST-Lücken und Doppelzeiten liefern null. */
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
/** Formatiert einen echten Instant in der gewünschten Sprache und expliziten Anzeigezone. */
export function dateTime(iso: string, language: string, zone: string) {
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: zone,
  }).format(new Date(iso));
}
/** Formatiert den vorhandenen Betrag in seiner Originalwährung ohne Wechselkursumrechnung. */
export function money(amount: number, currency: string, language: string) {
  return new Intl.NumberFormat(language, {
    style: "currency",
    currency,
  }).format(amount);
}
/** Prüft eine IANA-Zonenkennung mit Luxon statt beliebige feste Offsettexte zu akzeptieren. */
export function validZone(zone: string) {
  return IANAZone.isValidZone(zone);
}
