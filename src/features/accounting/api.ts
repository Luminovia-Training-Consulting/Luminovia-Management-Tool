/** Canonical accounting wire contract and actor-scoped RPC adapters. Decimal
 * strings are validated before display/download; missing tax data stays unknown. */
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { csvText } from "../commercial/api";

import {
  accountingAccessSchema,
  accountingClaimsSchema,
  accountingExportSchema,
  accountingPageSchema,
  accountingReceiptSchema,
  type AccountingExport,
  type AccountingSource,
} from "./schema";
export {
  accountingAmount,
  accountingCents,
  accountingExportSchema,
  accountingInvoiceSchema,
  type AccountingExport,
  type AccountingInvoice,
  type AccountingSource,
} from "./schema";

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
      return accountingAccessSchema.parse(data);
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
      return accountingClaimsSchema.parse(data);
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
      return accountingPageSchema.parse(data);
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
  return accountingReceiptSchema.parse(data);
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
