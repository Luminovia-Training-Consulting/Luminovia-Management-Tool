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

/** Reuse labels, including ordinary events, only within this calendar snapshot and zone. */
export function calendarEventTimeLabels(
  sources: ReadonlyMap<string, { start: string; end: string }>,
  zone: string,
  locale: string,
) {
  const labels = new Map<string, string | undefined>();
  return (id: string) => {
    if (labels.has(id)) return labels.get(id);
    const source = sources.get(id);
    if (!source) return undefined;
    const label = calendarFoldLabel(source.start, source.end, zone, locale);
    labels.set(id, label);
    return label;
  };
}
