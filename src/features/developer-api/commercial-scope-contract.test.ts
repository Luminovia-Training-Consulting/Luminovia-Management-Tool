import { describe, expect, it } from "vitest";
import { z } from "zod";
import { installationBrand } from "../../lib/installation-brand";
import { portalOpenApi } from "./contract";

const origin = "https://portal.example.invalid";
const id = "97d48a43-8c97-4c24-9ea4-4d657ca244b9";
const path = (name: string) => "/rest/v1/rpc/" + name;
const rpcs = [
  "client_spend_summary",
  "commercial_access",
  "commission_access",
  "commission_offer_policy",
  "company_invoice_reviews",
  "company_lecturer_decisions",
  "company_rejected_lecturers",
  "lecturer_compensation",
  "save_lecturer_compensation",
] as const;

type Schema = Parameters<typeof z.fromJSONSchema>[0];
type JSONBody = { content: { "application/json": { schema: Schema } } };
type Operation = {
  responses: Record<"200", JSONBody>;
  requestBody: JSONBody;
};

const operation = (name: (typeof rpcs)[number], download = true) =>
  portalOpenApi(origin, download).paths[path(name)].post as Operation;
const result = (name: (typeof rpcs)[number]) =>
  z.fromJSONSchema(
    operation(name).responses["200"].content["application/json"].schema,
  );

describe("internal commercial OpenAPI", () => {
  it("publishes the same exact responses in Explorer and download only for internal", () => {
    for (const name of rpcs) {
      expect(operation(name, false)).toEqual(operation(name));
      expect(
        operation(name).responses["200"].content["application/json"].schema,
      ).not.toEqual({});
    }
    for (const edition of ["customer-managed", "customer-self-hosted"] as const)
      for (const download of [false, true]) {
        const { paths } = portalOpenApi(origin, download, {
          ...installationBrand,
          edition,
        });
        for (const name of rpcs) expect(paths).not.toHaveProperty(path(name));
      }
  });

  it("accepts redacted capabilities and never admits rate fields to them", () => {
    const general = {
      can_manage_gross: false,
      can_manage_client_memberships: false,
      can_request: true,
      policy_configured: true,
    };
    const schema = result("commission_access");
    expect(schema.safeParse(general).success).toBe(true);
    expect(
      schema.safeParse({ ...general, regular_lecturer_percent: 50 }).success,
    ).toBe(false);
    expect(result("commission_offer_policy").safeParse(null).success).toBe(
      true,
    );
    expect(
      result("commission_offer_policy").safeParse({
        regular_lecturer_percent: null,
        senior_lecturer_percent: null,
        policy_version: 0,
      }).success,
    ).toBe(false);
  });

  it("documents the actual nullable decision state and requires explicit claim and lecturer IDs", () => {
    const decision = {
      claim_id: id,
      lecturer_id: id,
      lecturer_name: "Fictional lecturer",
      status: "pending",
      deadline: "2026-11-22T10:30:00+10:00",
      can_reject: null,
    };
    const schema = result("company_lecturer_decisions");
    expect(schema.safeParse([decision]).success).toBe(true);
    expect(
      schema.safeParse([{ ...decision, lecturer_id: undefined }]).success,
    ).toBe(false);
    expect(schema.safeParse([{ ...decision, gross_amount: 100 }]).success).toBe(
      false,
    );
  });

  it("accepts decimal compensation, rejecting fractional cents, unsupported currency and obsolete write versions", () => {
    const schema = z.fromJSONSchema(
      operation("save_lecturer_compensation").requestBody.content[
        "application/json"
      ].schema,
    );
    const input = {
      p_user_id: id,
      p_mode: "daily",
      p_percent: 55.81,
      p_daily_rate: 490.35,
      p_currency: "AUD",
      p_expected_version: 1998,
    };
    expect(schema.safeParse(input).success).toBe(true);
    expect(schema.safeParse({ ...input, p_daily_rate: 490.351 }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...input, p_currency: "GBP" }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ ...input, p_expected_version: 1999 }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...input, p_percent: undefined }).success).toBe(
      false,
    );
  });
});
