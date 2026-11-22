import { z } from "zod";

const currency = z.enum(["EUR", "AUD"]);
const version = z.int().positive();
const amount = z.number().positive();

export const invoiceExceptionOptionsSchema = z.strictObject({
  contracts: z
    .array(
      z.strictObject({
        id: z.uuid(),
        version,
        kind: z.enum(["master", "addendum"]),
        effective_from: z.iso.datetime({ offset: true }),
      }),
    )
    .max(100),
  maximum_amount: z.number().nonnegative(),
  currency,
  can_approve: z.boolean(),
  active: z
    .strictObject({
      id: z.uuid(),
      amount,
      due_on: z.iso.date(),
      contract_version: version,
    })
    .nullable(),
});

const invoiceExceptionSchema = z.strictObject({
  id: z.uuid(),
  claim_id: z.uuid(),
  title: z.string(),
  contract_version: version,
  amount,
  currency,
  due_on: z.iso.date(),
  approved_at: z.iso.datetime({ offset: true }),
});

export const myInvoiceExceptionsSchema = z.array(invoiceExceptionSchema);
export type InvoiceException = z.infer<typeof invoiceExceptionSchema>;

export const financePendingInvoiceExceptionsSchema = z.array(
  z.strictObject({
    request_id: z.uuid(),
    title: z.string(),
    lecturer_name: z.string(),
  }),
);
