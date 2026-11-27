/** Settle across multiple assignments without mixing currencies or spreadsheet formulas. */
import { expect, it } from "vitest";
import { assignmentFinanceCsv } from "./assignment-finance-export-file";
import { assignmentFinanceExportSchema } from "./assignment-finance-schema";

it("puts exact amounts in separate records and escapes author-supplied text", () => {
  const amount = {
    currency: "EUR",
    claim_status: "confirmed",
    agreed_lecturer: "120.30",
    adjustment_lecturer: "-2.05",
    agreed_customer: null,
    contract_margin: null,
    approved_timesheet_minutes: 15,
    recorded_teaching_minutes: 20,
    delivered_minutes: 25,
    lecturer_invoices: [
      {
        id: "99999999-0000-4000-8000-000000000001",
        number: "@fixture",
        state: "paid",
        amount: "88.20",
      },
    ],
    lecturer_invoiced: "88.20",
    lecturer_paid: "88.20",
    lecturer_outstanding: "0.00",
    cancellation_compensation: null,
    customer_invoice_number: "#AUD",
    customer_invoice_grouped: true,
    customer_invoiced: null,
    customer_net_invoiced: null,
    customer_received: null,
    customer_retained: null,
    customer_outstanding: null,
    expenses: [
      { currency: "CHF", approved: "1.10", paid: "0.00", outstanding: "1.10" },
    ],
  };
  const report = assignmentFinanceExportSchema.parse({
    schema_version: 1,
    from: "2026-06-08",
    through: "2026-06-09",
    time_zone: "Australia/Brisbane",
    generated_at: "2026-06-09T12:00:00Z",
    assignments: [
      {
        claim_id: "99999999-0000-4000-8000-000000000002",
        job_id: "99999999-0000-4000-8000-000000000003",
        title: '=Formula,"quoted"',
        lecturer_name: "Fictional\nlecturer",
        customer_name: "Fictional school",
        finance: amount,
      },
      {
        claim_id: "99999999-0000-4000-8000-000000000004",
        job_id: "99999999-0000-4000-8000-000000000005",
        title: "Another assignment",
        lecturer_name: "Fictional lecturer",
        customer_name: "Fictional college",
        finance: {
          ...amount,
          currency: "AUD",
          lecturer_invoices: [],
          expenses: [],
          customer_invoice_number: null,
          customer_invoice_grouped: null,
        },
      },
    ],
  });
  const [header, eur, invoice, expense, aud] =
    assignmentFinanceCsv(report).split("\r\n");
  expect(header.startsWith("\uFEFF")).toBe(true);
  expect(eur).toContain('"\'=Formula,""quoted"""');
  expect(eur).toContain('"Fictional lecturer"');
  expect(eur).toContain('"-2.05"');
  expect(invoice).toContain('"lecturer_invoice"');
  expect(invoice).toContain('"\'@fixture"');
  expect(invoice).not.toContain('"120.30"');
  expect(expense).toContain('"expenses"');
  expect(expense).toContain('"CHF"');
  expect(expense).not.toContain('"EUR"');
  expect(expense).toMatch(/"1\.10","0\.00","1\.10"$/);
  expect(aud).toContain('"AUD"');
});
