/** Verify the company CRM board checks capability, persists transitions and keeps retry identity. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import "../operations/i18n";
import { createCrmOpportunity, moveCrmOpportunity } from "./api";
import { CompanyOpportunityPipeline } from "./sales-pipeline";

const { crmState, createOpportunity, moveOpportunity } = vi.hoisted(() => ({
  crmState: { opportunities: [] as unknown[], events: [] as unknown[] },
  createOpportunity: vi.fn(),
  moveOpportunity: vi.fn(),
}));

vi.mock("../../lib/queries", () => ({
  permissionsQuery: (id: string) => ({
    queryKey: ["permissions", id],
    queryFn: async () => [],
  }),
}));
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    crmOpportunitiesQuery: (id: string, companyId: string) => ({
      queryKey: ["crm", "opportunities", id, companyId],
      queryFn: async () => crmState.opportunities,
    }),
    crmOpportunityEventsQuery: (
      id: string,
      companyId: string,
      opportunityKey: string,
    ) => ({
      queryKey: ["crm", "opportunity-events", id, companyId, opportunityKey],
      queryFn: async () => crmState.events,
    }),
    createCrmOpportunity: createOpportunity,
    moveCrmOpportunity: moveOpportunity,
  };
});
vi.mock("../../lib/online", () => ({
  requireOnline: vi.fn(),
  useOnline: () => true,
}));

const actor = "crm-manager";
const organisationId = "7b7e2cb2-7562-4e04-bf1a-e0c5f42a1451";
const opportunityId = "9bf4e3e0-30ab-416c-8012-d0ac3c20712d";
const createdAt = "2026-11-26T12:00:00.000Z";

function opportunity(
  stage: "identified" | "contacted" = "identified",
  version = 1,
) {
  return {
    id: opportunityId,
    organisation_id: organisationId,
    title: "Fictional LMS renewal",
    stage,
    estimated_value: 25000,
    currency: "EUR",
    version,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function event(
  version: 1 | 2,
  eventType: "created" | "stage_changed",
  fromStage: "identified" | null,
  toStage: "identified" | "contacted",
) {
  return {
    id:
      version === 1
        ? "751f43d3-1da6-456e-96e2-42f562eb9f31"
        : "f9851a40-2cd3-4471-a67a-3477946dd423",
    opportunity_id: opportunityId,
    organisation_id: organisationId,
    version,
    event_type: eventType,
    from_stage: fromStage,
    to_stage: toStage,
    actor_id: "e8bafc26-c830-46ae-8482-77c7346f6395",
    request_id:
      version === 1
        ? "f478c5a8-4421-4ab6-adfe-d9f5e7a55061"
        : "240a90d2-7bdf-47a2-bbdc-cda89dd9267f",
    occurred_at: createdAt,
  };
}

function mount({
  canManage = true,
  archived = false,
}: { canManage?: boolean; archived?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(
    ["permissions", actor],
    canManage ? ["organisations.manage"] : ["jobs.manage"],
  );
  const result = render(
    <QueryClientProvider client={client}>
      <CompanyOpportunityPipeline
        actor={actor}
        organisationId={organisationId}
        archived={archived}
      />
    </QueryClientProvider>,
  );
  return { ...result, client };
}

describe("CompanyOpportunityPipeline", () => {
  beforeEach(() => {
    createOpportunity.mockReset();
    moveOpportunity.mockReset();
    crmState.opportunities = [];
    crmState.events = [];
  });
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("de");
    vi.restoreAllMocks();
  });

  it("does not issue board or history requests without organisations.manage", async () => {
    mount({ canManage: false });

    expect(await screen.findByText(/permission|Berechtigung/i)).toBeVisible();
    expect(createOpportunity).not.toHaveBeenCalled();
    expect(moveOpportunity).not.toHaveBeenCalled();
  });

  it("keeps a create retry idempotent, moves with the observed version and shows saved history", async () => {
    const user = userEvent.setup();
    createOpportunity
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockImplementation(async () => {
        crmState.opportunities = [opportunity()];
        crmState.events = [event(1, "created", null, "identified")];
        return opportunityId;
      });
    moveOpportunity
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockImplementation(async () => {
        crmState.opportunities = [opportunity("contacted", 2)];
        crmState.events = [
          event(1, "created", null, "identified"),
          event(2, "stage_changed", "identified", "contacted"),
        ];
      });
    mount();

    await user.type(
      await screen.findByRole("textbox", {
        name: /opportunity|vertriebschance/i,
      }),
      "Fictional LMS renewal",
    );
    await user.type(
      screen.getByRole("textbox", {
        name: /estimated value|geschätzter wert/i,
      }),
      "25000,50",
    );
    await user.click(
      screen.getByRole("button", {
        name: /create opportunity|chance anlegen/i,
      }),
    );
    expect(
      await screen.findByText(/not confirmed|nicht bestätigt/i),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", {
        name: /create opportunity|chance anlegen/i,
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("Fictional LMS renewal")).toBeVisible(),
    );
    const createRequests = vi.mocked(createCrmOpportunity).mock.calls;
    expect(createRequests).toHaveLength(2);
    expect(createRequests[0][0].requestId).toEqual(
      createRequests[1][0].requestId,
    );
    expect(createRequests[0][0].estimatedValue).toBe("25000.50");

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Fictional LMS renewal/ }),
      "contacted",
    );
    await waitFor(() =>
      expect(vi.mocked(moveCrmOpportunity)).toHaveBeenCalledWith(
        expect.objectContaining({
          organisationId,
          opportunityId,
          stage: "contacted",
          expectedVersion: 1,
        }),
      ),
    );
    expect(
      await screen.findByText(/could not be changed|konnte nicht geändert/i),
    ).toBeVisible();
    await user.selectOptions(
      screen.getByRole("combobox", { name: /Fictional LMS renewal/ }),
      "contacted",
    );
    await waitFor(() => expect(moveCrmOpportunity).toHaveBeenCalledTimes(2));
    const moveRequests = vi.mocked(moveCrmOpportunity).mock.calls;
    expect(moveRequests[0][0].requestId).toEqual(moveRequests[1][0].requestId);
    await user.click(
      screen.getByRole("button", { name: /history for|verlauf für/i }),
    );
    expect(
      await screen.findByText(/stage changed from|phase von/i),
    ).toBeVisible();
    expect(vi.mocked(moveCrmOpportunity)).toHaveBeenCalledTimes(2);
  });

  it("keeps archived-company history available while omitting every write control", async () => {
    crmState.opportunities = [opportunity("contacted", 2)];
    crmState.events = [
      event(1, "created", null, "identified"),
      event(2, "stage_changed", "identified", "contacted"),
    ];
    mount({ archived: true });

    expect(await screen.findByText(/archived|archiviert/i)).toBeVisible();
    expect(
      screen.queryByRole("button", {
        name: /create opportunity|chance anlegen/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: /change stage|phase für/i }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /history for|verlauf für/i }),
    );
    expect(
      await screen.findByText(/stage changed from|phase von/i),
    ).toBeVisible();
  });

  it("renders translated pipeline and stage labels in German and English", async () => {
    await act(() => i18n.changeLanguage("de"));
    const german = mount();
    expect(
      await screen.findByRole("heading", { name: "Vertriebspipeline" }),
    ).toBeVisible();
    german.unmount();

    await act(() => i18n.changeLanguage("en"));
    const english = mount();
    expect(
      await screen.findByRole("heading", { name: "Sales pipeline" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Identified" })).toBeVisible();
    english.unmount();
    await act(() => i18n.changeLanguage("de"));
  });
});
