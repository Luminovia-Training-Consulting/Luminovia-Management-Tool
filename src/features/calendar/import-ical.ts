/** Parse local ICS snapshots; recurring events are materialised only in the reviewed date window. */
import ICAL from "ical.js";
import { DateTime } from "luxon";
import { validZone } from "../../lib/dates";

export interface ImportedAppointment {
  uid: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  time_zone: string;
}

/** Return the bounded, reviewed import preview using the file's explicit zones. */
export function parseCalendarImport(
  source: string,
  zone: string,
  from: string,
  until: string,
  untitled: string,
): ImportedAppointment[] {
  if (!validZone(zone) || source.length > 2_000_000)
    throw new Error("invalid_file");
  const windowStart = DateTime.fromISO(from, { zone });
  const windowEnd = DateTime.fromISO(until, { zone }).plus({ days: 1 });
  if (
    !windowStart.isValid ||
    !windowEnd.isValid ||
    windowEnd <= windowStart ||
    windowEnd.diff(windowStart, "days").days > 732
  )
    throw new Error("invalid_window");
  const calendar = new ICAL.Component(ICAL.parse(source));
  if (calendar.name !== "vcalendar") throw new Error("invalid_file");
  const components = calendar.getAllSubcomponents("vevent");
  if (!components.length || components.length > 500)
    throw new Error("invalid_file");
  const validatedZones = new Set([zone]);

  /** All-day DTEND stays exclusive. Validate each distinct zone once per file. */
  function instant(
    time: ICAL.Time,
    component: ICAL.Component,
    property: string,
    fallback = zone,
  ) {
    const tzid = component.getFirstProperty(property)?.getParameter("tzid");
    const timeZone =
      time.zone.tzid === "UTC"
        ? "UTC"
        : typeof tzid === "string"
          ? tzid
          : fallback;
    if (!validatedZones.has(timeZone)) {
      if (!validZone(timeZone)) throw new Error("unsupported_zone");
      validatedZones.add(timeZone);
    }
    const value = DateTime.fromObject(
      {
        year: time.year,
        month: time.month,
        day: time.day,
        hour: time.hour,
        minute: time.minute,
        second: time.second,
      },
      { zone: timeZone },
    );
    if (!value.isValid) throw new Error("invalid_time");
    return { value, zone: timeZone };
  }

  const result = new Map<string, ImportedAppointment>();
  for (const component of components) {
    if (component.hasProperty("recurrence-id")) continue;
    const event = new ICAL.Event(component);
    if (!event.uid || event.uid.length > 800) throw new Error("invalid_file");
    /** Store one confirmed occurrence using its already resolved start instant. */
    const append = (
      begins: ReturnType<typeof instant>,
      end: ICAL.Time,
      item: ICAL.Event,
    ) => {
      if (item.component.getFirstPropertyValue("status") === "CANCELLED")
        return;
      const finishes = instant(end, item.component, "dtend", begins.zone);
      if (finishes.value <= begins.value) throw new Error("invalid_time");
      const starts = begins.value.toUTC().toISO()!;
      const ends = finishes.value.toUTC().toISO()!;
      const uid = `${event.uid}\n${starts}`;
      const title = item.summary || untitled;
      const description = [item.description, item.location]
        .filter(Boolean)
        .join("\n\n");
      if (title.length > 200 || description.length > 10000)
        throw new Error("invalid_file");
      result.set(uid, {
        uid,
        title,
        description,
        starts_at: starts,
        ends_at: ends,
        time_zone: begins.zone,
      });
      if (result.size > 500) throw new Error("too_many");
    };
    if (!event.isRecurring()) {
      if (component.getFirstPropertyValue("status") === "CANCELLED") continue;
      append(
        instant(event.startDate, component, "dtstart"),
        event.endDate,
        event,
      );
    } else {
      // An exception can move a later recurrence into the review window. Extend
      // the original-time horizon before stopping the ordered iterator. A range
      // exception may shift subsequent occurrences as well; keep the existing
      // iteration cap so a distant exception fails explicitly instead of hanging.
      let horizon = windowEnd;
      for (const exception of Object.values(event.exceptions)) {
        if (!exception.component.hasProperty("dtstart")) continue;
        const original = instant(
          exception.recurrenceId,
          exception.component,
          "recurrence-id",
        ).value;
        const adjusted = instant(
          exception.startDate,
          exception.component,
          "dtstart",
        ).value;
        if (
          adjusted >= windowStart &&
          adjusted < windowEnd &&
          original > horizon
        )
          horizon = original;
        if (exception.modifiesFuture() && adjusted < windowEnd) {
          const shiftedEnd = windowEnd.plus({
            milliseconds: Math.max(
              0,
              original.toMillis() - adjusted.toMillis(),
            ),
          });
          if (shiftedEnd > horizon) horizon = shiftedEnd;
        }
      }
      const iterator = event.iterator();
      let exhausted = false;
      for (let count = 0; count < 10000; count++) {
        const next = iterator.next();
        if (!next) {
          exhausted = true;
          break;
        }
        // Exceptions can move an occurrence forward past the window while
        // subsequent original occurrences still fall inside it. The iterator
        // is ordered by the original recurrence, not by the adjusted start.
        const scheduled = instant(next, component, "dtstart");
        const occurrence = event.getOccurrenceDetails(next);
        const begins =
          occurrence.item === event && occurrence.startDate === next
            ? scheduled
            : instant(
                occurrence.startDate,
                occurrence.item.component,
                "dtstart",
              );
        if (scheduled.value > horizon && begins.value >= windowEnd) {
          exhausted = true;
          break;
        }
        if (begins.value >= windowStart && begins.value < windowEnd)
          append(begins, occurrence.endDate, occurrence.item);
      }
      if (!exhausted) throw new Error("too_many");
    }
  }
  if (!result.size) throw new Error("empty_window");
  return [...result.values()].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at),
  );
}
