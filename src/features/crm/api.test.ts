/** Pin CRM client-side RPC names, scopes, validation and retry arguments. */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCrmOpportunity,
  CRM_PAGE_LIMIT,
  crmOpportunitiesQuery,
  crmOpportunityEventsQuery,
  moveCrmOpportunity,
  updateCrmOpportunityForecast,
} from "./api";

const { rpc, requireOnline } = vi.hoisted(() => ({
  rpc: vi.fn(),
  requireOnline: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../../lib/online", () => ({ requireOnline }));

const actor = "77fe971a-c01e-4478-93c5-f79d2cf58f56";
const organisationId = "7b7e2cb2-7562-4e04-bf1a-e0c5f42a1451";
const opportunityId = "9bf4e3e0-30ab-416c-8012-d0ac3c20712d";
const requestId = "f478c5a8-4421-4ab6-adfe-d9f5e7a55061";
const createdAt = "2026-11-26T12:00:00.000+00:00";

afterEach(() => {
  rpc.mockReset();
  requireOnline.mockReset();
});

describe("CRM pipeline RPC adapters", () => {
  it("reads a filtered page only for the selected organisation and validates rows", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: opportunityId,
          organisation_id: organisationId,
          title: "Fictional opportunity",
          stage: "identified",
          estimated_value: 1250.5,
          currency: "EUR",
          close_probability: null,
          expected_close_date: null,
          version: 1,
          created_at: createdAt,
          updated_at: createdAt,
        },
      ],
      error: null,
    });
    const query = crmOpportunitiesQuery(actor, organisationId, {
      page: 0,
      search: "  renewal  ",
      stage: "identified",
    });
    const result = await query.queryFn!({} as never);

    expect(result.items[0].id).toBe(opportunityId);
    expect(result.hasNextPage).toBe(false);
    expect(rpc).toHaveBeenCalledWith(
      "list_crm_opportunity_page",
      {
        p_organisation_id: organisationId,
        p_search: "renewal",
        p_stage: "identified",
        p_limit: CRM_PAGE_LIMIT,
        p_offset: 0,
      },
      { get: true },
    );

    rpc.mockResolvedValue({
      data: [{ ...result.items[0], stage: "not-a-stage" }],
      error: null,
    });
    await expect(query.queryFn!({} as never)).rejects.toThrow();
  });

  it("uses page offsets and a sentinel row to expose the next-page state", async () => {
    rpc.mockResolvedValue({
      data: Array.from({ length: CRM_PAGE_LIMIT }, (_, index) => ({
        id: opportunityId,
        organisation_id: organisationId,
        title: `Fictional opportunity ${index}`,
        stage: "identified",
        estimated_value: null,
        currency: "EUR",
        close_probability: null,
        expected_close_date: null,
        version: 1,
        created_at: createdAt,
        updated_at: createdAt,
      })),
      error: null,
    });

    const query = crmOpportunitiesQuery(actor, organisationId, {
      page: 2,
      search: "",
      stage: null,
    });
    const result = await query.queryFn!({} as never);

    expect(result.items).toHaveLength(25);
    expect(result.hasNextPage).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "list_crm_opportunity_page",
      {
        p_organisation_id: organisationId,
        p_search: null,
        p_stage: null,
        p_limit: CRM_PAGE_LIMIT,
        p_offset: 50,
      },
      { get: true },
    );
  });

  it("rejects out-of-range page requests before contacting the server", async () => {
    const query = crmOpportunitiesQuery(actor, organisationId, {
      page: 401,
      search: "",
      stage: null,
    });
    await expect(query.queryFn!({} as never)).rejects.toThrow(
      "Invalid CRM page request",
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("scopes history by both organisation and opportunity", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: requestId,
          opportunity_id: opportunityId,
          organisation_id: organisationId,
          version: 1,
          event_type: "created",
          from_stage: null,
          to_stage: "identified",
          from_close_probability: null,
          to_close_probability: null,
          from_expected_close_date: null,
          to_expected_close_date: null,
          actor_id: actor,
          request_id: requestId,
          occurred_at: createdAt,
        },
      ],
      error: null,
    });

    const query = crmOpportunityEventsQuery(
      actor,
      organisationId,
      opportunityId,
    );
    expect((await query.queryFn!({} as never))[0].opportunity_id).toBe(
      opportunityId,
    );
    expect(rpc).toHaveBeenCalledWith(
      "list_crm_opportunity_events",
      {
        p_organisation_id: organisationId,
        p_opportunity_id: opportunityId,
        p_limit: 50,
      },
      { get: true },
    );
  });

  it("requires online confirmation and preserves the request identity for server idempotency", async () => {
    rpc.mockResolvedValue({ data: opportunityId, error: null });
    await createCrmOpportunity({
      organisationId,
      title: "Fictional opportunity",
      estimatedValue: "1250.50",
      currency: "EUR",
      requestId,
    });

    expect(requireOnline).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("create_crm_opportunity", {
      p_organisation_id: organisationId,
      p_title: "Fictional opportunity",
      p_estimated_value: "1250.50",
      p_currency: "EUR",
      p_request_id: requestId,
    });

    rpc.mockResolvedValue({ data: null, error: null });
    await expect(
      createCrmOpportunity({
        organisationId,
        title: "Invalid response",
        estimatedValue: null,
        currency: "EUR",
        requestId,
      }),
    ).rejects.toThrow();
  });

  it("sends stage transitions with the observed version and stable request ID", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await moveCrmOpportunity({
      organisationId,
      opportunityId,
      stage: "contacted",
      expectedVersion: 3,
      requestId,
    });

    expect(rpc).toHaveBeenCalledWith("move_crm_opportunity", {
      p_organisation_id: organisationId,
      p_opportunity_id: opportunityId,
      p_stage: "contacted",
      p_expected_version: 3,
      p_request_id: requestId,
    });
  });

  it("sends explicit zero and date values without converting the forecast into revenue", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await updateCrmOpportunityForecast({
      organisationId,
      opportunityId,
      closeProbability: 0,
      expectedCloseDate: "2026-12-15",
      expectedVersion: 4,
      requestId,
    });

    expect(requireOnline).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("update_crm_opportunity_forecast", {
      p_organisation_id: organisationId,
      p_opportunity_id: opportunityId,
      p_close_probability: 0,
      p_expected_close_date: "2026-12-15",
      p_expected_version: 4,
      p_request_id: requestId,
    });
  });

  it("allows clearing unknown forecast values and rejects out-of-range input locally", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await updateCrmOpportunityForecast({
      organisationId,
      opportunityId,
      closeProbability: null,
      expectedCloseDate: null,
      expectedVersion: 5,
      requestId,
    });
    expect(rpc).toHaveBeenCalledWith("update_crm_opportunity_forecast", {
      p_organisation_id: organisationId,
      p_opportunity_id: opportunityId,
      p_close_probability: null,
      p_expected_close_date: null,
      p_expected_version: 5,
      p_request_id: requestId,
    });

    rpc.mockClear();
    await expect(
      updateCrmOpportunityForecast({
        organisationId,
        opportunityId,
        closeProbability: 100.01,
        expectedCloseDate: null,
        expectedVersion: 5,
        requestId,
      }),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});
