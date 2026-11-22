/** Resolve the calendar dates sent to the invoice confirmation RPC. */
import { DateTime } from "luxon";

function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000"))
    return null;
  const date = DateTime.fromISO(value, { zone: "UTC" });
  return date.isValid ? date : null;
}

/** Use 30 calendar days from issue when the lecturer leaves the due date blank. */
export function resolveInvoiceDueDate(issue: string, due: string) {
  const issued = calendarDate(issue);
  if (!issued) return null;
  const resolved = due ? calendarDate(due) : issued.plus({ days: 30 });
  if (!resolved || resolved < issued || resolved.year > 9999) return null;
  return resolved.toISODate();
}

/** Parse the invoice forms' decimal input into original-currency cents. */
export function parseInvoiceAmountCents(input: string): number | null {
  const amount = input.trim().replace(",", ".");
  return /^\d{1,10}(?:\.\d{1,2})?$/.test(amount)
    ? Math.round(Number(amount) * 100)
    : null;
}
