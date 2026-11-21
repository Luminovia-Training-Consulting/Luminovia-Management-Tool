/** Canonical export guards: exact cents, malformed records, formula injection
 * and absent/offline acknowledgements must fail before a download is offered. */
import { afterEach, expect, it, vi } from "vitest";
import {
  accountingAmount,
  accountingCents,
  accountingCsv,
  accountingExportSchema,
  createAccountingExport,
} from "./api";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
const invoice = {
  id: "a6000000-0000-4000-8000-000000000001",
  kind: "lecturer_invoice",
  number: "=FICTIONAL()",
  issued_on: "2001-01-01",
  due_on: "2001-02-01",
  currency: "AUD",
  recorded_total: "100.01",
  paid_total: "33.34",
  outstanding_total: "66.67",
  status: "approved",
  document_id: "a6000000-0000-4000-8000-000000000002",
  document_version_id: "a6000000-0000-4000-8000-000000000003",
  document_sha256: "b".repeat(64),
  organisation_id: null,
  organisation_name: null,
  accepted_charge_total: null,
  difference_reason: null,
  assignments: [],
  payments: [
    {
      id: "a6000000-0000-4000-8000-000000000004",
      amount: "33.34",
      currency: "AUD",
      paid_at: "2001-01-02T12:00:00Z",
      reference: "+FICTIONAL-REFERENCE",
      voided_at: null,
      void_reason: null,
      reverses_id: null,
    },
  ],
  tax: {
    status: "not_recorded",
    net: null,
    gross: null,
    vat_amount: null,
    vat_rate: null,
  },
  credit_note_reference: null,
};
const snapshot = {
  schema_version: "luminovia.accounting/1",
  id: "a6000000-0000-4000-8000-000000000005",
  source: "own",
  created_at: "2026-11-16T00:00:00Z",
  sha256: "a".repeat(64),
  invoices: [invoice],
};
afterEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});
it("uses integer cents for odd-cent arithmetic and the full database range", () => {
  expect(
    accountingAmount(accountingCents("33.34") + accountingCents("66.67")),
  ).toBe("100.01");
  expect(accountingCents("9999999999.99")).toBe(999999999999n);
  expect(() => accountingCents("100.001")).toThrow();
  expect(() => accountingCents("1e2")).toThrow();
  expect(() => accountingAmount(-1n)).toThrow();
});
it("validates canonical round trips and refuses malformed totals, cross-currency payments and invented tax", () => {
  expect(
    accountingExportSchema.parse(JSON.parse(JSON.stringify(snapshot)))
      .invoices[0].currency,
  ).toBe("AUD");
  for (const changed of [
    { paid_total: "33.35" },
    { recorded_total: "100.001" },
    { number: "" },
    { payments: [{ ...invoice.payments[0], currency: "EUR" }] },
    { tax: { ...invoice.tax, gross: "100.01" } },
  ])
    expect(() =>
      accountingExportSchema.parse({
        ...snapshot,
        invoices: [{ ...invoice, ...changed }],
      }),
    ).toThrow();
});
it("preserves a reviewed lecturer deadline earlier than the invoice date", () => {
  const lateLecturerInvoice = {
    ...invoice,
    due_on: "2000-12-31",
  };
  const parsed = accountingExportSchema.parse({
    ...snapshot,
    invoices: [lateLecturerInvoice],
  });
  expect(parsed.invoices[0].due_on).toBe("2000-12-31");
  expect(accountingCsv(parsed)).toContain('"2000-12-31"');
  expect(
    accountingExportSchema.safeParse({
      ...snapshot,
      invoices: [{ ...lateLecturerInvoice, kind: "customer_invoice" }],
    }).success,
  ).toBe(false);
});

it("retains exact strings and neutralizes formula injection in every authored CSV column", () => {
  const csv = accountingCsv(accountingExportSchema.parse(snapshot));
  expect(csv).toContain('"\'=FICTIONAL()"');
  expect(csv).toContain('"\'+FICTIONAL-REFERENCE"');
  expect(csv).toContain('"100.01","33.34","66.67"');
  expect(csv).toContain('"AUD"');
  expect(csv).toContain('"not_recorded","","","",""');
});
it("requires an online confirmed validated server snapshot", async () => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  await expect(
    createAccountingExport("own", [invoice.id], snapshot.id),
  ).rejects.toThrow("offline");
  expect(rpc).not.toHaveBeenCalled();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  rpc.mockResolvedValue({ data: null, error: null });
  await expect(
    createAccountingExport("own", [invoice.id], snapshot.id),
  ).rejects.toThrow();
  rpc.mockResolvedValue({ data: snapshot, error: null });
  expect(
    (await createAccountingExport("own", [invoice.id], snapshot.id)).id,
  ).toBe(snapshot.id);
  expect(rpc).toHaveBeenLastCalledWith("create_accounting_export", {
    p_source: "own",
    p_invoice_ids: [invoice.id],
    p_request_id: snapshot.id,
  });
});
