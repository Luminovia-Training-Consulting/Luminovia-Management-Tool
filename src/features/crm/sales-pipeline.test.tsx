/** Verify the company CRM board checks capability, persists transitions and keeps retry identity. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import "../operations/i18n";
import {
  createCrmOpportunity,
  moveCrmOpportunity,
  updateCrmOpportunityForecast,
} from "./api";
import { CompanyOpportunityPipeline } from "./sales-pipeline";

const { crmState, createOpportunity, moveOpportunity, updateForecast } =
  vi.hoisted(() => ({
    crmState: {
      opportunities: { items: [] as unknown[], hasNextPage: false },
      events: [] as unknown[],
      filters: [] as { page: number; search: string; stage: string | null }[],
      weightedPipeline: [] as {
        currency: "EUR" | "AUD" | "CHF" | "GBP" | "USD";
        weighted_value: number | null;
        included_opportunity_count: number;
        incomplete_opportunity_count: number;
      }[],
      weightedPipelineError: false,
      weightedPipelineReads: 0,
    },
    createOpportunity: vi.fn(),
    moveOpportunity: vi.fn(),
    updateForecast: vi.fn(),
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
    crmOpportunitiesQuery: (
      id: string,
      companyId: string,
      filters: { page: number; search: string; stage: string | null },
    ) => {
      crmState.filters.push(filters);
      return {
        queryKey: [
          "crm",
          "opportunities",
          id,
          companyId,
          filters.page,
          filters.search,
          filters.stage,
        ],
        queryFn: async () => crmState.opportunities,
      };
    },
    crmOpportunityEventsQuery: (
      id: string,
      companyId: string,
      opportunityKey: string,
    ) => ({
      queryKey: ["crm", "opportunity-events", id, companyId, opportunityKey],
      queryFn: async () => crmState.events,
    }),
    crmWeightedPipelineQuery: (id: string, companyId: string) => ({
      queryKey: ["crm", "weighted-pipeline", id, companyId],
      queryFn: async () => {
        crmState.weightedPipelineReads += 1;
        if (crmState.weightedPipelineError)
          throw new Error("fictional CRM summary read failure");
        return crmState.weightedPipeline;
      },
    }),
    createCrmOpportunity: createOpportunity,
    moveCrmOpportunity: moveOpportunity,
    updateCrmOpportunityForecast: updateForecast,
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
    close_probability: null,
    expected_close_date: null,
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
    from_close_probability: null,
    to_close_probability: null,
    from_expected_close_date: null,
    to_expected_close_date: null,
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
    updateForecast.mockReset();
    crmState.opportunities = { items: [], hasNextPage: false };
    crmState.events = [];
    crmState.filters = [];
    crmState.weightedPipeline = [];
    crmState.weightedPipelineError = false;
    crmState.weightedPipelineReads = 0;
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
        crmState.opportunities = {
          items: [opportunity()],
          hasNextPage: false,
        };
        crmState.events = [event(1, "created", null, "identified")];
        return opportunityId;
      });
    moveOpportunity
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockImplementation(async () => {
        crmState.opportunities = {
          items: [opportunity("contacted", 2)],
          hasNextPage: false,
        };
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
    crmState.opportunities = {
      items: [opportunity("contacted", 2)],
      hasNextPage: false,
    };
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
    expect(
      screen.queryByRole("spinbutton", {
        name: /close probability|abschlusswahrscheinlichkeit/i,
      }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /history for|verlauf für/i }),
    );
    expect(
      await screen.findByText(/stage changed from|phase von/i),
    ).toBeVisible();
  });

  it("persists an explicit zero forecast and reuses its request ID after an uncertain response", async () => {
    const user = userEvent.setup();
    crmState.opportunities = {
      items: [opportunity()],
      hasNextPage: false,
    };
    updateForecast
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockImplementation(async (input) => {
        crmState.opportunities = {
          items: [
            {
              ...opportunity("identified", 2),
              close_probability: 0,
              expected_close_date: "2026-12-15",
            },
          ],
          hasNextPage: false,
        };
        crmState.events = [
          {
            ...event(1, "created", null, "identified"),
            id: "751f43d3-1da6-456e-96e2-42f562eb9f31",
          },
          {
            ...event(2, "stage_changed", "identified", "contacted"),
            event_type: "forecast_updated",
            from_stage: "identified",
            to_stage: "identified",
            from_close_probability: null,
            to_close_probability: 0,
            from_expected_close_date: null,
            to_expected_close_date: "2026-12-15",
          },
        ];
        expect(input.closeProbability).toBe(0);
      });
    mount();

    const probability = await screen.findByRole("spinbutton", {
      name: /close probability|abschlusswahrscheinlichkeit/i,
    });
    await user.type(probability, "0");
    await user.type(
      screen.getByLabelText(
        /expected closing date|voraussichtliches abschlussdatum/i,
      ),
      "2026-12-15",
    );
    const save = screen.getByRole("button", {
      name: /save forecast|prognose speichern/i,
    });
    await user.click(save);
    expect(
      await screen.findByText(
        /forecast was not confirmed|prognose wurde nicht bestätigt/i,
      ),
    ).toBeVisible();

    await user.click(save);
    await waitFor(() => expect(updateForecast).toHaveBeenCalledTimes(2));
    const forecastRequests = vi.mocked(updateCrmOpportunityForecast).mock.calls;
    expect(forecastRequests[0][0]).toMatchObject({
      organisationId,
      opportunityId,
      closeProbability: 0,
      expectedCloseDate: "2026-12-15",
      expectedVersion: 1,
    });
    expect(forecastRequests[0][0].requestId).toBe(
      forecastRequests[1][0].requestId,
    );
    await user.click(
      screen.getByRole("button", { name: /history for|verlauf für/i }),
    );
    expect(
      await screen.findByText(/forecast changed|prognose geändert/i),
    ).toBeVisible();
  });

  it("filters by title and stage, advances pages, and resets pagination when filters change", async () => {
    const user = userEvent.setup();
    crmState.opportunities = {
      items: [opportunity()],
      hasNextPage: true,
    };
    mount();

    const search = await screen.findByRole("searchbox", {
      name: /search opportunities|vertriebschancen durchsuchen/i,
    });
    await user.type(search, "Campus");
    await user.selectOptions(
      screen.getByRole("combobox", {
        name: /filter by stage|nach phase filtern/i,
      }),
      "contacted",
    );
    await waitFor(() =>
      expect(crmState.filters.at(-1)).toEqual({
        page: 0,
        search: "Campus",
        stage: "contacted",
      }),
    );

    await user.click(
      screen.getByRole("button", { name: /next page|nächste seite/i }),
    );
    expect(await screen.findByText(/page 2|seite 2/i)).toBeVisible();
    expect(crmState.filters.at(-1)).toMatchObject({ page: 1 });

    await user.clear(search);
    await user.type(search, "Renewal");
    expect(await screen.findByText(/page 1|seite 1/i)).toBeVisible();
    expect(crmState.filters.at(-1)).toMatchObject({
      page: 0,
      search: "Renewal",
      stage: "contacted",
    });
  });

  it("distinguishes an empty later page from filters with no matching opportunities", async () => {
    const user = userEvent.setup();
    crmState.opportunities = {
      items: [opportunity()],
      hasNextPage: true,
    };
    const { client } = mount();

    await screen.findByText("Fictional LMS renewal");
    await user.click(
      screen.getByRole("button", { name: /next page|nächste seite/i }),
    );
    expect(await screen.findByText(/page 2|seite 2/i)).toBeVisible();

    crmState.opportunities = { items: [], hasNextPage: false };
    await act(async () => {
      await client.invalidateQueries({
        queryKey: ["crm", "opportunities", actor, organisationId],
      });
    });

    expect(
      await screen.findByText(
        /there are no opportunities on this page|auf dieser seite sind keine vertriebschancen/i,
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /previous page|vorherige seite/i }),
    ).toBeEnabled();
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

  it("shows a currency-separated forecast summary and refreshes it after a saved forecast", async () => {
    const user = userEvent.setup();
    crmState.opportunities = {
      items: [opportunity()],
      hasNextPage: false,
    };
    crmState.weightedPipeline = [
      {
        currency: "EUR",
        weighted_value: 12500,
        included_opportunity_count: 2,
        incomplete_opportunity_count: 1,
      },
      {
        currency: "USD",
        weighted_value: null,
        included_opportunity_count: 0,
        incomplete_opportunity_count: 1,
      },
    ];
    updateForecast.mockImplementation(async () => {
      crmState.weightedPipeline = [
        {
          currency: "EUR",
          weighted_value: 0,
          included_opportunity_count: 1,
          incomplete_opportunity_count: 0,
        },
      ];
      crmState.opportunities = {
        items: [
          {
            ...opportunity("identified", 2),
            close_probability: 0,
          },
        ],
        hasNextPage: false,
      };
    });
    mount();

    expect(
      await screen.findByRole("heading", {
        name: /gewichtete vertriebspipeline/i,
      }),
    ).toBeVisible();
    expect(await screen.findByText(/12\.500,00/)).toBeVisible();
    expect(
      within(
        screen.getByRole("region", { name: "Gewichtete Vertriebspipeline" }),
      ).getByText("USD"),
    ).toBeVisible();
    expect(
      within(
        screen.getByRole("region", { name: "Gewichtete Vertriebspipeline" }),
      ).getAllByText(/unvollständig: 1/i),
    ).toHaveLength(2);

    await user.type(
      await screen.findByRole("spinbutton", {
        name: /abschlusswahrscheinlichkeit/i,
      }),
      "0",
    );
    await user.click(
      screen.getByRole("button", { name: /prognose speichern/i }),
    );

    expect(
      await within(
        screen.getByRole("region", { name: "Gewichtete Vertriebspipeline" }),
      ).findByText(/^0,00/),
    ).toBeVisible();
    await waitFor(() =>
      expect(crmState.weightedPipelineReads).toBeGreaterThan(1),
    );
  });

  it("keeps the opportunity board usable when the independent summary fails and translates it", async () => {
    crmState.weightedPipelineError = true;
    await act(() => i18n.changeLanguage("en"));
    mount();

    expect(
      await screen.findByRole("heading", { name: "Sales pipeline" }),
    ).toBeVisible();
    expect(
      await screen.findByRole("heading", { name: "Weighted sales pipeline" }),
    ).toBeVisible();
    expect(await screen.findByText(/could not be loaded/i)).toBeVisible();
  });
});
