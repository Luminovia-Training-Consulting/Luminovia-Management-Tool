/**
 * Regressions for formula-safe CSV cells and cent-based totals separated by original currency.
 * Pure export/aggregation tests do not establish commercial API authorization.
 */
import { describe, expect, it } from "vitest";
import { csvCell, csvText, groupedEarnings } from "./api";
import type { EarningRecord } from "./types";
/** Create a small fictional fee row for currency/status aggregation cases. */
function row(
  currency: "EUR" | "AUD",
  total_amount: number,
  stage: EarningRecord["stage"],
): EarningRecord {
  return {
    claim_id: crypto.randomUUID(),
    job_id: "job",
    lecturer_id: "lecturer",
    lecturer_name: "QA",
    title: "Fictional",
    customer_name: "QA",
    starts_at: "2030-01-01T10:00:00Z",
    ends_at: "2030-01-01T11:00:00Z",
    amount: total_amount,
    rate_unit: "flat",
    total_amount,
    currency,
    stage,
    invoice_id: null,
  };
}
describe("scoped commercial exports and totals", () => {
  it("neutralizes formulas including leading whitespace and control characters", () => {
    for (const value of [
      "=1+1",
      "+SUM(A1)",
      "-2+3",
      "@SUM(A1)",
      '  =HYPERLINK("https://example.invalid")',
      "\t=1",
      "\r+1",
    ])
      expect(csvCell(value)).toMatch(/^"'/);
    expect(csvCell("=x\r\ny\tz")).toBe('"\'=x  y z"');
  });
  it("quotes commas and quotes without changing ordinary authored content", () => {
    expect(csvCell('Kurs, "Python"')).toBe('"Kurs, ""Python"""');
    expect(
      csvText([
        ["Währung", "Betrag"],
        ["EUR", 12.5],
      ]),
    ).toBe('\uFEFF"Währung","Betrag"\r\n"EUR","12.5"');
  });
  it("keeps original currencies and stages separate with cent arithmetic", () => {
    expect(
      groupedEarnings([
        row("EUR", 0.1, "expected"),
        row("AUD", 900, "expected"),
        row("EUR", 0.2, "expected"),
        row("EUR", 12.34, "paid"),
        row("AUD", 20, "invoiced"),
      ]),
    ).toEqual([
      {
        currency: "EUR",
        expected: 0.3,
        completed: 0,
        invoiced: 0,
        paid: 12.34,
      },
      { currency: "AUD", expected: 900, completed: 0, invoiced: 20, paid: 0 },
    ]);
  });
});
