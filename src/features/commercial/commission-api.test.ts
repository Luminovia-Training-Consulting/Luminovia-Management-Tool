import { describe, expect, it } from "vitest";
import {
  splitFee,
  revenueTotals,
  type CommissionRecord,
} from "./commission-api";
import { parseInvoiceLabels } from "./api";
function record(overrides: Partial<CommissionRecord> = {}): CommissionRecord {
  return {
    job_id: crypto.randomUUID(),
    claim_id: "claim",
    organisation_id: "org",
    organisation_name: "Fictional academy",
    title: "QA",
    status: "filled",
    pricing_model: "commission",
    currency: "EUR",
    gross_amount: 100,
    gross_total_amount: 403.01,
    platform_percent: 50,
    platform_total_amount: 201.51,
    lecturer_net_amount: 50,
    lecturer_net_total_amount: 201.5,
    lecturer_id: "lecturer",
    lecturer_name: "QA lecturer",
    accepted_at: "2030-01-01T00:00:00Z",
    ...overrides,
  };
}
describe("commission previews and truthful original-currency reporting", () => {
  it("rounds the platform share first and gives the lecturer the exact remainder", () => {
    expect(splitFee(403.01, 50)).toEqual({
      gross: 403.01,
      platform: 201.51,
      lecturer: 201.5,
    });
    expect(splitFee(100, 30)).toEqual({
      gross: 100,
      platform: 30,
      lecturer: 70,
    });
    expect(splitFee(17.13, 0)).toEqual({
      gross: 17.13,
      platform: 0,
      lecturer: 17.13,
    });
    expect(splitFee(17.13, 100)).toEqual({
      gross: 17.13,
      platform: 17.13,
      lecturer: 0,
    });
  });
  it("rejects invalid prices instead of displaying invented financial values", () => {
    for (const [gross, percent] of [
      [-1, 50],
      [Infinity, 50],
      [100, NaN],
      [100, 100.001],
      [100, -0.001],
    ])
      expect(() => splitFee(gross, percent)).toThrow();
  });
  it("keeps unclaimed offers apart from accepted revenue and never invents legacy gross", () => {
    const rows = [
      record(),
      record({
        currency: "AUD",
        gross_total_amount: 1000,
        platform_total_amount: 250,
        lecturer_net_total_amount: 750,
      }),
      record({
        claim_id: null,
        gross_total_amount: 100,
        lecturer_net_total_amount: 50,
      }),
      record({
        pricing_model: "legacy_net",
        gross_amount: null,
        gross_total_amount: null,
        platform_percent: null,
        platform_total_amount: null,
        lecturer_net_total_amount: 300,
      }),
    ];
    expect(revenueTotals(rows)).toEqual([
      {
        currency: "EUR",
        offered: 503.01,
        accepted: 403.01,
        lecturer: 501.5,
        platform: 201.51,
        count: 2,
        unknown: 1,
      },
      {
        currency: "AUD",
        offered: 1000,
        accepted: 1000,
        lecturer: 750,
        platform: 250,
        count: 1,
        unknown: 0,
      },
    ]);
  });
  it("normalizes invoice metadata labels without letting them alter price snapshots", () => {
    expect(parseInvoiceLabels(" Reviewed , EUR, Reviewed, ")).toEqual([
      "Reviewed",
      "EUR",
    ]);
    expect(() => parseInvoiceLabels("a".repeat(51))).toThrow();
    expect(() =>
      parseInvoiceLabels(
        Array.from({ length: 11 }, (_, i) => `label${i}`).join(","),
      ),
    ).toThrow();
    expect(() => parseInvoiceLabels("unsafe\nlabel")).toThrow();
  });
});
