/** Verify dates at the invoice boundary without relying on the machine time zone. */
import { describe, expect, it } from "vitest";
import { resolveInvoiceDueDate } from "./invoice-submission";

describe("invoice payment term", () => {
  it.each([
    ["2024-01-30", "2024-02-29"],
    ["2025-01-30", "2025-03-01"],
    ["2026-03-15", "2026-04-14"],
    ["2026-12-20", "2027-01-19"],
  ])("adds 30 calendar days to %s", (issue, expected) => {
    expect(resolveInvoiceDueDate(issue, "")).toBe(expected);
  });

  it.each([
    ["2025-02-29", ""],
    ["2026-05-01", "2026-04-30"],
    ["2026-05-01", "2026-05-32"],
    ["2026-05-01T00:00:00Z", ""],
    ["0000-05-01", ""],
    ["9999-12-31", ""],
  ])("rejects invalid dates %s and %s", (issue, due) => {
    expect(resolveInvoiceDueDate(issue, due)).toBeNull();
  });

  it("keeps a valid agreed date, including payment due on issue", () => {
    expect(resolveInvoiceDueDate("2026-05-01", "2026-05-01")).toBe(
      "2026-05-01",
    );
    expect(resolveInvoiceDueDate("2026-05-01", "2026-07-01")).toBe(
      "2026-07-01",
    );
  });
});
