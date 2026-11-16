/** Canonical accounting wire contract and actor-scoped RPC adapters. Decimal
 * strings are validated before display/download; missing tax data stays unknown. */
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { csvText } from "../commercial/api";

const decimal = z.string().regex(/^(0|[1-9]\d{0,9})\.\d{2}$/);
const instant = z.string().datetime({ offset: true });
const uuid = z.string().uuid();
/** Integer cents preserve exact original-currency values; no FX or VAT inference. */
export function accountingCents(value: string) {
  decimal.parse(value);
  return BigInt(value.replace(".", ""));
}
/** Format integer cents without introducing floating-point rounding. */
export function accountingAmount(cents: bigint) {
  if (cents < 0n) throw new Error("invalid_amount");
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
const paymentSchema = z.object({
  id: uuid,
  amount: decimal,
  currency: z.enum(["EUR", "AUD"]),
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
    currency: z.enum(["EUR", "AUD"]),
    recorded_total: decimal,
    paid_total: decimal,
    outstanding_total: decimal,
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
    accepted_charge_total: decimal.nullable(),
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
      record.due_on < record.issued_on ||
      record.payments.some((p) => p.currency !== record.currency)
    )
      context.addIssue({
        code: "custom",
        message: "Inconsistent original-currency invoice/payment totals",
      });
  });
const pageSchema = z.object({
  items: z.array(
    accountingInvoiceSchema.and(z.object({ created_at: instant })),
  ),
  has_more: z.boolean(),
});
/** A durable server snapshot is a custom interchange artifact, not an asserted
 * XRechnung/ZUGFeRD document or a validated third-party importer payload. */
export const accountingExportSchema = z.object({
  schema_version: z.literal("luminovia.accounting/1"),
  id: uuid,
  source: z.enum(["own", "lecturer_all", "customer"]),
  created_at: instant,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  invoices: z.array(accountingInvoiceSchema).min(1).max(100),
});
const accessSchema = z.object({
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
  currency: z.enum(["EUR", "AUD"]),
  accepted_charge: decimal,
});
export type AccountingInvoice = z.infer<typeof accountingInvoiceSchema>;
export type AccountingExport = z.infer<typeof accountingExportSchema>;
export type AccountingSource = AccountingExport["source"];
/** Actor identity prevents one signed-in account reusing another's projections. */
export const accountingKeys = {
  all: (actor: string) => ["accounting", actor] as const,
};
/** Capabilities come from current SQL authority; UI choices grant no access. */
export const accountingAccessQuery = (actor: string) =>
  queryOptions({
    queryKey: [...accountingKeys.all(actor), "access"],
    queryFn: async () => {
      const { data, error } = await db().rpc("accounting_access");
      if (error) throw error;
      return accessSchema.parse(data);
    },
    staleTime: 1000,
  });
/** Only current gross-finance users request uninvoiced immutable agreements. */
export const customerClaimsQuery = (actor: string, enabled: boolean) =>
  queryOptions({
    queryKey: [...accountingKeys.all(actor), "customer-claims"],
    queryFn: async () => {
      const { data, error } = await db().rpc("accounting_customer_claims");
      if (error) throw error;
      return z.array(claimSchema).parse(data);
    },
    enabled,
  });
interface Cursor {
  at: string;
  id: string;
}
/** Cursor pages keep discovery bounded without silently truncating old invoices. */
export const accountingInvoicesQuery = (
  actor: string,
  source: AccountingSource,
) =>
  infiniteQueryOptions({
    queryKey: [...accountingKeys.all(actor), "invoices", source],
    initialPageParam: null as Cursor | null,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await db()
        .rpc("accounting_invoices", {
          p_source: source,
          p_before_at: pageParam?.at ?? null,
          p_before_id: pageParam?.id ?? null,
          p_limit: 40,
        })
        .abortSignal(signal);
      if (error) throw error;
      return pageSchema.parse(data);
    },
    getNextPageParam: (page) => {
      const last = page.items.at(-1);
      return page.has_more && last
        ? { at: last.created_at, id: last.id }
        : undefined;
    },
    staleTime: 10000,
  });
/** Mutations require confirmed online receipts and never update caches optimistically. */
export async function accountingWrite(
  name:
    | "register_customer_invoice"
    | "record_customer_invoice_payment"
    | "reverse_customer_invoice_payment",
  payload: Record<string, unknown>,
) {
  requireOnline();
  const { data, error } = await db().rpc(name, payload);
  if (error) throw error;
  return z.object({ id: uuid }).parse(data);
}
/** Request keys recover response loss; the database deduplicates identical
 * contents while retaining separate snapshots after payment changes. */
export async function createAccountingExport(
  source: AccountingSource,
  ids: string[],
  key: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("create_accounting_export", {
    p_source: source,
    p_invoice_ids: ids,
    p_request_id: key,
  });
  if (error) throw error;
  return accountingExportSchema.parse(data);
}
/** Stable machine headers and the shared formula-safe encoder preserve exact
 * monetary strings while neutralizing authored spreadsheet expressions. */
export function accountingCsv(snapshot: AccountingExport) {
  const validated = accountingExportSchema.parse(snapshot);
  return csvText([
    [
      "schema_version",
      "export_id",
      "as_of",
      "source",
      "invoice_id",
      "kind",
      "invoice_number",
      "issued_on",
      "due_on",
      "currency",
      "recorded_total",
      "paid_total",
      "outstanding_total",
      "status",
      "organisation_id",
      "organisation_name",
      "assignment_ids",
      "job_ids",
      "payment_references",
      "tax_status",
      "tax_net",
      "tax_gross",
      "vat_amount",
      "vat_rate",
      "document_sha256",
    ],
    ...validated.invoices.map((i) => [
      validated.schema_version,
      validated.id,
      validated.created_at,
      validated.source,
      i.id,
      i.kind,
      i.number,
      i.issued_on,
      i.due_on,
      i.currency,
      i.recorded_total,
      i.paid_total,
      i.outstanding_total,
      i.status,
      i.organisation_id,
      i.organisation_name,
      i.assignments
        .map((a) => a.claim_id ?? "")
        .filter(Boolean)
        .join(";"),
      i.assignments.map((a) => a.job_id).join(";"),
      i.payments.map((p) => p.reference).join(";"),
      i.tax.status,
      "",
      "",
      "",
      "",
      i.document_sha256,
    ]),
  ]);
}
/** Deliver only a validated server response and promptly release its Blob URL. */
export function downloadAccounting(
  snapshot: AccountingExport,
  format: "json" | "csv",
) {
  const validated = accountingExportSchema.parse(snapshot);
  const text =
    format === "json"
      ? JSON.stringify(validated, null, 2)
      : accountingCsv(validated);
  const url = URL.createObjectURL(
    new Blob([text], {
      type: format === "json" ? "application/json" : "text/csv;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `luminovia-accounting-${validated.id}.${format}`;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
