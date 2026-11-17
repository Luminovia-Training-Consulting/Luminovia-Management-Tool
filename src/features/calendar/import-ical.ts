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
/** All-day DTEND stays exclusive; floating wall times use the user's explicit import zone. */
function instant(
  time: ICAL.Time,
  component: ICAL.Component,
  property: string,
  fallback: string,
) {
  const tzid = component.getFirstProperty(property)?.getParameter("tzid");
  const zone =
    time.zone.tzid === "UTC"
      ? "UTC"
      : typeof tzid === "string"
        ? tzid
        : fallback;
  if (!validZone(zone)) throw new Error("unsupported_zone");
  const value = DateTime.fromObject(
    {
      year: time.year,
      month: time.month,
      day: time.day,
      hour: time.hour,
      minute: time.minute,
      second: time.second,
    },
    { zone },
  );
  if (!value.isValid) throw new Error("invalid_time");
  return { value, zone };
}
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
  const result = new Map<string, ImportedAppointment>();
  for (const component of components) {
    if (component.hasProperty("recurrence-id")) continue;
    const event = new ICAL.Event(component);
    if (!event.uid || event.uid.length > 800) throw new Error("invalid_file");
    const append = (start: ICAL.Time, end: ICAL.Time, item: ICAL.Event) => {
      if (item.component.getFirstPropertyValue("status") === "CANCELLED")
        return;
      const begins = instant(start, item.component, "dtstart", zone);
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
    if (!event.isRecurring()) append(event.startDate, event.endDate, event);
    else {
      const iterator = event.iterator();
      let exhausted = false;
      for (let count = 0; count < 10000; count++) {
        const next = iterator.next();
        if (!next) {
          exhausted = true;
          break;
        }
        const occurrence = event.getOccurrenceDetails(next);
        const start = instant(
          occurrence.startDate,
          occurrence.item.component,
          "dtstart",
          zone,
        ).value;
        if (start >= windowEnd) {
          exhausted = true;
          break;
        }
        if (start >= windowStart)
          append(occurrence.startDate, occurrence.endDate, occurrence.item);
      }
      if (!exhausted) throw new Error("too_many");
    }
  }
  if (!result.size) throw new Error("empty_window");
  return [...result.values()].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at),
  );
}
