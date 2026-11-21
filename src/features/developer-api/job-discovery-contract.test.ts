/** Document candidate paging, persisted filters and restricted quote fields. */
import { expect, it } from "vitest";
import { z } from "zod";
import { defaultJobFilters } from "../jobs/discovery-schema";
import { portalOpenApi } from "./contract";

const base = "https://portal.example.invalid";
const id = "d7000000-0000-4000-8000-000000000001";
const instant = "2026-11-21T11:42:00+10:00";
const paths = portalOpenApi(base, true).paths as Record<
  string,
  {
    post: {
      requestBody: {
        required: boolean;
        content: Record<
          string,
          { schema: Parameters<typeof z.fromJSONSchema>[0] }
        >;
      };
      responses: Record<
        string,
        {
          content: Record<
            string,
            { schema: Parameters<typeof z.fromJSONSchema>[0] }
          >;
        }
      >;
    };
  }
>;
const operation = (name: string) => paths[`/rest/v1/rpc/${name}`].post;
const response = (name: string) =>
  z.fromJSONSchema(
    operation(name).responses["200"].content["application/json"].schema,
  );

it("keeps filter defaults optional and accepts the original opaque cursor shape", () => {
  const { requestBody } = operation("job_discovery");
  const request = z.fromJSONSchema(
    requestBody.content["application/json"].schema,
  );
  expect(requestBody.required).toBe(false);
  expect(request.safeParse({}).success).toBe(true);
  expect(
    request.safeParse({
      p_filters: { topic_ids: [id], sort: "title" },
      p_cursor: {
        id,
        number: "0",
        text: "fictitious",
        fingerprint: "a".repeat(32),
      },
      p_limit: 100,
    }).success,
  ).toBe(true);
  expect(request.safeParse({ p_filters: { arbitrary: true } }).success).toBe(
    false,
  );
  expect(request.safeParse({ p_cursor: { id } }).success).toBe(false);
  expect(request.safeParse({ p_limit: 101 }).success).toBe(false);
});

it("documents the null restricted quote and omits private data from job results", () => {
  const item = {
    id,
    title: "Fictional job",
    description: "",
    customer_name: "Fictional company",
    delivery_type: "online",
    location: "",
    time_zone: "Europe/Berlin",
    status: "published",
    amount: null,
    total_amount: null,
    currency: "EUR",
    rate_unit: "fixed_total",
    terms: "Fictional terms",
    terms_version: 1,
    requires_contract: false,
    claim_deadline: null,
    capacity: 1,
    capacity_basis: "single_position",
    created_at: instant,
    job_sessions: [],
    job_requirements: [],
    confirmed_count: 0,
    open_positions: 1,
  };
  const page = {
    items: [item],
    has_more: false,
    next_cursor: null,
    as_of: instant,
    filters: defaultJobFilters,
  };
  expect(response("job_discovery").safeParse(page).success).toBe(true);
  expect(
    response("job_detail").safeParse({ ...item, amount: "0" }).success,
  ).toBe(false);
  expect(
    response("job_detail").safeParse({ ...item, gross_amount: 400 }).success,
  ).toBe(false);
});

it("includes historical saved filters and the bodyless removal receipt", () => {
  const filters = { ...defaultJobFilters };
  const { include_history, ...historicalFilters } = filters;
  expect(include_history).toBe(false);
  const view = {
    id,
    name: "Fictional saved view",
    version: 1,
    filters: historicalFilters,
    created_at: instant,
    updated_at: instant,
  };
  expect(response("saved_job_views").safeParse([view]).success).toBe(true);
  expect(
    response("saved_job_views").safeParse([{ ...view, user_id: id }]).success,
  ).toBe(false);
  expect(operation("remove_job_view").responses).toHaveProperty("204");
  expect(operation("remove_job_view").responses).not.toHaveProperty("200");
});
