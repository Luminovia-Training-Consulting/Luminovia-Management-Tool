/** Cover calendar arithmetic and the framework's earlier final payment rule. */
import { expect, it } from "vitest";
import { frameworkPaymentDates } from "./framework-payment-dates";

it.each(["2026-10-29", "2026-10-30"])(
  "uses only the final deadline when it falls on or before the interim deadline (%s)",
  (last) => {
    expect(frameworkPaymentDates("2026-10-14", last, "", "")).toMatchObject({
      final: last === "2026-10-29" ? "2026-11-12" : "2026-11-13",
      interim: null,
    });
  },
);

it("shows both dates for a longer assignment and computes both cancellation deadlines independently", () => {
  expect(
    frameworkPaymentDates(
      "2026-10-14",
      "2026-11-04",
      "2026-12-20",
      "2024-01-30",
    ),
  ).toEqual({
    validOrder: true,
    interim: "2026-11-13",
    final: "2026-11-18",
    customer: "2027-01-03",
    shortNotice: "2024-02-29",
  });
});

it("validates the service-date order without blocking a separate customer receipt", () => {
  expect(
    frameworkPaymentDates(
      "2026-11-04",
      "2026-11-03",
      "2026-11-05",
      "2026-02-29",
    ),
  ).toEqual({
    validOrder: false,
    interim: null,
    final: null,
    customer: "2026-11-19",
    shortNotice: null,
  });
});

it("waits for both verified service dates and rejects out-of-range results", () => {
  expect(
    frameworkPaymentDates("", "2026-11-03", "9999-12-31", "0000-01-01"),
  ).toEqual({
    validOrder: true,
    interim: null,
    final: null,
    customer: null,
    shortNotice: null,
  });
});
