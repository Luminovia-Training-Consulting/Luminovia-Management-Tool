/** Validate finance and legal-history shapes exported to both API views. */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { portalOpenApi } from "./contract";

const backend = "https://portal.example.invalid";
const pub = (download: boolean) => portalOpenApi(backend, download).paths;
const responses = (download: boolean, name: string) =>
  (
    pub(download)[`/rest/v1/rpc/${name}`].post as {
      responses: Record<
        string,
        {
          content: {
            "application/json": {
              schema: Parameters<typeof z.fromJSONSchema>[0];
            };
          };
        }
      >;
    }
  ).responses;
const example = "62861e9a-912d-4a5e-bb72-3909568180ce";
const time = "2026-11-22T09:30:00+10:00";
const response = (
  name: "contract_records" | "invoice_records" | "invoice_payments",
) =>
  z.fromJSONSchema(
    responses(true, name)["200"].content["application/json"].schema,
  );

describe("restricted contract and finance record schemas", () => {
  it("retains historic drafts with explicit null document fields", () => {
    const record = {
      id: example,
      user_id: example,
      user_name: "Fictional lecturer",
      title: "",
      kind: "master",
      parent_contract_id: null,
      status: "draft",
      effective_from: time,
      expires_at: null,
      version: 1,
      document_version_id: null,
      document_id: null,
      sha256: null,
      acknowledged_at: null,
      created_at: time,
    };
    expect(response("contract_records").safeParse([record]).success).toBe(true);
    expect(
      response("contract_records").safeParse([{ ...record, status: "signed" }])
        .success,
    ).toBe(false);
    expect(
      response("contract_records").safeParse([
        { ...record, sha256: "bad digest" },
      ]).success,
    ).toBe(false);
  });

  it("requires the amount and original currency without expanding invoice metadata", () => {
    const record = {
      id: example,
      user_id: example,
      user_name: "Fictional lecturer",
      number: "FICT-1",
      issued_on: "2026-11-01",
      due_on: "2026-12-01",
      currency: "AUD",
      total_amount: 100,
      paid_amount: 50,
      status: "approved",
      document_id: example,
      document_version_id: example,
      claim_ids: [example],
      created_at: time,
      note: "",
      paid_at: time,
      labels: [],
    };
    expect(response("invoice_records").safeParse([record]).success).toBe(true);
    expect(
      response("invoice_records").safeParse([{ ...record, currency: "USD" }])
        .success,
    ).toBe(true);
    expect(
      response("invoice_records").safeParse([{ ...record, currency: "CHF" }])
        .success,
    ).toBe(true);
    expect(
      response("invoice_records").safeParse([{ ...record, currency: "JPY" }])
        .success,
    ).toBe(false);
    expect(
      response("invoice_records").safeParse([{ ...record, paid_amount: -1 }])
        .success,
    ).toBe(false);
    expect(
      response("invoice_records").safeParse([
        { ...record, secret_document_url: "fictional" },
      ]).success,
    ).toBe(false);
  });

  it("keeps voided payments in the history and documents a bodyless reversal", () => {
    const row = {
      id: example,
      amount: 50,
      currency: "EUR",
      paid_at: time,
      reference: "Fictional ledger",
      recorded_by_name: "Administrator",
      created_at: time,
      voided_at: time,
      void_reason: "Duplicate entry",
    };
    expect(response("invoice_payments").safeParse([row]).success).toBe(true);
    expect(
      response("invoice_payments").safeParse([{ ...row, voided_at: undefined }])
        .success,
    ).toBe(false);
    const path = "/rest/v1/rpc/void_invoice_payment";
    expect(pub(true)[path]).toEqual(pub(false)[path]);
    expect(responses(true, "void_invoice_payment")).toHaveProperty("204");
    expect(responses(true, "void_invoice_payment")).not.toHaveProperty("200");
  });
});
