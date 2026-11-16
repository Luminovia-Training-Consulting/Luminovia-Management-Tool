/**
 * Erzeugt lokale Wochentag-Terminvorlagen ohne Sommerzeit-Normalisierung. Die hier verwendete UTC-Zone dient nur kalendarischer Datumsarithmetik; die eigentliche Kurszone wird später beim Instanterzeugen angewendet.
 */
import { DateTime } from "luxon";

// Generate wall-clock suggestions only. Saving still validates each exact
// instant against the chosen IANA zone, including DST ambiguity/gap rejection.
/** Erzeugt gültige lokale Montag-bis-Freitag-Termine und weist ungültige Startdaten, Uhrzeiten oder Tageszahlen ab. */
export function weekdaySessions(
  startDate: string,
  startsAt: string,
  endsAt: string,
  days: number,
): { starts_at: string; ends_at: string }[] {
  const date = DateTime.fromISO(startDate, { zone: "UTC" });
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !date.isValid ||
    !time.test(startsAt) ||
    !time.test(endsAt) ||
    endsAt <= startsAt ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 60
  )
    throw new Error("invalid_schedule");
  const result = [];
  let current = date;
  while (result.length < days) {
    if (current.weekday < 6) {
      const day = current.toISODate()!;
      result.push({
        starts_at: `${day}T${startsAt}`,
        ends_at: `${day}T${endsAt}`,
      });
    }
    current = current.plus({ days: 1 });
  }
  return result;
}
