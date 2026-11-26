import { describe, expect, it } from "vitest";
import { parseCalendarImport } from "./import-ical";

const file = (...events: string[]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ...events.map((event) => `BEGIN:VEVENT\r\n${event}\r\nEND:VEVENT`),
    "END:VCALENDAR",
  ].join("\r\n");
const parse = (source: string, from = "2026-03-01", until = "2026-03-31") =>
  parseCalendarImport(source, "Europe/Berlin", from, until, "Termin");
describe("reviewed ICS import", () => {
  it("uses the same inclusive local dates for single and recurring starts", () => {
    const events = parse(
      file(
        "UID:overlap\r\nDTSTART:20260328T225959Z\r\nDTEND:20260329T003000Z",
        "UID:first\r\nDTSTART:20260328T230000Z\r\nDTEND:20260328T233000Z\r\nSUMMARY:Erster Einzeltermin",
        "UID:series\r\nDTSTART;TZID=Europe/Berlin:20260328T000000\r\nDTEND;TZID=Europe/Berlin:20260328T003000\r\nRRULE:FREQ=DAILY;COUNT=4\r\nSUMMARY:Serie",
        "UID:last\r\nDTSTART:20260329T215959Z\r\nDTEND:20260329T230000Z\r\nSUMMARY:Letzter Einzeltermin",
        "UID:next\r\nDTSTART:20260329T220000Z\r\nDTEND:20260329T223000Z",
      ),
      "2026-03-29",
      "2026-03-29",
    );
    expect(events.map(({ title }) => title).sort()).toEqual([
      "Erster Einzeltermin",
      "Letzter Einzeltermin",
      "Serie",
    ]);
    expect(events.map(({ starts_at }) => starts_at)).toEqual([
      "2026-03-28T23:00:00.000Z",
      "2026-03-28T23:00:00.000Z",
      "2026-03-29T21:59:59.000Z",
    ]);
  });
  it("reports an empty window when all single starts are outside it", () => {
    expect(() =>
      parse(
        file(
          "UID:outside\r\nDTSTART:20260401T090000Z\r\nDTEND:20260401T100000Z",
        ),
      ),
    ).toThrow("empty_window");
  });
  it("ends at local midnight even if the selected day started at one am", () => {
    const events = parseCalendarImport(
      file(
        "UID:last\r\nDTSTART:20260907T025959Z\r\nDTEND:20260907T040000Z\r\nSUMMARY:Letzter Termin",
        "UID:next\r\nDTSTART:20260907T030000Z\r\nDTEND:20260907T040000Z",
      ),
      "America/Santiago",
      "2026-09-06",
      "2026-09-06",
      "Termin",
    );
    expect(events.map(({ title }) => title)).toEqual(["Letzter Termin"]);
  });
  it("uses the first of two local midnights when the clock goes back", () => {
    const events = parseCalendarImport(
      file(
        "UID:before\r\nDTSTART:20261101T035959Z\r\nDTEND:20261101T050000Z",
        "UID:first\r\nDTSTART:20261101T040000Z\r\nDTEND:20261101T041500Z",
        "UID:second\r\nDTSTART:20261101T050000Z\r\nDTEND:20261101T051500Z",
      ),
      "America/Havana",
      "2026-11-01",
      "2026-11-01",
      "Termin",
    );
    expect(events.map(({ starts_at }) => starts_at)).toEqual([
      "2026-11-01T04:00:00.000Z",
      "2026-11-01T05:00:00.000Z",
    ]);
  });
  it("rejects time components in date-only import boundaries", () => {
    expect(() => parse(file("UID:invalid"), "2026-03-01T12:00")).toThrow(
      "invalid_window",
    );
  });
  it("skips cancelled singles, series and exceptions without a start", () => {
    const events = parse(
      file(
        "UID:single\r\nSTATUS:CANCELLED",
        "UID:cancelled-series\r\nRRULE:FREQ=DAILY\r\nSTATUS:CANCELLED",
        "UID:series\r\nDTSTART:20260301T090000Z\r\nDTEND:20260301T100000Z\r\nRRULE:FREQ=DAILY\r\nSUMMARY:Serie",
        "UID:series\r\nRECURRENCE-ID:20260302T090000Z\r\nSTATUS:CANCELLED",
        "UID:series\r\nRECURRENCE-ID;RANGE=THISANDFUTURE:20260304T090000Z\r\nSTATUS:CANCELLED",
        "UID:series\r\nRECURRENCE-ID:20260305T090000Z\r\nDTSTART:20260305T120000Z\r\nDTEND:20260305T130000Z\r\nSUMMARY:Ausnahme",
      ),
      "2026-03-01",
      "2026-03-06",
    );
    expect(events.map(({ starts_at }) => starts_at)).toEqual([
      "2026-03-01T09:00:00.000Z",
      "2026-03-03T09:00:00.000Z",
      "2026-03-05T12:00:00.000Z",
    ]);
  });
  it("does not apply an exception to another series with the same start", () => {
    const events = parse(
      file(
        "UID:first\r\nDTSTART:20260301T090000Z\r\nDTEND:20260301T100000Z\r\nRRULE:FREQ=DAILY;COUNT=2\r\nSUMMARY:Erste Serie",
        "UID:second\r\nDTSTART:20260301T090000Z\r\nDTEND:20260301T100000Z\r\nRRULE:FREQ=DAILY;COUNT=2\r\nSUMMARY:Zweite Serie",
        "UID:first\r\nRECURRENCE-ID:20260302T090000Z\r\nDTSTART:20260302T120000Z\r\nDTEND:20260302T130000Z\r\nSUMMARY:Verschoben",
      ),
    );
    expect(events.map(({ title }) => title)).toEqual([
      "Erste Serie",
      "Zweite Serie",
      "Zweite Serie",
      "Verschoben",
    ]);
  });
  it("includes an exception moved into the window from a later occurrence", () => {
    const events = parse(
      file(
        "UID:series-back\r\nDTSTART;TZID=Europe/Berlin:20260330T090000\r\nDTEND;TZID=Europe/Berlin:20260330T100000\r\nRRULE:FREQ=DAILY;COUNT=6\r\nSUMMARY:Serie",
        "UID:series-back\r\nRECURRENCE-ID;TZID=Europe/Berlin:20260403T090000\r\nDTSTART;TZID=Europe/Berlin:20260331T120000\r\nDTEND;TZID=Europe/Berlin:20260331T130000\r\nSUMMARY:Vorgezogen",
      ),
    );
    expect(events.map((event) => event.title)).toEqual([
      "Serie",
      "Serie",
      "Vorgezogen",
    ]);
  });
  it("includes later occurrences shifted into the window by a range exception", () => {
    const events = parse(
      file(
        "UID:range-back\r\nDTSTART:20260328T090000Z\r\nDTEND:20260328T100000Z\r\nRRULE:FREQ=DAILY;COUNT=7\r\nSUMMARY:Serie",
        "UID:range-back\r\nRECURRENCE-ID;RANGE=THISANDFUTURE:20260330T090000Z\r\nDTSTART:20260328T120000Z\r\nDTEND:20260328T130000Z\r\nSUMMARY:Vorgezogen",
      ),
    );
    expect(events.map((event) => event.starts_at)).toEqual([
      "2026-03-28T09:00:00.000Z",
      "2026-03-28T12:00:00.000Z",
      "2026-03-29T09:00:00.000Z",
      "2026-03-29T12:00:00.000Z",
      "2026-03-30T12:00:00.000Z",
      "2026-03-31T12:00:00.000Z",
    ]);
  });
  it("reports an excessively distant exception instead of silently skipping it", () => {
    expect(() =>
      parse(
        file(
          "UID:far\r\nDTSTART:20260301T090000Z\r\nDTEND:20260301T100000Z\r\nRRULE:FREQ=DAILY\r\nSUMMARY:Serie",
          "UID:far\r\nRECURRENCE-ID:20560101T090000Z\r\nDTSTART:20260302T120000Z\r\nDTEND:20260302T130000Z\r\nSUMMARY:Vorgezogen",
        ),
        "2026-03-01",
        "2026-03-03",
      ),
    ).toThrow("too_many");
  });
  it("retains later occurrences when an earlier exception moves beyond the window", () => {
    const events = parse(
      file(
        "UID:series\r\nDTSTART;TZID=Europe/Berlin:20260327T090000\r\nDTEND;TZID=Europe/Berlin:20260327T100000\r\nRRULE:FREQ=DAILY;COUNT=5\r\nSUMMARY:Serie",
        "UID:series\r\nRECURRENCE-ID;TZID=Europe/Berlin:20260328T090000\r\nDTSTART;TZID=Europe/Berlin:20260415T090000\r\nDTEND;TZID=Europe/Berlin:20260415T100000\r\nSUMMARY:Verschoben",
      ),
    );
    expect(events.map((event) => event.starts_at)).toEqual([
      "2026-03-27T08:00:00.000Z",
      "2026-03-29T07:00:00.000Z",
      "2026-03-30T07:00:00.000Z",
      "2026-03-31T07:00:00.000Z",
    ]);
  });
  it("unfolds escaped text and preserves explicit instants and private description", () => {
    const [event] = parse(
      file(
        "UID:owned-a\r\nDTSTART:20260308T090000Z\r\nDTEND:20260308T100000Z\r\nSUMMARY:Ein langer\r\n  Titel\\, mit Text\r\nDESCRIPTION:Zeile 1\\nZeile 2",
      ),
    );
    expect(event).toMatchObject({
      title: "Ein langer Titel, mit Text",
      description: "Zeile 1\nZeile 2",
      starts_at: "2026-03-08T09:00:00.000Z",
      time_zone: "UTC",
    });
  });
  it("uses the chosen zone for floating appointments and exclusive all-day ends", () => {
    const events = parse(
      file(
        "UID:floating\r\nDTSTART:20260308T090000\r\nDTEND:20260308T100000",
        "UID:day\r\nDTSTART;VALUE=DATE:20260309\r\nDTEND;VALUE=DATE:20260310",
      ),
    );
    expect(events[0].starts_at).toBe("2026-03-08T08:00:00.000Z");
    expect(events[1].ends_at).toBe("2026-03-09T23:00:00.000Z");
  });
  it("materialises bounded recurrences across DST, exclusions and moved exceptions", () => {
    const events = parse(
      file(
        "UID:series\r\nDTSTART;TZID=Europe/Berlin:20260327T090000\r\nDTEND;TZID=Europe/Berlin:20260327T100000\r\nRRULE:FREQ=DAILY;COUNT=5\r\nEXDATE;TZID=Europe/Berlin:20260328T090000\r\nSUMMARY:Serie",
        "UID:series\r\nRECURRENCE-ID;TZID=Europe/Berlin:20260330T090000\r\nDTSTART;TZID=Europe/Berlin:20260330T120000\r\nDTEND;TZID=Europe/Berlin:20260330T130000\r\nSUMMARY:Verschoben",
      ),
    );
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.starts_at)).toEqual([
      "2026-03-27T08:00:00.000Z",
      "2026-03-29T07:00:00.000Z",
      "2026-03-30T10:00:00.000Z",
      "2026-03-31T07:00:00.000Z",
    ]);
    expect(events[2].title).toBe("Verschoben");
  });
  it("deduplicates UID/instant within one file and excludes cancelled events", () => {
    const a = "UID:twice\r\nDTSTART:20260308T090000Z\r\nDTEND:20260308T100000Z";
    expect(
      parse(
        file(
          a,
          a,
          "UID:cancelled\r\nDTSTART:20260309T090000Z\r\nDTEND:20260309T100000Z\r\nSTATUS:CANCELLED",
        ),
      ),
    ).toHaveLength(1);
  });
  it("bounds infinite rules to the selected window and rejects unsupported or malformed input", () => {
    expect(
      parse(
        file(
          "UID:forever\r\nDTSTART:20260301T090000Z\r\nDTEND:20260301T100000Z\r\nRRULE:FREQ=DAILY",
        ),
        "2026-03-01",
        "2026-03-03",
      ),
    ).toHaveLength(3);
    expect(() =>
      parse(
        file(
          "UID:bad\r\nDTSTART;TZID=Unknown/Zone:20260301T090000\r\nDTEND;TZID=Unknown/Zone:20260301T100000",
        ),
      ),
    ).toThrow("unsupported_zone");
    expect(() => parse("not calendar")).toThrow();
    expect(() =>
      parse(
        file("UID:bad\r\nDTSTART:20260301T100000Z\r\nDTEND:20260301T090000Z"),
      ),
    ).toThrow("invalid_time");
    expect(() =>
      parse(
        file("UID:bad\r\nDTSTART:20260301T100000Z\r\nDTEND:20260301T110000Z"),
        "2026-03-02",
        "2026-03-01",
      ),
    ).toThrow("invalid_window");
  });
});
