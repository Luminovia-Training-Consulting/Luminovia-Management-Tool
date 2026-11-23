/** Read projections for retained contracts, invoices and invoice payments. */
import { currencyCodes } from "../../lib/currencies.ts";
import { z } from "zod";

const id = z.uuid();
const instant = z.iso.datetime({ offset: true });
const currency = z.enum(currencyCodes);
// Unlike new UI submissions, historic PostgreSQL rows can hold unbounded dates.
const unbounded = z.enum(["infinity", "-infinity"]);
const retainedInstant = z.union([instant, unbounded]);
const retainedDate = z.union([z.iso.date(), unbounded]);

export const contractRecordsSchema = z.array(
  z.strictObject({
    id,
    user_id: id,
    user_name: z.string(),
    title: z.string().max(200),
    kind: z.enum(["master", "addendum"]),
    parent_contract_id: id.nullable(),
    status: z.enum(["draft", "active", "expired"]),
    effective_from: retainedInstant,
    expires_at: retainedInstant.nullable(),
    version: z.number().int().positive(),
    document_version_id: id.nullable(),
    document_id: id.nullable(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    acknowledged_at: instant.nullable(),
    created_at: instant,
  }),
);

export const invoiceRecordsSchema = z.array(
  z.strictObject({
    id,
    user_id: id,
    user_name: z.string(),
    number: z.string(),
    issued_on: retainedDate,
    due_on: retainedDate,
    currency,
    total_amount: z.number().positive(),
    paid_amount: z.number().nonnegative(),
    status: z.enum(["submitted", "approved", "paid", "rejected", "cancelled"]),
    document_id: id,
    document_version_id: id,
    claim_ids: z.array(id),
    created_at: instant,
    note: z.string().max(2000),
    paid_at: retainedInstant.nullable(),
    labels: z.array(z.string()),
  }),
);

export const invoicePaymentsSchema = z.array(
  z.strictObject({
    id,
    amount: z.number().positive(),
    currency,
    paid_at: retainedInstant,
    reference: z.string().max(200),
    recorded_by_name: z.string(),
    created_at: instant,
    voided_at: instant.nullable(),
    void_reason: z.string().nullable(),
  }),
);
