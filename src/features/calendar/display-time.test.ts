/** Test offset labels against exact instants around the European DST fold. */
import { DateTime } from "luxon";
import { expect, it, vi } from "vitest";
import { calendarEventTimeLabels, calendarFoldLabel } from "./display-time";

it("shows both source offsets when the time moves backwards during an event", () => {
  expect(
    calendarFoldLabel(
      "2030-10-27T00:30:00Z",
      "2030-10-27T01:15:00Z",
      "Europe/Berlin",
      "de",
    ),
  ).toBe("02:30 UTC+02:00 – 02:15 UTC+01:00");
});

it("distinguishes the two occurrences of 02:30 in the same zone", () => {
  expect(
    calendarFoldLabel(
      "2030-10-27T01:30:00Z",
      "2030-10-27T02:15:00Z",
      "Europe/Berlin",
      "en-GB",
    ),
  ).toBe("02:30 UTC+01:00 – 03:15 UTC+01:00");
});

it.each(["UTC", "Australia/Brisbane"])(
  "leaves ordinary time rendering in %s alone",
  (zone) => {
    expect(
      calendarFoldLabel(
        "2030-10-27T00:30:00Z",
        "2030-10-27T01:15:00Z",
        zone,
        "en",
      ),
    ).toBeUndefined();
  },
);

it("only resolves offsets once per event and uses fresh labels for another zone", () => {
  const sources = new Map([
    [
      "ordinary",
      { start: "2030-10-28T08:00:00Z", end: "2030-10-28T09:00:00Z" },
    ],
    ["fold", { start: "2030-10-27T00:30:00Z", end: "2030-10-27T01:15:00Z" }],
  ]);
  const offsets = vi.spyOn(DateTime.prototype, "getPossibleOffsets");
  try {
    const berlin = calendarEventTimeLabels(sources, "Europe/Berlin", "de");
    expect(berlin("ordinary")).toBeUndefined();
    expect(berlin("fold")).toBe("02:30 UTC+02:00 – 02:15 UTC+01:00");
    const initialCalls = offsets.mock.calls.length;
    expect(initialCalls).toBeGreaterThan(0);
    for (let render = 0; render < 10; render++) {
      expect(berlin("ordinary")).toBeUndefined();
      expect(berlin("fold")).toBe("02:30 UTC+02:00 – 02:15 UTC+01:00");
    }
    expect(offsets).toHaveBeenCalledTimes(initialCalls);
    expect(
      calendarEventTimeLabels(sources, "UTC", "de")("fold"),
    ).toBeUndefined();
  } finally {
    offsets.mockRestore();
  }
});
