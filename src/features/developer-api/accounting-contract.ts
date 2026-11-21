/** Publishes accounting RPCs with the same result validators as the portal. */
import { z } from "zod";
import {
  accountingAccessSchema,
  accountingClaimsSchema,
  accountingCurrency,
  accountingDecimal,
  accountingExportSchema,
  accountingPageSchema,
  accountingReceiptSchema,
  accountingSourceSchema,
  customerCreditNoteInputSchema,
  customerCreditNotePageSchema,
  customerSettlementSchema,
} from "../accounting/schema.ts";
import { nativeExplorerPaths } from "./native-contract.ts";

const id = z.uuid();
const requestId = id.describe("Reuse for retrying exactly the same action.");
const instant = z.iso.datetime({ offset: true });
const noArguments = z.strictObject({});

const errorBody = z.object({
  code: z.string(),
  message: z.string(),
  details: z.string().nullable().optional(),
  hint: z.string().nullable().optional(),
});

const json = (schema: z.ZodType, io: "input" | "output" = "output") => ({
  "application/json": { schema: z.toJSONSchema(schema, { io }) },
});
const error = (description: string) => ({
  description,
  content: json(errorBody),
});

/** Retain the generated operation identity and REST gate for existing callers. */
function accountingOperation(
  name: string,
  description: string,
  input: z.ZodObject,
  result: z.ZodType,
  conflict = "An agreement or invoice number is already registered.",
) {
  const native = nativeExplorerPaths[`/rest/v1/rpc/${name}`]?.post;
  return {
    post: {
      ...native,
      operationId: `native_${name}`,
      summary: name.replaceAll("_", " "),
      tags: ["Accounting"],
      description,
      requestBody: {
        required: Object.values(input.shape).some(
          (field) => !field.isOptional(),
        ),
        content: json(input, "input"),
      },
      responses: {
        ...native?.responses,
        "200": {
          description: "The currently authorised accounting result.",
          content: json(result),
        },
        "400": error(
          "Invalid fields, inconsistent totals or a request key reused with changed values.",
        ),
        "401": error("Authentication required."),
        "403": error(
          "Current role or access to the invoice, export or exact document version is required.",
        ),
        "404": error(
          "The supplied named arguments do not match the accounting RPC.",
        ),
        "409": error(conflict),
      },
    },
  };
}

export const accountingPaths = {
  "/rest/v1/rpc/accounting_access": accountingOperation(
    "accounting_access",
    "Returns permissions for the active account. Each accounting operation checks its own current role and scope.",
    noArguments,
    accountingAccessSchema,
  ),
  "/rest/v1/rpc/accounting_customer_claims": accountingOperation(
    "accounting_customer_claims",
    "Requires finance.gross.read. Lists uninvoiced accepted customer agreements in their original currencies.",
    noArguments,
    accountingClaimsSchema,
  ),
  "/rest/v1/rpc/accounting_invoices": accountingOperation(
    "accounting_invoices",
    "Lists own lecturer invoices, all lecturer invoices with finance.manage, or customer invoices within current company or gross-finance scope. Supply both cursor fields from the page's last record or omit both. Claim IDs and accepted customer charges are null without gross-finance access.",
    z.strictObject({
      p_source: accountingSourceSchema.default("own"),
      p_before_at: instant.nullable().optional(),
      p_before_id: id.nullable().optional(),
      p_limit: z.int().min(1).max(100).default(40),
    }),
    accountingPageSchema,
  ),
  "/rest/v1/rpc/accounting_export": accountingOperation(
    "accounting_export",
    "Reads an immutable export created by the current account. Every source invoice and the original disclosure level must still be authorised.",
    z.strictObject({ p_id: id }),
    accountingExportSchema,
  ),
  "/rest/v1/rpc/create_accounting_export": accountingOperation(
    "create_accounting_export",
    "Creates an original-currency snapshot for one to one hundred unique authorised invoices of the same source. An identical request returns the saved snapshot. Tax fields are null because the ledger does not record the tax breakdown.",
    z.strictObject({
      p_source: accountingSourceSchema,
      p_invoice_ids: z.array(id).min(1).max(100),
      p_request_id: requestId,
    }),
    accountingExportSchema,
  ),
  "/rest/v1/rpc/register_customer_invoice": accountingOperation(
    "register_customer_invoice",
    "Requires finance.gross.read. Select unique, uninvoiced agreements for one customer and one currency. Upload a dedicated clean single-version PDF first. Explain any difference from the accepted charge and use a due date on or after the issue date.",
    z.strictObject({
      p_payload: z.strictObject({
        claim_ids: z.array(id).min(1).max(50),
        number: z.string().min(1).max(80),
        issued_on: z.iso.date(),
        due_on: z.iso.date(),
        currency: accountingCurrency,
        total_amount: accountingDecimal.describe(
          "Positive exact decimal amount, in the original currency.",
        ),
        document_version_id: id,
        difference_reason: z
          .string()
          .max(1000)
          .describe(
            "At least five characters after trimming when the total differs from the accepted charge.",
          ),
      }),
      p_request_id: requestId,
    }),
    accountingReceiptSchema,
  ),
  "/rest/v1/rpc/record_customer_invoice_payment": accountingOperation(
    "record_customer_invoice_payment",
    "Requires finance.gross.read. Records an actual payment in the original invoice currency up to the remaining original invoice amount. An incoming payment after a credit may create refundable surplus in the customer settlement.",
    z.strictObject({
      p_invoice_id: id,
      p_amount: accountingDecimal.describe(
        "Positive exact decimal amount in the invoice currency.",
      ),
      p_paid_at: instant.describe(
        "Timestamp of receipt, at or before the current time.",
      ),
      p_reference: z.string().min(1).max(1000),
      p_request_id: requestId,
    }),
    accountingReceiptSchema,
  ),
  "/rest/v1/rpc/accounting_customer_credit_notes": accountingOperation(
    "accounting_customer_credit_notes",
    "Internal installation and finance.gross.read required. Lists already-issued credit note evidence for one original customer invoice. Use both cursor values from the last row or omit both.",
    z.strictObject({
      p_invoice_id: id,
      p_before_at: instant.nullable().optional(),
      p_before_id: id.nullable().optional(),
      p_limit: z.int().min(1).max(100).default(40),
    }),
    customerCreditNotePageSchema,
  ),
  "/rest/v1/rpc/register_customer_credit_note": accountingOperation(
    "register_customer_credit_note",
    "Internal installation and finance.gross.read required. Records a reviewed, externally issued credit note against the original customer invoice and a dedicated clean single-version PDF. Registered amounts are in the invoice currency. Customer payment and tax accounting are separate.",
    z.strictObject({
      p_invoice_id: id,
      p_payload: customerCreditNoteInputSchema,
      p_request_id: requestId,
    }),
    accountingReceiptSchema,
  ),
  "/rest/v1/rpc/reverse_customer_invoice_payment": accountingOperation(
    "reverse_customer_invoice_payment",
    "Requires finance.gross.read. Appends an exact correction for a payment on this invoice that has no earlier reversal. An active recorded refund must remain backed by sufficient actual cash and an applied credit.",
    z.strictObject({
      p_invoice_id: id,
      p_payment_id: id,
      p_reason: z.string().min(5).max(1000),
      p_request_id: requestId,
    }),
    accountingReceiptSchema,
    "The payment reversal would invalidate an active recorded refund.",
  ),
  "/rest/v1/rpc/accounting_customer_settlement": accountingOperation(
    "accounting_customer_settlement",
    "Reads a separate net balance for the original customer invoice, including applied credits, actual cash receipts and recorded refunds. Current customer members can read only their own invoice totals. Gross-finance staff can also read the append-only application and refund histories.",
    z.strictObject({ p_invoice_id: id }),
    customerSettlementSchema,
  ),
  "/rest/v1/rpc/apply_customer_invoice_credit_note": accountingOperation(
    "apply_customer_invoice_credit_note",
    "Requires internal gross-finance authority. Applies the full amount of an already-registered credit note to its original invoice. The original invoice, received payments and earlier exports remain separate from the new net balance.",
    z.strictObject({
      p_invoice_id: id,
      p_credit_note_id: id,
      p_reason: z.string().min(5).max(1000),
      p_request_id: requestId,
    }),
    accountingReceiptSchema,
    "The same credit note already has an active application.",
  ),
  "/rest/v1/rpc/reverse_customer_invoice_credit_note": accountingOperation(
    "reverse_customer_invoice_credit_note",
    "Requires internal gross-finance authority. Appends an exact correction to an active credit application. A reversal must keep all recorded refunds backed by applied credit and received cash.",
    z.strictObject({
      p_invoice_id: id,
      p_application_id: id,
      p_reason: z.string().min(5).max(1000),
      p_request_id: requestId,
    }),
    accountingReceiptSchema,
    "The application was already reversed or its reversal would invalidate a recorded refund.",
  ),
  "/rest/v1/rpc/record_customer_invoice_refund": accountingOperation(
    "record_customer_invoice_refund",
    "Requires internal gross-finance authority. Records an already-completed refund in the original currency up to the refundable overpayment. Supplies a historic instant and a distinct transaction reference. The command only records accounting evidence.",
    z.strictObject({
      p_invoice_id: id,
      p_amount: accountingDecimal,
      p_refunded_at: instant,
      p_reference: z.string().min(1).max(120),
      p_request_id: requestId,
    }),
    accountingReceiptSchema,
    "The amount exceeds the refundable balance or the transaction reference was already recorded.",
  ),
  "/rest/v1/rpc/reverse_customer_invoice_refund": accountingOperation(
    "reverse_customer_invoice_refund",
    "Requires internal gross-finance authority. Corrects an existing refund entry through an exact reversal. The original receipt remains in the historical record.",
    z.strictObject({
      p_invoice_id: id,
      p_refund_id: id,
      p_reason: z.string().min(5).max(1000),
      p_request_id: requestId,
    }),
    accountingReceiptSchema,
    "The refund record was already reversed.",
  ),
};
