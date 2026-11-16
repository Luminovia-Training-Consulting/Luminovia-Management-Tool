/**
 * Vitest-Regressionen für zeitlich begrenzte Auditfenster mit echten zonierten Datumsgrenzen. Lokale SDK-/DOM-Fixtures isolieren den Browservertrag; echte Datenbank-/API-Abnahme bleibt Teil des separaten Gesamtprüflaufs.
 */
import { describe, expect, it } from "vitest";
import { auditEventsQuery, auditRange } from "./api";

describe("bounded audit query dates and actor scoping", () => {
  it("preserves a 93-calendar-day Berlin window across DST rollback", () => {
    const range = auditRange("2026-08-01", "2026-11-01", "Europe/Berlin");
    expect(range).toEqual({
      from: "2026-07-31T22:00:00.000Z",
      to: "2026-11-01T23:00:00.000Z",
    });
    expect(Date.parse(range!.to) - Date.parse(range!.from)).toBe(
      93 * 86400000 + 3600000,
    );
  });
  it("rejects oversized, reversed, invalid and skipped local dates", () => {
    for (const [from, to, zone] of [
      ["2026-01-01", "2026-04-04", "UTC"],
      ["2026-01-02", "2026-01-01", "UTC"],
      ["2026-02-30", "2026-03-01", "UTC"],
      ["2026-01-01", "2026-01-02", "Invalid/Zone"],
      ["2011-12-30", "2011-12-30", "Pacific/Apia"],
    ])
      expect(auditRange(from, to, zone)).toBeNull();
  });
  it("isolates account, filters and cursor keys without background polling", () => {
    const filter = {
      from: "2026-01-01T00:00:00Z",
      to: "2026-01-02T00:00:00Z",
      action: "",
      search: "",
      zone: "UTC",
    };
    expect(auditEventsQuery("a", filter, null).queryKey).not.toEqual(
      auditEventsQuery("b", filter, null).queryKey,
    );
    expect(auditEventsQuery("a", filter, null).queryKey).not.toEqual(
      auditEventsQuery("a", filter, { at: filter.from, id: "row" }).queryKey,
    );
    expect(auditEventsQuery("a", filter, null).retry).toBe(false);
    expect(auditEventsQuery("a", filter, null).staleTime).toBe(0);
  });
});
