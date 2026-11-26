/** Pin CRM client-side RPC names, scopes, validation and retry arguments. */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCrmOpportunity,
  crmOpportunitiesQuery,
  crmOpportunityEventsQuery,
  moveCrmOpportunity,
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
  it("reads only the selected organisation and enforces the board response schema", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: opportunityId,
          organisation_id: organisationId,
          title: "Fictional opportunity",
          stage: "identified",
          estimated_value: 1250.5,
          currency: "EUR",
          version: 1,
          created_at: createdAt,
          updated_at: createdAt,
        },
      ],
      error: null,
    });
    const query = crmOpportunitiesQuery(actor, organisationId);
    const rows = await query.queryFn!({} as never);

    expect(rows[0].id).toBe(opportunityId);
    expect(rpc).toHaveBeenCalledWith(
      "list_crm_opportunities",
      { p_organisation_id: organisationId, p_limit: 100 },
      { get: true },
    );

    rpc.mockResolvedValue({
      data: [{ ...rows[0], stage: "not-a-stage" }],
      error: null,
    });
    await expect(query.queryFn!({} as never)).rejects.toThrow();
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
});
