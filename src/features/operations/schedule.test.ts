/**
 * Vitest-Regressionen für Wochentagserzeugung und ungültige Datum-/Uhrzeit-/Tageszahlangaben. SDK-/DOM-Fixtures isolieren den Browservertrag; echte RLS-, Auth-, Storage- und Browserabnahme bleibt Teil des separaten Gesamtprüflaufs.
 */
import { describe, it, expect } from "vitest";
import { weekdaySessions } from "./schedule";
import { zonedInstant } from "../../lib/dates";
describe("CBW weekday planning", () => {
  it("generates the complete ten-day block across weekends without changing local daily times", () => {
    const sessions = weekdaySessions("2027-03-26", "09:00", "17:00", 10);
    expect(sessions).toHaveLength(10);
    expect(sessions[0]).toEqual({
      starts_at: "2027-03-26T09:00",
      ends_at: "2027-03-26T17:00",
    });
    expect(sessions[1]).toEqual({
      starts_at: "2027-03-29T09:00",
      ends_at: "2027-03-29T17:00",
    });
    expect(zonedInstant(sessions[0].starts_at, "Europe/Berlin")).toBe(
      "2027-03-26T08:00:00.000Z",
    );
    expect(zonedInstant(sessions[1].starts_at, "Europe/Berlin")).toBe(
      "2027-03-29T07:00:00.000Z",
    );
    expect(new Set(sessions.map((session) => session.starts_at)).size).toBe(10);
  });
  it("moves an explicit weekend start to Monday but leaves holiday review to the planner", () => {
    expect(
      weekdaySessions("2027-03-27", "08:30", "14:30", 1)[0].starts_at,
    ).toBe("2027-03-29T08:30");
    expect(
      weekdaySessions("2026-12-24", "09:00", "15:00", 2)[1].starts_at,
    ).toBe("2026-12-25T09:00");
  });
  it("rejects invalid calendar dates, reversed times and unbounded block lengths", () => {
    const invalid: Parameters<typeof weekdaySessions>[] = [
      ["2027-02-30", "09:00", "17:00", 10],
      ["2027-03-26T09:00", "09:00", "17:00", 10],
      ["2027-03-26", "25:00", "17:00", 10],
      ["2027-03-26", "09:00", "08:00", 10],
      ["2027-03-26", "09:00", "09:00", 10],
      ["2027-03-26", "09:00", "17:00", 0],
      ["2027-03-26", "09:00", "17:00", 61],
      ["2027-03-26", "09:00", "17:00", 1.5],
    ];
    for (const args of invalid)
      expect(() => weekdaySessions(...args)).toThrow("invalid_schedule");
  });
});
