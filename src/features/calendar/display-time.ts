/** Disambiguate repeated wall times using the source instants, not grid markers. */
import { DateTime } from "luxon";

export function calendarFoldLabel(
  start: string,
  end: string,
  zone: string,
  locale: string,
) {
  const times = [start, end].map((value) =>
    DateTime.fromISO(value, { zone, locale }),
  );
  if (
    times.some((time) => !time.isValid) ||
    !times.some((time) => time.getPossibleOffsets().length > 1)
  )
    return undefined;

  return times
    .map(
      (time) =>
        `${time.toLocaleString(DateTime.TIME_SIMPLE)} UTC${time.toFormat("ZZ")}`,
    )
    .join(" – ");
}
