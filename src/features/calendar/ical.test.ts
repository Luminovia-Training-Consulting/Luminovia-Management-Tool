import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  type CalendarExportEvent,
  calendarFile,
  globalEventCalendarFile,
} from "./ical";

const event: CalendarExportEvent = {
  id: "1911b233-f4ce-419f-9f3b-88773417ed8f",
  kind: "assignment",
  title: "Fictional course",
  starts_at: "2026-10-25T02:30:00+02:00",
  ends_at: "2026-10-25T02:30:00+01:00",
  time_zone: "Europe/Berlin",
};
describe("interoperable private calendar snapshots", () => {
  it("downloads one published event without exposing its joining link or notes", () => {
    const published = {
      ...event,
      description: "Fictional joining notes",
      link_url: "https://example.invalid/join",
      published: true,
      archived_at: null,
      version: 2,
      updated_at: "2026-11-16T00:00:00Z",
    };
    const file = globalEventCalendarFile(published, "Calendar");
    expect(file).toContain(`UID:global.${event.id}@luminovia.org`);
    expect(file).toContain("DTSTART:20261025T003000Z");
    expect(file).toContain("DTEND:20261025T013000Z");
    expect(file).not.toContain(published.description);
    expect(file).not.toContain(published.link_url);
    expect(() =>
      globalEventCalendarFile({ ...published, published: false }, "Calendar"),
    ).toThrow();
    expect(() =>
      globalEventCalendarFile(
        { ...published, archived_at: published.updated_at },
        "Calendar",
      ),
    ).toThrow();
  });

  it("preserves both repeated Berlin DST instants in UTC and a stable event identity", () => {
    const file = calendarFile([event], "Luminovia", "2026-11-16T00:00:00Z");
    expect(file).toContain("DTSTART:20261025T003000Z\r\n");
    expect(file).toContain("DTEND:20261025T013000Z\r\n");
    expect(file).toContain("X-LUMINOVIA-TIME-ZONE:Europe/Berlin");
    expect(file).toContain(`UID:assignment.${event.id}@luminovia.org`);
    expect(file).toContain("CLASS:PRIVATE");
    expect(file).not.toContain("\r\nMETHOD:");
    expect(file.endsWith("END:VCALENDAR\r\n")).toBe(true);
    const brisbane = calendarFile(
      [
        {
          ...event,
          time_zone: "Australia/Brisbane",
          starts_at: "2026-11-16T09:00:00+10:00",
          ends_at: "2026-11-16T10:00:00+10:00",
        },
      ],
      "Luminovia",
    );
    expect(brisbane).toContain("DTSTART:20261115T230000Z");
    expect(
      DateTime.fromFormat("20261115T230000Z", "yyyyMMdd'T'HHmmss'Z'", {
        zone: "UTC",
      }).setZone("Australia/Brisbane").hour,
    ).toBe(9);
  });
  it("escapes authored content to prevent injected calendar properties and folds Unicode by UTF-8 octets", () => {
    const title =
      "Kurs: ä👩‍🏫 ".repeat(25) +
      ",;\\\r\nATTENDEE:mailto:foreign@example.invalid\u0000";
    const file = calendarFile([{ ...event, title }], "Course\r\nBEGIN:VEVENT");
    for (const line of file.split("\r\n"))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const unfolded = file.replace(/\r\n /g, "");
    expect(
      unfolded.split("\r\n").filter((line) => line === "BEGIN:VEVENT"),
    ).toHaveLength(1);
    expect(unfolded).toContain("X-WR-CALNAME:Course\\nBEGIN:VEVENT");
    expect(unfolded).toContain("\\,\\;\\\\\\nATTENDEE:");
    expect(unfolded).not.toContain("\r\nATTENDEE:");
    expect(unfolded).not.toContain("\u0000");
    expect(unfolded).not.toContain("\uFFFD");
  });
  it.each([
    ["A", 1],
    ["ä", 2],
    ["€", 3],
    ["👩", 4],
  ])(
    "folds %s exactly at the byte boundary without splitting it",
    (char, bytes) => {
      const head = `SUMMARY:${"x".repeat(75 - "SUMMARY:".length - bytes)}${char}`;
      const tail = `${char}${"x".repeat(74 - bytes)}`;
      const file = calendarFile(
        [{ ...event, title: `${head.slice("SUMMARY:".length)}${tail}!` }],
        "Calendar",
      );
      expect(file).toContain(`\r\n${head}\r\n ${tail}\r\n !\r\n`);
    },
  );
  it("shares one UTC snapshot timestamp and leaves empty snapshots timestamp-free", () => {
    const generatedAt = "2026-11-16T02:30:00+01:00";
    const file = calendarFile(
      [event, { ...event, id: "1911b233-f4ce-419f-9f3b-88773417ed90" }],
      "Calendar",
      generatedAt,
    );
    expect(
      file.split("\r\n").filter((line) => line.startsWith("DTSTAMP:")),
    ).toEqual(["DTSTAMP:20261116T013000Z", "DTSTAMP:20261116T013000Z"]);
    expect(calendarFile([], "Calendar", "not a date")).not.toContain(
      "DTSTAMP:",
    );
  });
  it("rejects malformed identities, nonfinite dates, reversed intervals and unbounded exports", () => {
    for (const invalid of [
      { id: "injected\r\nBEGIN:VEVENT" },
      { starts_at: "Infinity" },
      { ends_at: "2026-10-24T00:00:00Z" },
      { time_zone: "Invalid/Zone" },
    ])
      expect(() =>
        calendarFile([{ ...event, ...invalid }], "Calendar"),
      ).toThrow();
    expect(() =>
      calendarFile(
        Array.from({ length: 501 }, () => event),
        "Calendar",
      ),
    ).toThrow();
  });
});
