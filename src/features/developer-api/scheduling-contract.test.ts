/** Check the published waitlist and substitution wire contracts in both API views. */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isDocumentedRequest, portalOpenApi } from "./contract";

const backend = "https://portal.example.invalid";
const prefix = "/rest/v1/rpc/";
const operations = [
  "job_waitlist",
  "my_job_waitlist",
  "set_job_waitlist",
  "substitution_candidates",
  "propose_job_substitution",
  "job_substitutions",
  "respond_job_substitution",
] as const;
const example = "dce89283-6109-488d-a12c-b9e697c0c340";
const publish = (download: boolean) => portalOpenApi(backend, download).paths;
type JsonSchema = Parameters<typeof z.fromJSONSchema>[0];
type DocumentedPost = {
  requestBody: { content: { "application/json": { schema: JsonSchema } } };
  responses: {
    "200": { content: { "application/json": { schema: JsonSchema } } };
  };
};
const post = (operation: string) =>
  (
    publish(false)[
      `${prefix}${operation}` as keyof ReturnType<typeof publish>
    ] as {
      post: DocumentedPost;
    }
  ).post;
const request = (operation: string) =>
  z.fromJSONSchema(
    post(operation).requestBody.content["application/json"].schema,
  );
const receipt = (operation: string) =>
  z.fromJSONSchema(
    post(operation).responses["200"].content["application/json"].schema,
  );

describe("waitlist and direct handover contracts", () => {
  it.each(operations)(
    "publishes the reviewed %s operation for internal callers",
    (operation) => {
      const path = `${prefix}${operation}` as keyof ReturnType<typeof publish>;
      expect(publish(true)[path]).toEqual(publish(false)[path]);
      expect(
        post(operation).responses["200"].content["application/json"].schema,
      ).not.toHaveProperty("x-postgresql-type");
      expect(isDocumentedRequest(backend + path, "POST", backend)).toBe(true);
    },
  );

  it("requires explicit acceptance of an exact quote and distinguishes withdraw from accept", () => {
    const parse = request("respond_job_substitution");
    const base = { p_offer_id: example, p_request_id: example };
    const accept = {
      ...base,
      p_action: "accept",
      p_quote_hash: "1".repeat(64),
      p_accept_terms: true,
    };
    expect(parse.safeParse(accept).success).toBe(true);
    expect(parse.safeParse({ ...accept, p_accept_terms: false }).success).toBe(
      false,
    );
    expect(parse.safeParse({ ...accept, p_quote_hash: null }).success).toBe(
      false,
    );
    expect(
      parse.safeParse({ ...base, p_action: "withdraw", p_quote_hash: null })
        .success,
    ).toBe(true);
    expect(
      parse.safeParse({
        ...base,
        p_action: "decline",
        p_quote_hash: null,
        p_accept_terms: false,
      }).success,
    ).toBe(true);
  });

  it("keeps business conflicts and cancelled receipts distinct from confirmed allocations", () => {
    const parse = receipt("respond_job_substitution");
    expect(
      parse.safeParse({ status: "confirmed", claim_id: example }).success,
    ).toBe(true);
    expect(
      parse.safeParse({ status: "cancelled", claim_id: example }).success,
    ).toBe(true);
    expect(parse.safeParse({ status: "terms_changed" }).success).toBe(true);
    expect(parse.safeParse({ status: "confirmed" }).success).toBe(false);
    expect(
      parse.safeParse({ status: "conflict", claim_id: example }).success,
    ).toBe(false);
  });

  it("documents own leave receipts with redaction and bounds candidate searches", () => {
    expect(
      receipt("set_job_waitlist").safeParse({
        job_id: example,
        title: "",
        joined: false,
        can_join: false,
        available: false,
      }).success,
    ).toBe(true);
    const candidates = request("substitution_candidates");
    expect(candidates.safeParse({ p_claim_id: example }).success).toBe(true);
    expect(
      candidates.safeParse({ p_claim_id: example, p_limit: 50 }).success,
    ).toBe(true);
    expect(
      candidates.safeParse({ p_claim_id: example, p_limit: 51 }).success,
    ).toBe(false);
    expect(
      candidates.safeParse({ p_claim_id: example, p_search: null }).success,
    ).toBe(false);
  });
});

describe("global calendar contracts", () => {
  const start = "2026-11-22T09:30:00+10:00";
  const end = "2026-11-22T11:30:00+10:00";
  const payload = {
    title: "Fictional event",
    description: "",
    link_url: "",
    starts_at: start,
    ends_at: end,
    time_zone: "Australia/Brisbane",
  };
  it("requires a complete zoned payload for save and no fields for publication", () => {
    const parse = request("manage_global_event");
    const create = {
      p_id: null,
      p_action: "save",
      p_expected_version: 0,
      p_request_id: example,
      p_payload: payload,
    };
    expect(parse.safeParse(create).success).toBe(true);
    expect(parse.safeParse({ ...create, p_payload: {} }).success).toBe(false);
    expect(
      parse.safeParse({
        ...create,
        p_payload: { ...payload, starts_at: "2026-11-22T09:30:00" },
      }).success,
    ).toBe(false);
    const publish = {
      p_id: example,
      p_action: "publish",
      p_expected_version: 1,
      p_request_id: example,
    };
    expect(parse.safeParse(publish).success).toBe(true);
    expect(parse.safeParse({ ...publish, p_payload: payload }).success).toBe(
      false,
    );
  });

  it("keeps complete pages, continuation pages and zoned event data distinct", () => {
    const page = receipt("global_calendar_events");
    const draft = {
      ...payload,
      id: example,
      published: false,
      archived_at: null,
      version: 1,
      updated_at: start,
    };
    const cursor = { at: start, id: example };
    expect(
      page.safeParse({ items: [], has_more: false, next_cursor: null }).success,
    ).toBe(true);
    expect(
      page.safeParse({ items: [draft], has_more: true, next_cursor: cursor })
        .success,
    ).toBe(true);
    expect(
      page.safeParse({ items: [], has_more: true, next_cursor: cursor })
        .success,
    ).toBe(false);
    expect(
      page.safeParse({ items: [draft], has_more: false, next_cursor: cursor })
        .success,
    ).toBe(false);
    expect(receipt("manage_global_event").safeParse(draft).success).toBe(true);
  });
});
