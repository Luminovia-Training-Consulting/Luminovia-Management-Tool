/** Calculate receipt dates only when the reviewer has confirmed the framework applies. */
import { DateTime } from "luxon";

function calendarDeadline(base: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base) || base.startsWith("0000")) return null;
  // The inputs are dates in the agreed zone, so the calendar calculation is
  // independent of machine zone, clock changes, weekends and time of receipt.
  const due = DateTime.fromISO(base, { zone: "UTC" }).plus({ days });
  return due.isValid && due.year <= 9999 ? due.toISODate() : null;
}

export function frameworkPaymentDates(
  firstDelivered: string,
  lastAgreed: string,
  customerReceipt: string,
  correctInvoice: string,
) {
  const possibleInterim = calendarDeadline(firstDelivered, 30);
  const validOrder =
    !firstDelivered || !lastAgreed || firstDelivered <= lastAgreed;
  const final =
    validOrder && possibleInterim ? calendarDeadline(lastAgreed, 14) : null;
  return {
    validOrder,
    final,
    interim:
      final && possibleInterim && possibleInterim < final
        ? possibleInterim
        : null,
    customer: calendarDeadline(customerReceipt, 14),
    shortNotice: calendarDeadline(correctInvoice, 30),
  };
}
