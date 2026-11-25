/**
 * Regressions for Berlin/Brisbane zones, DST gaps and ambiguous local times. Pure date tests do
 * not establish database scheduling behavior.
 */
import { describe, expect, it, vi } from "vitest";
import {
  dateTime,
  formatUtcDate,
  money,
  resolveScheduleWindow,
  validZone,
  zonedInstant,
  zonedInstantForEdit,
  zonedInstantForScheduleEdit,
} from "./dates";

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

it("formats ledger dates in UTC instead of the device or recorded offset", () => {
  expect(formatUtcDate("2026-11-23T06:00:00+10:00", "en-US")).toBe(
    "Nov 22, 2026",
  );
  expect(formatUtcDate("2026-11-23", "de-DE")).toBe("23. Nov. 2026");
});

it("preserves an exact saved instant only for the same displayed minute and zone", () => {
  const original = "2026-10-25T02:30:37.123456+01:00";
  const berlin = "Europe/Berlin";
  const brisbane = "Australia/Brisbane";
  expect(
    zonedInstantForScheduleEdit("2026-10-25T02:30", berlin, original, berlin),
  ).toBe(original);
  expect(
    zonedInstantForScheduleEdit("2026-10-25T02:31", berlin, original, berlin),
  ).toBeNull();
  expect(
    zonedInstantForScheduleEdit("2026-10-25T02:30", brisbane, original, berlin),
  ).toBe("2026-10-24T16:30:00.000Z");
  expect(
    zonedInstantForScheduleEdit("2026-10-25T04:00", berlin, "invalid", berlin),
  ).toBe("2026-10-25T03:00:00.000Z");
  expect(zonedInstantForScheduleEdit("2026-10-25T02:30", berlin)).toBeNull();
});

it("requires a positive published window with valid endpoints", () => {
  const window = {
    starts_at: "2026-11-23T09:00",
    ends_at: "2026-11-23T10:30",
    time_zone: "Australia/Brisbane",
  };
  expect(resolveScheduleWindow(window)).toEqual({
    starts_at: "2026-11-22T23:00:00.000Z",
    ends_at: "2026-11-23T00:30:00.000Z",
  });
  expect(resolveScheduleWindow({ ...window, starts_at: "invalid" })).toBeNull();
  expect(resolveScheduleWindow({ ...window, ends_at: "invalid" })).toBeNull();
  expect(
    resolveScheduleWindow({ ...window, ends_at: window.starts_at }),
  ).toBeNull();
});

it("reuses the exact display formatter across long lists and varies it by language, zone and style", () => {
  const constructor = vi.spyOn(Intl, "DateTimeFormat");
  try {
    const fixtures = [
      ["en-NZ", "Pacific/Auckland", "short"],
      ["en-NZ", "Pacific/Auckland", "medium"],
      ["en-NZ", "America/Sao_Paulo", "short"],
      ["fr", "Pacific/Auckland", "short"],
    ] as const;
    const instant = "2027-01-18T20:00:00Z";
    const result = fixtures.map(([language, zone, style]) =>
      dateTime(instant, language, zone, style),
    );
    expect(new Set(result).size).toBe(fixtures.length);
    for (let index = 0; index < 400; index++)
      expect(
        fixtures.map(([language, zone, style]) =>
          dateTime(instant, language, zone, style),
        ),
      ).toEqual(result);
    expect(constructor).toHaveBeenCalledTimes(fixtures.length);
  } finally {
    constructor.mockRestore();
  }
});

it("bounds the formatter cache as the display locale changes", () => {
  const instant = "2027-01-18T20:00:00Z";
  const oldest = "en-x-test-oldest";
  const format = (locale: string) => dateTime(instant, locale, "UTC");
  const original = format(oldest);
  for (let index = 0; index < 32; index++) format(`en-x-test-${index}`);
  const constructor = vi.spyOn(Intl, "DateTimeFormat");
  try {
    expect(format(oldest)).toBe(original);
    expect(constructor).toHaveBeenCalledTimes(1);
    expect(format(oldest)).toBe(original);
    expect(constructor).toHaveBeenCalledTimes(1);
  } finally {
    constructor.mockRestore();
  }
});

it("reuses currency formatters across rows while retaining locale and currency", () => {
  const formats = [
    ["CAD", "en-CA"],
    ["EUR", "en-CA"],
    ["EUR", "fr-CA"],
  ] as const;
  const amount = -1234.5;
  const expected = formats.map(([currency, language]) =>
    new Intl.NumberFormat(language, { style: "currency", currency }).format(
      amount,
    ),
  );
  const constructor = vi.spyOn(Intl, "NumberFormat");
  try {
    for (let index = 0; index < 500; index++)
      expect(
        formats.map(([currency, language]) =>
          money(amount, currency, language),
        ),
      ).toEqual(expected);
    expect(constructor).toHaveBeenCalledTimes(3);
  } finally {
    constructor.mockRestore();
  }
});

it("bounds the currency formatter cache as the display locale changes", () => {
  const oldest = "en-x-test-oldest";
  const format = (locale: string) => money(1, "CAD", locale);
  const original = format(oldest);
  for (let index = 0; index < 32; index++) format(`en-x-test-money-${index}`);
  const constructor = vi.spyOn(Intl, "NumberFormat");
  try {
    expect(format(oldest)).toBe(original);
    expect(constructor).toHaveBeenCalledTimes(1);
    expect(format(oldest)).toBe(original);
    expect(constructor).toHaveBeenCalledTimes(1);
  } finally {
    constructor.mockRestore();
  }
});

it("accepts an IANA display zone and rejects an invalid zone", () => {
  expect(validZone("Europe/Berlin")).toBe(true);
  expect(validZone("Invalid/Zone")).toBe(false);
});

it("reuses currency formatters without mixing currencies or languages", () => {
  const native = Intl.NumberFormat;
  const fixtures = [
    ["de-CH", "CHF"],
    ["de-CH", "EUR"],
    ["en-AU", "CHF"],
  ] as const;
  const expected = fixtures.map(([language, currency]) =>
    new native(language, { style: "currency", currency }).format(-1234.56),
  );
  const constructor = vi.spyOn(Intl, "NumberFormat");
  try {
    for (let index = 0; index < 50; index++)
      expect(
        fixtures.map(([language, currency]) =>
          money(-1234.56, currency, language),
        ),
      ).toEqual(expected);
    expect(constructor).toHaveBeenCalledTimes(fixtures.length);
  } finally {
    constructor.mockRestore();
  }
});
