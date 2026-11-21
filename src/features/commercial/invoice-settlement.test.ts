/** Contract worksheet cases use fictional service days, compensation and client receipts. */
import { describe, expect, it } from "vitest";
import {
  calculateInvoiceSettlement,
  type SettlementUnit,
} from "./invoice-settlement";

const zone = "Europe/Berlin";

function teaching(patch: Partial<SettlementUnit> = {}): SettlementUnit {
  return {
    kind: "teaching",
    day: "2030-10-28",
    assessmentReference: "",
    reason: "delivered",
    agreedFee: "142.38",
    credited: "0",
    scheduled: "2030-10-28T09:00:00+01:00",
    receivedNotice: "2030-10-21T10:00:00+02:00",
    originalCustomerFee: "332.12",
    receivedCustomerCompensation: "166.06",
    ...patch,
  };
}

describe("invoice exception settlement worksheet", () => {
  it("uses elapsed hours across the autumn DST change for the exact notice deadline", () => {
    expect(
      calculateInvoiceSettlement([teaching({ reason: "timely" })], zone),
    ).toEqual({
      ok: true,
      deliveredCents: 0,
      cancellationCents: 0,
      nonTeachingCents: 0,
      creditedCents: 0,
      openCents: 0,
    });
    const laterReceipt = "2030-10-21T10:00:01+02:00";
    expect(
      calculateInvoiceSettlement(
        [teaching({ reason: "timely", receivedNotice: laterReceipt })],
        zone,
      ),
    ).toEqual({ ok: false, error: "noticeMismatch", row: 1 });
    expect(
      calculateInvoiceSettlement(
        [teaching({ reason: "shortNotice", receivedNotice: laterReceipt })],
        zone,
      ),
    ).toMatchObject({ ok: true, cancellationCents: 14238 });
    expect(
      calculateInvoiceSettlement([teaching({ reason: "shortNotice" })], zone),
    ).toEqual({ ok: false, error: "noticeMismatch", row: 1 });
  });

  it("keeps the delivered fee, cancellation amounts and previously credited sums separate", () => {
    const units = [
      teaching({ credited: "45,33" }),
      teaching({
        day: "2030-10-29",
        reason: "customer",
        agreedFee: "142.37",
        credited: "28.47",
      }),
      teaching({
        day: "2030-10-30",
        reason: "customer",
        receivedCustomerCompensation: "0",
      }),
    ];
    expect(calculateInvoiceSettlement(units, zone)).toEqual({
      ok: true,
      deliveredCents: 14238,
      cancellationCents: 7119,
      nonTeachingCents: 0,
      creditedCents: 7380,
      openCents: 13977,
    });
  });

  it("pays only the documented share for a non-teaching day and excludes excused unfunded service", () => {
    const holiday = teaching({
      kind: "nonTeaching",
      reason: "customerNonTeaching",
      day: "2030-10-29",
      agreedFee: "200",
      originalCustomerFee: "400",
      receivedCustomerCompensation: "300",
      credited: "50",
    });
    const excused = teaching({ day: "2030-10-30", reason: "excused" });
    expect(
      calculateInvoiceSettlement([teaching(), holiday, excused], zone),
    ).toEqual({
      ok: true,
      deliveredCents: 14238,
      cancellationCents: 0,
      nonTeachingCents: 15000,
      creditedCents: 5000,
      openCents: 24238,
    });
    expect(
      calculateInvoiceSettlement(
        [
          {
            ...holiday,
            credited: "0",
            originalCustomerFee: "",
            receivedCustomerCompensation: "0",
          },
        ],
        zone,
      ),
    ).toMatchObject({ ok: true, openCents: 0 });
    expect(
      calculateInvoiceSettlement(
        [
          {
            ...holiday,
            originalCustomerFee: "",
          },
        ],
        zone,
      ),
    ).toEqual({ ok: false, error: "customerAmountsInvalid", row: 1 });
  });

  it("checks the recorded unit type and blocks double use of non-teaching dates", () => {
    const holiday = teaching({
      kind: "nonTeaching",
      reason: "customerNonTeaching",
    });
    const cancellation = teaching({ reason: "customer" });
    for (const rows of [
      [cancellation, holiday],
      [holiday, cancellation],
      [holiday, holiday],
    ]) {
      expect(calculateInvoiceSettlement(rows, zone)).toEqual({
        ok: false,
        error: "duplicateUnit",
        row: 2,
      });
    }
    expect(
      calculateInvoiceSettlement([{ ...holiday, reason: "delivered" }], zone),
    ).toEqual({ ok: false, error: "manualRequired", row: 1 });
  });

  it("counts one teaching date and a separate agreed assessment but rejects duplicate entries", () => {
    const assessment = teaching({
      kind: "assessment",
      assessmentReference: "Assessment A",
    });
    expect(
      calculateInvoiceSettlement([teaching(), assessment], zone),
    ).toMatchObject({ ok: true, openCents: 28476 });
    expect(calculateInvoiceSettlement([teaching(), teaching()], zone)).toEqual({
      ok: false,
      error: "duplicateUnit",
      row: 2,
    });
    expect(
      calculateInvoiceSettlement(
        [
          assessment,
          {
            ...assessment,
            day: "2030-10-29",
            assessmentReference: " assessment a ",
          },
        ],
        zone,
      ),
    ).toEqual({ ok: false, error: "duplicateUnit", row: 2 });
    expect(
      calculateInvoiceSettlement(
        [{ ...assessment, assessmentReference: "" }],
        zone,
      ),
    ).toEqual({ ok: false, error: "manualRequired", row: 1 });
  });

  it("requires an offset, valid date and matching service date in the accepted zone", () => {
    expect(calculateInvoiceSettlement([teaching()], "Not/AZone")).toEqual({
      ok: false,
      error: "zoneInvalid",
    });
    expect(calculateInvoiceSettlement([], zone)).toEqual({
      ok: false,
      error: "unitsInvalid",
    });
    expect(
      calculateInvoiceSettlement([teaching({ day: "2030-02-29" })], zone),
    ).toEqual({ ok: false, error: "dayInvalid", row: 1 });
    expect(
      calculateInvoiceSettlement(
        [teaching({ reason: "timely", receivedNotice: "2030-10-21T10:00" })],
        zone,
      ),
    ).toEqual({ ok: false, error: "noticeInvalid", row: 1 });
    expect(
      calculateInvoiceSettlement(
        [teaching({ reason: "timely", day: "2030-10-29" })],
        zone,
      ),
    ).toEqual({ ok: false, error: "noticeInvalid", row: 1 });
    expect(
      calculateInvoiceSettlement(
        [
          teaching({
            reason: "shortNotice",
            receivedNotice: "2030-10-28T10:00:00+01:00",
          }),
        ],
        zone,
      ),
    ).toEqual({ ok: false, error: "noticeInvalid", row: 1 });
  });

  it("blocks unsupported amounts and arbitrary entitlement for a manual case", () => {
    expect(
      calculateInvoiceSettlement(
        [teaching(), teaching({ day: "2030-10-29", reason: "manual" })],
        zone,
      ),
    ).toEqual({ ok: false, error: "manualRequired", row: 2 });
    expect(
      calculateInvoiceSettlement([teaching({ agreedFee: "18.435" })], zone),
    ).toEqual({ ok: false, error: "amountInvalid", row: 1 });
    expect(
      calculateInvoiceSettlement(
        [teaching({ reason: "customer", originalCustomerFee: "0" })],
        zone,
      ),
    ).toEqual({ ok: false, error: "customerAmountsInvalid", row: 1 });
    expect(
      calculateInvoiceSettlement(
        [teaching({ reason: "customer", receivedCustomerCompensation: "400" })],
        zone,
      ),
    ).toEqual({ ok: false, error: "customerAmountsInvalid", row: 1 });
    expect(
      calculateInvoiceSettlement([teaching({ credited: "142.39" })], zone),
    ).toEqual({ ok: false, error: "excessCredit", row: 1 });
  });
});
