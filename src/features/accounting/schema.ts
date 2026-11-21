/** Shared database response contracts for the accounting UI and OpenAPI. */
import { z } from "zod";

export const accountingDecimal = z.string().regex(/^(0|[1-9]\d{0,9})\.\d{2}$/);
const instant = z.string().datetime({ offset: true });
const uuid = z.string().uuid();
export const accountingCurrency = z.enum(["EUR", "AUD"]);
export const accountingSourceSchema = z.enum([
  "own",
  "lecturer_all",
  "customer",
]);
/** Integer cents preserve exact original-currency values; no FX or VAT inference. */
export function accountingCents(value: string) {
  accountingDecimal.parse(value);
  return BigInt(value.replace(".", ""));
}
/** Format integer cents without introducing floating-point rounding. */
export function accountingAmount(cents: bigint) {
  if (cents < 0n) throw new Error("invalid_amount");
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
const paymentSchema = z.object({
  id: uuid,
  amount: accountingDecimal,
  currency: accountingCurrency,
  paid_at: instant,
  reference: z.string(),
  voided_at: instant.nullable(),
  void_reason: z.string().nullable(),
  reverses_id: uuid.nullable(),
});
/** Both invoice sources share this export shape. Customer projections omit
 * private claim/charge details unless current gross-finance access permits them. */
export const accountingInvoiceSchema = z
  .object({
    id: uuid,
    kind: z.enum(["lecturer_invoice", "customer_invoice"]),
    number: z.string().min(1).max(80),
    issued_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    currency: accountingCurrency,
    recorded_total: accountingDecimal,
    paid_total: accountingDecimal,
    outstanding_total: accountingDecimal,
    status: z.enum([
      "submitted",
      "approved",
      "paid",
      "rejected",
      "cancelled",
      "registered",
      "partially_paid",
    ]),
    document_id: uuid,
    document_version_id: uuid,
    document_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    organisation_id: uuid.nullable(),
    organisation_name: z.string().nullable(),
    accepted_charge_total: accountingDecimal.nullable(),
    difference_reason: z.string().nullable(),
    assignments: z.array(
      z.object({
        claim_id: uuid.nullable(),
        job_id: uuid,
        title: z.string(),
        customer_name: z.string(),
        active_invoice_item: z.boolean(),
      }),
    ),
    payments: z.array(paymentSchema),
    tax: z.object({
      status: z.literal("not_recorded"),
      net: z.null(),
      gross: z.null(),
      vat_amount: z.null(),
      vat_rate: z.null(),
    }),
    credit_note_reference: z.null(),
  })
  .superRefine((record, context) => {
    const total = accountingCents(record.recorded_total),
      paid = accountingCents(record.paid_total),
      outstanding = accountingCents(record.outstanding_total);
    const sum = record.payments.reduce(
      (result, p) =>
        result +
        (p.voided_at
          ? 0n
          : p.reverses_id
            ? -accountingCents(p.amount)
            : accountingCents(p.amount)),
      0n,
    );
    if (
      paid + outstanding !== total ||
      sum !== paid ||
      paid > total ||
      // Reviewed lecturer settlements can retain a contractual deadline
      // that passed before the invoice itself was issued.
      (record.kind === "customer_invoice" &&
        record.due_on < record.issued_on) ||
      record.payments.some((p) => p.currency !== record.currency)
    )
      context.addIssue({
        code: "custom",
        message: "Inconsistent original-currency invoice/payment totals",
      });
  });
export const accountingPageSchema = z.object({
  items: z.array(accountingInvoiceSchema.safeExtend({ created_at: instant })),
  has_more: z.boolean(),
});
/** A durable server snapshot is a custom interchange artifact, not an asserted
 * XRechnung/ZUGFeRD document or a validated third-party importer payload. */
export const accountingExportSchema = z.object({
  schema_version: z.literal("luminovia.accounting/1"),
  id: uuid,
  source: accountingSourceSchema,
  created_at: instant,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  invoices: z.array(accountingInvoiceSchema).min(1).max(100),
});
export const accountingAccessSchema = z.object({
  can_export_all_lecturers: z.boolean(),
  can_manage_customer_invoices: z.boolean(),
  can_export_customer: z.boolean(),
});
const claimSchema = z.object({
  claim_id: uuid,
  job_id: uuid,
  title: z.string(),
  organisation_id: uuid,
  organisation_name: z.string(),
  currency: accountingCurrency,
  accepted_charge: accountingDecimal,
});
export type AccountingInvoice = z.infer<typeof accountingInvoiceSchema>;
export type AccountingExport = z.infer<typeof accountingExportSchema>;
export type AccountingSource = AccountingExport["source"];
export const accountingClaimsSchema = z.array(claimSchema);
export const accountingReceiptSchema = z.object({ id: uuid });

const issueDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const customerCreditNoteInputSchema = z.strictObject({
  reference: z.string().trim().min(1).max(80),
  issued_on: issueDate,
  currency: accountingCurrency,
  amount: accountingDecimal.refine((value) => value !== "0.00"),
  reason: z.string().trim().min(5).max(1000),
  document_version_id: uuid,
  issued_and_reviewed: z.literal(true),
});
export const customerCreditNoteSchema = customerCreditNoteInputSchema
  .omit({ issued_and_reviewed: true })
  .extend({
    id: uuid,
    invoice_id: uuid,
    document_id: uuid,
    document_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    created_at: instant,
  });
export type CustomerCreditNote = z.infer<typeof customerCreditNoteSchema>;
