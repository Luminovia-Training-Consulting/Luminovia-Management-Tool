/** Review only: calculate lecturer-side amounts using confirmed assignment evidence. */
import { DateTime } from "luxon";
import { validZone } from "../../lib/dates";

const minimumNoticeMs = 168 * 60 * 60 * 1000;
export const maximumSettlementUnits = 60;
export const settlementReasons = [
  "delivered",
  "timely",
  "shortNotice",
  "customer",
  "excused",
  "manual",
] as const;
export const nonTeachingSettlementReasons = [
  "customerNonTeaching",
  "manual",
] as const;

type SettlementReason =
  | (typeof settlementReasons)[number]
  | (typeof nonTeachingSettlementReasons)[number];

export type SettlementUnit = {
  kind: "teaching" | "assessment" | "nonTeaching";
  day: string;
  assessmentReference: string;
  reason: SettlementReason | "";
  agreedFee: string;
  credited: string;
  scheduled: string;
  receivedNotice: string;
  originalCustomerFee: string;
  receivedCustomerCompensation: string;
};

/** Parse nonnegative monetary input without binary floating point rounding. */
function cents(value: string): number | null {
  const parts = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!parts) return null;
  return Number(parts[1]) * 100 + Number((parts[2] ?? "").padEnd(2, "0"));
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

/** Require explicit offsets for elapsed notice time, including a repeated DST hour. */
function instant(value: string): DateTime | null {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value.trim(),
    )
  )
    return null;
  const time = DateTime.fromISO(value.trim(), { setZone: true });
  return time.isValid ? time : null;
}

type SettlementError =
  | "zoneInvalid"
  | "unitsInvalid"
  | "dayInvalid"
  | "duplicateUnit"
  | "manualRequired"
  | "amountInvalid"
  | "noticeInvalid"
  | "noticeMismatch"
  | "customerAmountsInvalid"
  | "excessCredit";

type SettlementResult =
  | { ok: false; error: SettlementError; row?: number }
  | {
      ok: true;
      deliveredCents: number;
      cancellationCents: number;
      nonTeachingCents: number;
      creditedCents: number;
      openCents: number;
    };

/** Round the cumulative customer ratio result to the nearest cent for one payable unit. */
function customerShare(agreed: number, received: number, original: number) {
  const numerator = 2n * BigInt(agreed) * BigInt(received) + BigInt(original);
  return Number(numerator / (2n * BigInt(original)));
}

/** Evaluate one paid service date or specifically agreed assessment per row. */
function calculateUnit(unit: SettlementUnit, zone: string) {
  if (unit.reason === "manual" || unit.reason === "")
    return { error: "manualRequired" } as const;
  if ((unit.reason === "customerNonTeaching") !== (unit.kind === "nonTeaching"))
    return { error: "manualRequired" } as const;
  const agreed = cents(unit.agreedFee);
  const credit = cents(unit.credited);
  if (agreed === null || agreed === 0 || credit === null)
    return { error: "amountInvalid" } as const;
  let entitlement: number = agreed;
  if (unit.reason === "timely" || unit.reason === "shortNotice") {
    const start = instant(unit.scheduled);
    const notice = instant(unit.receivedNotice);
    if (
      !start ||
      !notice ||
      notice.toMillis() > start.toMillis() ||
      start.setZone(zone).toISODate() !== unit.day
    )
      return { error: "noticeInvalid" } as const;
    const timely = start.toMillis() - notice.toMillis() >= minimumNoticeMs;
    if (timely !== (unit.reason === "timely"))
      return { error: "noticeMismatch" } as const;
    if (timely) entitlement = 0;
  } else if (
    unit.reason === "customer" ||
    unit.reason === "customerNonTeaching"
  ) {
    const original = cents(unit.originalCustomerFee);
    const received = cents(unit.receivedCustomerCompensation);
    if (
      received === 0 &&
      (original !== null || !unit.originalCustomerFee.trim())
    )
      entitlement = 0;
    else if (!original || received === null || received > original)
      return { error: "customerAmountsInvalid" } as const;
    else entitlement = customerShare(agreed, received, original);
  } else if (unit.reason === "excused") {
    entitlement = 0;
  }
  if (credit > entitlement) return { error: "excessCredit" } as const;
  return { entitlement, credit };
}

/** Return worksheet totals or the first item that needs a correction or individual review. */
export function calculateInvoiceSettlement(
  units: SettlementUnit[],
  zone: string,
): SettlementResult {
  if (!validZone(zone)) return { ok: false, error: "zoneInvalid" };
  if (!units.length || units.length > maximumSettlementUnits)
    return { ok: false, error: "unitsInvalid" };
  const reviewed = new Set<string>();
  const serviceDates = new Set<string>();
  const nonTeachingDates = new Set<string>();
  let deliveredCents = 0;
  let cancellationCents = 0;
  let nonTeachingCents = 0;
  let creditedCents = 0;
  for (const [index, unit] of units.entries()) {
    const row = index + 1;
    if (
      !datePattern.test(unit.day) ||
      DateTime.fromISO(unit.day, { zone }).toISODate() !== unit.day
    )
      return { ok: false, error: "dayInvalid", row };
    const reference = unit.assessmentReference.trim().toLowerCase();
    const identity =
      unit.kind === "assessment"
        ? `assessment:${reference}`
        : `${unit.kind}:${unit.day}`;
    if (unit.kind === "assessment" && !reference)
      return { ok: false, error: "manualRequired", row };
    // A date booked as non-teaching cannot also be used to calculate earned
    // service or cancellation compensation for the same calendar date.
    if (
      reviewed.has(identity) ||
      nonTeachingDates.has(unit.day) ||
      (unit.kind === "nonTeaching" && serviceDates.has(unit.day))
    )
      return { ok: false, error: "duplicateUnit", row };
    reviewed.add(identity);
    if (unit.kind === "nonTeaching") nonTeachingDates.add(unit.day);
    else serviceDates.add(unit.day);
    const result = calculateUnit(unit, zone);
    if (result.error) return { ok: false, error: result.error, row };
    if (unit.reason === "delivered") deliveredCents += result.entitlement;
    else if (unit.reason === "customerNonTeaching")
      nonTeachingCents += result.entitlement;
    else cancellationCents += result.entitlement;
    creditedCents += result.credit;
  }
  return {
    ok: true,
    deliveredCents,
    cancellationCents,
    nonTeachingCents,
    creditedCents,
    openCents:
      deliveredCents + cancellationCents + nonTeachingCents - creditedCents,
  };
}
