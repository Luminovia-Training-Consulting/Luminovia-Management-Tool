/** Keep all export amounts as verified decimal strings and isolate text as spreadsheet cells. */
import type { z } from "zod";
import { saveBlob } from "../../lib/blob-download";
import { csvCell } from "../../lib/csv";
import type { assignmentFinanceExportSchema } from "./assignment-finance-schema";

type Report = z.infer<typeof assignmentFinanceExportSchema>;

const textColumns = [
  "record_type",
  "claim_id",
  "job_id",
  "title",
  "lecturer_name",
  "customer_name",
  "claim_status",
  "currency",
  "invoice_id",
  "invoice_number",
  "invoice_state",
  "grouped_customer_invoice",
] as const;
const quantityColumns = [
  "agreed_lecturer",
  "adjustment_lecturer",
  "agreed_customer",
  "contract_margin",
  "approved_timesheet_minutes",
  "recorded_teaching_minutes",
  "delivered_minutes",
  "lecturer_invoiced",
  "lecturer_paid",
  "lecturer_outstanding",
  "cancellation_compensation",
  "customer_invoiced",
  "customer_net_invoiced",
  "customer_received",
  "customer_retained",
  "customer_outstanding",
  "lecturer_invoice_amount",
  "expense_approved",
  "expense_paid",
  "expense_outstanding",
] as const;
type Row = Partial<
  Record<
    (typeof textColumns)[number] | (typeof quantityColumns)[number],
    string | number | boolean | null
  >
>;

/** Separate assignment totals, lecturer invoice details and expenses without duplicating totals. */
export function assignmentFinanceCsv(report: Report) {
  const rows = report.assignments.flatMap<Row>(({ finance, ...details }) => {
    const identity = { ...details, claim_status: finance.claim_status };
    return [
      {
        ...identity,
        ...finance,
        record_type: "assignment",
        invoice_id: finance.customer_invoice_id,
        invoice_number: finance.customer_invoice_number,
        grouped_customer_invoice: finance.customer_invoice_grouped,
      },
      ...finance.lecturer_invoices.map((invoice) => ({
        ...identity,
        record_type: "lecturer_invoice",
        currency: finance.currency,
        invoice_id: invoice.id,
        invoice_number: invoice.number,
        invoice_state: invoice.state,
        lecturer_invoice_amount: invoice.amount,
      })),
      ...finance.expenses.map((expense) => ({
        ...identity,
        record_type: "expenses",
        currency: expense.currency,
        expense_approved: expense.approved,
        expense_paid: expense.paid,
        expense_outstanding: expense.outstanding,
      })),
    ];
  });
  const meta = [
    report.schema_version,
    report.from,
    report.through,
    report.time_zone,
    report.generated_at,
  ].map(csvCell);
  const header = [
    "schema_version",
    "from",
    "through",
    "time_zone",
    "generated_at",
    ...textColumns,
    ...quantityColumns,
  ]
    .map(csvCell)
    .join(",");
  return (
    "\uFEFF" +
    [
      header,
      ...rows.map((row) =>
        [
          ...meta,
          ...textColumns.map((key) => csvCell(row[key])),
          // A numeric field is only emitted raw after verification. This preserves
          // negative adjustments as spreadsheet numbers while securing authored text.
          ...quantityColumns.map((key) => {
            const value = String(row[key] ?? "");
            return /^-?\d+(?:\.\d+)?$/.test(value) ? `"${value}"` : '""';
          }),
        ].join(","),
      ),
    ].join("\r\n")
  );
}

export function saveAssignmentFinanceExport(
  report: Report,
  format: "csv" | "json",
) {
  const json = format === "json";
  const blob = new Blob(
    [json ? JSON.stringify(report, null, 2) : assignmentFinanceCsv(report)],
    { type: json ? "application/json" : "text/csv;charset=utf-8" },
  );
  saveBlob(
    blob,
    `luminovia-assignment-settlement-${report.from}-${report.through}.${format}`,
  );
}
