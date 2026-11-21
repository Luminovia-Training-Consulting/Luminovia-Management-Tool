/** Test offset labels against exact instants around the European DST fold. */
import { expect, it } from "vitest";
import { calendarFoldLabel } from "./display-time";

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
