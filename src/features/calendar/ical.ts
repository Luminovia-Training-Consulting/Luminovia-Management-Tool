import { DateTime } from "luxon";
import { z } from "zod";
import { calendarExportSchema } from "./schema";

export { calendarExportSchema } from "./schema";
export type CalendarExportEvent = z.infer<typeof calendarExportSchema>[number];

function text(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("")
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code === 9 || code === 10 || (code >= 32 && code !== 127);
    })
    .join("")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

// RFC 5545 limits content lines to 75 octets. Never split a UTF-8 character.
function fold(line: string) {
  const encoder = new TextEncoder();
  let result = "";
  let length = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (length + bytes > 75) {
      result += "\r\n ";
      length = 1;
    }
    result += char;
    length += bytes;
  }
  return result;
}

function instant(value: string) {
  const date = DateTime.fromISO(value, { setZone: true }).toUTC();
  if (!date.isValid) throw new Error("Invalid calendar instant");
  return date.toFormat("yyyyMMdd'T'HHmmss'Z'");
}

export function calendarFile(
  input: CalendarExportEvent[],
  name: string,
  generatedAt = new Date().toISOString(),
) {
  const events = calendarExportSchema.parse(input);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Luminovia//Portal Calendar//DE",
    "CALSCALE:GREGORIAN",
    // A deliberate file snapshot is not an iTIP scheduling transaction.
    // METHOD:PUBLISH would require an ORGANIZER (RFC 5546 section 3.2.1).
    `X-WR-CALNAME:${text(name)}`,
  ];
  for (const event of events) {
    if (Date.parse(event.ends_at) <= Date.parse(event.starts_at))
      throw new Error("Invalid calendar interval");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.kind}.${event.id}@luminovia.org`,
      `DTSTAMP:${instant(generatedAt)}`,
      `DTSTART:${instant(event.starts_at)}`,
      `DTEND:${instant(event.ends_at)}`,
      `SUMMARY:${text(event.title)}`,
      `X-LUMINOVIA-TIME-ZONE:${text(event.time_zone)}`,
      "CLASS:PRIVATE",
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  return [...lines, "END:VCALENDAR", ""].map(fold).join("\r\n");
}
