/** Verify the published accounting contracts and edition boundaries. */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { installationBrand } from "../../lib/installation-brand";
import { accountingPaths } from "./accounting-contract";
import { portalOpenApi } from "./contract";

const base = "https://portal.example.invalid";
const id = "62861e9a-912d-4a5e-bb72-3909568180ce";
const instant = "2026-11-22T09:30:00+10:00";
const invoice = {
  id,
  kind: "customer_invoice",
  number: "FICT-1",
  issued_on: "2026-11-01",
  due_on: "2026-12-01",
  currency: "AUD",
  recorded_total: "200.03",
  paid_total: "33.34",
  outstanding_total: "166.69",
  status: "partially_paid",
  document_id: id,
  document_version_id: id,
  document_sha256: "a".repeat(64),
  organisation_id: id,
  organisation_name: "Fictional company",
  accepted_charge_total: null,
  difference_reason: null,
  assignments: [
    {
      claim_id: null,
      job_id: id,
      title: "Fictional course",
      customer_name: "Fictional company",
      active_invoice_item: false,
    },
  ],
  payments: [
    {
      id,
      amount: "33.34",
      currency: "AUD",
      paid_at: instant,
      reference: "Fictional payment",
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
const lookup = "/rest/v1/rpc/accounting_invoices";
const register = "/rest/v1/rpc/register_customer_invoice";
const create = "/rest/v1/rpc/create_accounting_export";
const reverse = "/rest/v1/rpc/reverse_customer_invoice_payment";
const addCredit = "/rest/v1/rpc/register_customer_credit_note";
const credits = "/rest/v1/rpc/accounting_customer_credit_notes";
const settlement = "/rest/v1/rpc/accounting_customer_settlement";
const refund = "/rest/v1/rpc/record_customer_invoice_refund";

const input = (path: keyof typeof accountingPaths) =>
  z.fromJSONSchema(
    accountingPaths[path].post.requestBody.content["application/json"].schema,
  );
const result = (path: keyof typeof accountingPaths) =>
  z.fromJSONSchema(
    accountingPaths[path].post.responses["200"].content["application/json"]
      .schema,
  );

describe("accounting OpenAPI contracts", () => {
  it("publishes the same scoped operations in the internal download and explorer", () => {
    const internalExplorer = portalOpenApi(base, false);
    const internalDownload = portalOpenApi(base, true);
    const customerEditions = [
      "customer-self-hosted",
      "customer-managed",
    ] as const;
    for (const [path, operation] of Object.entries(accountingPaths)) {
      expect(internalExplorer.paths[path]).toEqual(operation);
      expect(internalDownload.paths[path]).toEqual(operation);
    }
    for (const edition of customerEditions) {
      const academy = portalOpenApi(base, true, {
        ...installationBrand,
        edition,
      });
      for (const path of Object.keys(accountingPaths)) {
        expect(academy.paths).not.toHaveProperty(path);
      }
    }
  });

  it("describes dated settlement journals, exact reversal totals and the result size limit", () => {
    const path = "/rest/v1/rpc/accounting_settlement_journal";
    expect(
      input(path).safeParse({ p_from: "2026-11-22", p_to: "2026-11-30" })
        .success,
    ).toBe(true);
    expect(input(path).safeParse({ p_from: "2026-11-22" }).success).toBe(false);
    const fixture = {
      schema_version: "luminovia.settlement-journal/1",
      from: "2026-11-22",
      to: "2026-11-30",
      generated_at: instant,
      scopes: ["lecturer"],
      items: [
        {
          kind: "lecturer_repayment",
          id,
          reverses_id: id,
          subject_id: id,
          effective_on: "2026-11-22",
          recorded_at: instant,
          currency: "EUR",
          amount: "12.34",
          reference: "Fictional repayment",
        },
      ],
      totals: [
        {
          kind: "lecturer_repayment",
          currency: "EUR",
          recorded: "0.00",
          reversed: "12.34",
          net: "-12.34",
        },
      ],
    };
    expect(result(path).safeParse(fixture).success).toBe(true);
    expect(
      result(path).safeParse({
        ...fixture,
        items: [{ ...fixture.items[0], amount: 12.34 }],
      }).success,
    ).toBe(false);
    expect(accountingPaths[path].post.responses["413"].description).toMatch(
      /5,000/,
    );
  });

  it("accepts omitted pagination fields and the real customer invoice row", () => {
    expect(input(lookup).safeParse({}).success).toBe(true);
    expect(
      input(lookup).safeParse({ p_before_at: null, p_before_id: null }).success,
    ).toBe(true);
    expect(input(lookup).safeParse({ p_limit: 101 }).success).toBe(false);
    const page = {
      items: [{ ...invoice, created_at: instant }],
      has_more: false,
    };
    expect(result(lookup).safeParse(page).success).toBe(true);
    expect(
      result(lookup).safeParse({ ...page, items: [invoice] }).success,
    ).toBe(false);
  });

  it("keeps exact decimal strings, redacted customer fields and tax nulls", () => {
    const snapshot = {
      id,
      source: "customer",
      created_at: instant,
      sha256: "a".repeat(64),
      schema_version: "luminovia.accounting/1",
      invoices: [invoice],
    };
    expect(result(create).safeParse(snapshot).success).toBe(true);
    expect(
      result(create).safeParse({
        ...snapshot,
        invoices: [{ ...invoice, paid_total: 33.34 }],
      }).success,
    ).toBe(false);
    expect(
      result(create).safeParse({
        ...snapshot,
        invoices: [
          { ...invoice, tax: { ...invoice.tax, vat_amount: "10.00" } },
        ],
      }).success,
    ).toBe(false);
    expect(
      result(create).safeParse({
        ...snapshot,
        invoices: [
          { ...invoice, public_download_url: "https://example.invalid" },
        ],
      }).success,
    ).toBe(false);
  });

  it("publishes reviewed credit note evidence independently of invoice balances", () => {
    const details = {
      reference: "Fictional CR-25",
      issued_on: "2026-11-12",
      currency: "AUD",
      amount: "20.03",
      reason: "Fictional documented adjustment",
      document_version_id: id,
    };
    const p_payload = { ...details, issued_and_reviewed: true };
    const request = { p_invoice_id: id, p_request_id: id, p_payload };
    expect(input(addCredit).safeParse(request).success).toBe(true);
    expect(
      input(addCredit).safeParse({
        ...request,
        p_payload: { ...p_payload, issued_and_reviewed: false },
      }).success,
    ).toBe(false);
    expect(
      input(addCredit).safeParse({
        ...request,
        p_payload: { ...p_payload, paid_total: "33.34" },
      }).success,
    ).toBe(false);
    expect(input(credits).safeParse({ p_invoice_id: id }).success).toBe(true);
    expect(
      input(credits).safeParse({ p_invoice_id: id, p_limit: 101 }).success,
    ).toBe(false);
    const item = {
      ...details,
      id,
      invoice_id: id,
      document_id: id,
      document_sha256: "a".repeat(64),
      created_at: instant,
    };
    expect(
      result(credits).safeParse({ items: [item], has_more: false }).success,
    ).toBe(true);
    expect(
      result(credits).safeParse({
        items: [{ ...item, amount: 20.03 }],
        has_more: false,
      }).success,
    ).toBe(false);
    expect(
      result(lookup).safeParse({
        items: [
          {
            ...invoice,
            created_at: instant,
            credit_note_reference: item.reference,
          },
        ],
        has_more: false,
      }).success,
    ).toBe(false);
  });

  it("publishes the separate dependent balance and a historic refund receipt command", () => {
    expect(input(settlement).safeParse({ p_invoice_id: id }).success).toBe(
      true,
    );
    const request = {
      p_invoice_id: id,
      p_amount: "13.45",
      p_refunded_at: instant,
      p_reference: "Fictional bank reference",
      p_request_id: id,
    };
    expect(input(refund).safeParse(request).success).toBe(true);
    expect(
      input(refund).safeParse({ ...request, p_amount: 13.45 }).success,
    ).toBe(false);
    expect(
      input(refund).safeParse({ ...request, p_refunded_at: "2026-11-22" })
        .success,
    ).toBe(false);
    const customerBalance = {
      invoice_id: id,
      currency: "AUD",
      can_manage: false,
      original_total: "200.03",
      credit_total: "20.00",
      net_total: "180.03",
      received_total: "200.03",
      refunded_total: "13.45",
      retained_total: "186.58",
      outstanding_total: "0.00",
      refund_due_total: "6.55",
      status: "refund_due",
      credit_applications: null,
      refunds: null,
    };
    expect(result(settlement).safeParse(customerBalance).success).toBe(true);
    expect(
      result(lookup).safeParse({
        items: [{ ...invoice, created_at: instant, refund_due_total: "6.55" }],
        has_more: false,
      }).success,
    ).toBe(false);
  });

  it("describes named registration and payment-reversal requests", () => {
    const p_payload = {
      claim_ids: [id],
      number: "FICT-1",
      issued_on: "2026-11-01",
      due_on: "2026-12-01",
      currency: "AUD",
      total_amount: "200.03",
      document_version_id: id,
      difference_reason: "",
    };
    const payload = { p_payload, p_request_id: id };
    expect(input(register).safeParse(payload).success).toBe(true);
    expect(
      input(register).safeParse({
        ...payload,
        p_payload: { ...p_payload, total_amount: "200.030" },
      }).success,
    ).toBe(false);
    expect(
      input(register).safeParse({
        ...payload,
        p_payload: { ...p_payload, claim_ids: [] },
      }).success,
    ).toBe(false);
    const reversal = {
      p_invoice_id: id,
      p_payment_id: id,
      p_reason: "Duplicate payment",
      p_request_id: id,
    };
    expect(input(reverse).safeParse(reversal).success).toBe(true);
    expect(
      input(reverse).safeParse({ ...reversal, p_reason: "No" }).success,
    ).toBe(false);
    expect(result(reverse).safeParse({ id }).success).toBe(true);
  });
});
