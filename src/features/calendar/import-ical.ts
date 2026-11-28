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

function isCancelled(component: ICAL.Component) {
  return component.getFirstPropertyValue("status") === "CANCELLED";
}

/** RFC 5545 DATE-TIME values name the first instant in a repeated local hour. */
function firstLocalInstant(value: DateTime) {
  return value.isOffsetFixed
    ? value
    : value
        .getPossibleOffsets()
        .reduce((first, candidate) => (candidate < first ? candidate : first));
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
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateOnly.test(from) || !dateOnly.test(until))
    throw new Error("invalid_window");
  // Advance the civil date before applying its zone, so a midnight DST gap
  // cannot carry a shifted hour into the following day's boundary.
  const firstDay = DateTime.fromISO(from, { zone: "UTC" });
  const lastDay = DateTime.fromISO(until, { zone: "UTC" });
  const afterLastDay = lastDay.plus({ days: 1 });
  if (
    !firstDay.isValid ||
    !lastDay.isValid ||
    lastDay < firstDay ||
    afterLastDay.diff(firstDay, "days").days > 732
  )
    throw new Error("invalid_window");
  const startOfLocalDay = (day: DateTime) =>
    firstLocalInstant(day.setZone(zone, { keepLocalTime: true }));
  const windowStart = startOfLocalDay(firstDay);
  const windowEnd = startOfLocalDay(afterLastDay);
  const inWindow = (start: DateTime) =>
    start >= windowStart && start < windowEnd;
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
    return { value: firstLocalInstant(value), zone: timeZone };
  }

  // ICAL's implicit exception discovery does not match series UIDs.
  const exceptionsByUid = new Map<string, ICAL.Component[]>();
  for (const component of components) {
    if (!component.hasProperty("recurrence-id")) continue;
    const uid = component.getFirstPropertyValue("uid");
    if (typeof uid !== "string") continue;
    const exceptions = exceptionsByUid.get(uid);
    if (exceptions) exceptions.push(component);
    else exceptionsByUid.set(uid, [component]);
  }

  const result = new Map<string, ImportedAppointment>();
  for (const component of components) {
    if (component.hasProperty("recurrence-id")) continue;
    const uid = component.getFirstPropertyValue("uid");
    if (typeof uid !== "string" || !uid || uid.length > 800)
      throw new Error("invalid_file");
    if (isCancelled(component)) continue;
    const event = new ICAL.Event(component, {
      exceptions: exceptionsByUid.get(uid) ?? [],
    });
    /** Store one confirmed occurrence using its already resolved start instant. */
    const append = (
      begins: ReturnType<typeof instant>,
      end: ICAL.Time,
      item: ICAL.Event,
    ) => {
      const finishes = instant(end, item.component, "dtend", begins.zone);
      if (finishes.value <= begins.value) throw new Error("invalid_time");
      const starts = begins.value.toUTC().toISO()!;
      const ends = finishes.value.toUTC().toISO()!;
      const occurrenceUid = `${uid}\n${starts}`;
      const title = item.summary || untitled;
      const description = [item.description, item.location]
        .filter(Boolean)
        .join("\n\n");
      if (title.length > 200 || description.length > 10000)
        throw new Error("invalid_file");
      result.set(occurrenceUid, {
        uid: occurrenceUid,
        title,
        description,
        starts_at: starts,
        ends_at: ends,
        time_zone: begins.zone,
      });
      if (result.size > 500) throw new Error("too_many");
    };
    if (!event.isRecurring()) {
      const begins = instant(event.startDate, component, "dtstart");
      if (inWindow(begins.value)) append(begins, event.endDate, event);
    } else {
      // An exception can move a later recurrence into the review window. Extend
      // the original-time horizon before stopping the ordered iterator. A range
      // exception may shift subsequent occurrences as well; keep the existing
      // iteration cap so a distant exception fails explicitly instead of hanging.
      let horizon = windowEnd;
      let hasCancellation = false;
      const exceptions = new Map(Object.entries(event.exceptions));
      for (const exception of exceptions.values()) {
        if (isCancelled(exception.component)) {
          hasCancellation = true;
          continue;
        }
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
        if (inWindow(adjusted) && original > horizon) horizon = original;
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
        if (hasCancellation) {
          // Match ICAL's direct/UTC/range precedence before it reads dates
          // from a cancellation. In ical.js 2.2.1 the range lookup returns a key.
          const exception =
            exceptions.get(next.toString()) ??
            exceptions.get(
              next.convertToZone(ICAL.Timezone.utcTimezone).toString(),
            ) ??
            exceptions.get(String(event.findRangeException(next) ?? ""));
          if (exception && isCancelled(exception.component)) {
            if (scheduled.value <= horizon) continue;
            exhausted = true;
            break;
          }
        }
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
        if (inWindow(begins.value))
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
