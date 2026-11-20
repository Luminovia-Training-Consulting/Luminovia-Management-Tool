/**
 * Regressions for Berlin/Brisbane zones, DST gaps and ambiguous local times. Pure date tests do
 * not establish database scheduling behavior.
 */
import {describe, expect, it} from "vitest";
import {dateTime, money, zonedInstant, zonedInstantForEdit} from "./dates";

describe("calendar instants and DST safety", () => {
    it("maps the same Berlin teaching time across winter and summer offsets", () => {
        expect(zonedInstant("2027-01-18T09:00", "Europe/Berlin")).toBe(
            "2027-01-18T08:00:00.000Z",
        );
        expect(zonedInstant("2027-07-19T09:00", "Europe/Berlin")).toBe(
            "2027-07-19T07:00:00.000Z",
        );
    });
    it("uses Brisbane UTC+10 without a seasonal offset", () => {
        expect(zonedInstant("2027-01-18T09:00", "Australia/Brisbane")).toBe(
            "2027-01-17T23:00:00.000Z",
        );
        expect(zonedInstant("2027-07-19T09:00", "Australia/Brisbane")).toBe(
            "2027-07-18T23:00:00.000Z",
        );
    });
    it("rejects nonexistent spring-forward times instead of normalising", () => {
        expect(zonedInstant("2027-03-28T02:30", "Europe/Berlin")).toBeNull();
    });
    it("rejects ambiguous fall-back times rather than choosing an offset silently", () => {
        expect(zonedInstant("2027-10-31T02:30", "Europe/Berlin")).toBeNull();
    });
    it("preserves an unchanged ambiguous deadline's exact instant while keeping edits strict", () => {
        const original = "2026-10-25T00:30:00Z";
        expect(
            zonedInstantForEdit(
                "2026-10-25T02:30",
                "Europe/Berlin",
                "2026-10-25T02:30",
                original,
            ),
        ).toBe(original);
        expect(
            zonedInstantForEdit(
                "2026-10-25T02:45",
                "Europe/Berlin",
                "2026-10-25T02:30",
                original,
            ),
        ).toBeNull();
        expect(
            zonedInstantForEdit("", "Europe/Berlin", "2026-10-25T02:30", original),
        ).toBeNull();
    });
    it("rejects invalid zones and dates", () => {
        expect(zonedInstant("2027-02-31T09:00", "Europe/Berlin")).toBeNull();
        expect(zonedInstant("2027-01-18T09:00", "Invalid/Zone")).toBeNull();
    });
    it("formats original currencies and local time without changing the instant", () => {
        expect(money(2000, "EUR", "de")).toContain("2.000,00");
        expect(money(2000, "AUD", "en")).toContain("2,000.00");
        expect(
            dateTime("2027-01-18T08:00:00Z", "de", "Australia/Brisbane"),
        ).toContain("18:00");
    });
});