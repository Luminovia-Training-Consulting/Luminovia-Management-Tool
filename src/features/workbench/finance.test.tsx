/** Retained finance forecast and operations authorization regressions. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { ControlCenterPage } from "./control-center";
import { financePeriodSchema, type ControlCenter } from "./finance-api";
import { ForecastExport } from "./forecast-export";

const fake = vi.hoisted(() => ({
  rpc: vi.fn(),
  actor: "a597a651-389e-45f8-acba-92c006d6d261",
  responses: {} as Record<string, unknown>,
  errors: {} as Record<string, unknown>,
  download: vi.fn(),
}));
vi.mock("../../lib/csv", () => ({ downloadCsv: fake.download }));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    ...fake,
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: fake.actor } } },
      }),
    },
  }),
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: fake.actor } } }),
}));
const teacher = "a597a651-389e-45f8-acba-92c006d6d261",
  job = "1722aa1e-16be-4ca3-8064-fe81e49752ae";
let client: QueryClient;
beforeEach(async () => {
  await i18n.changeLanguage("de");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fake.actor = teacher;
  fake.download.mockReset();
  fake.errors = {};
  fake.responses = {
    get_my_permissions: ["jobs.manage", "finance.manage"],
    control_center: {
      from: "2020-01-01",
      until: "2020-02-01",
      time_zone: "UTC",
      unstaffed: [
        {
          id: job,
          title: "Fictional unstaffed course",
          customer_name: "Fictional academy",
          starts_at: "2020-01-06T08:00:00Z",
          open_positions: 1,
        },
      ],
      missing_documents: [],
      cancellations: [],
      overdue_tasks: [],
      requests: [],
      contracts_expiring: [],
      qualifications_expiring: [],
      preparation: [],
      quality: [{ run_id: job, responses: 2, average_rating: null }],
    },
    finance_forecast: {
      from: "2020-01-01",
      until: "2020-02-01",
      time_zone: "UTC",
      pipeline_probability: 0,
      gross_authorized: false,
      payment_basis: "lecturer_invoice_payment_records",
      months: [
        {
          month: "2020-01-01",
          currency: "EUR",
          accepted_lecturer_cost: 300,
          accepted_gross_known: null,
          accepted_margin_known: null,
          unknown_gross_claims: null,
          pipeline_lecturer_cost_known: 0,
          pipeline_gross_known: null,
          lecturer_invoice_payments: 0,
        },
      ],
    },
  };
  fake.rpc.mockReset().mockImplementation((name: string) => {
    const request = {
      abortSignal: () => request,
      then: (done: (value: unknown) => unknown) =>
        Promise.resolve(fake.responses[name]).then((data) =>
          done({ data, error: fake.errors[name] ?? null }),
        ),
    };
    return request;
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});

function mount(view: React.ReactNode) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{view}</MemoryRouter>
    </QueryClientProvider>,
  );
}

it("renders scoped Control Center findings and scenario controls without exposing unauthorized gross values", async () => {
  const user = userEvent.setup();
  mount(<ControlCenterPage />);
  expect(await screen.findByText("Fictional unstaffed course")).toBeVisible();
  expect(
    screen.getByText("Bewertung wird erst ab drei Rückmeldungen angezeigt."),
  ).toBeVisible();
  const table = await screen.findByRole("table");
  expect(
    within(table).queryByRole("columnheader", {
      name: "Bekannter Bruttoumsatz",
    }),
  ).not.toBeInTheDocument();
  await user.clear(
    screen.getByLabelText(
      "Angenommene Wahrscheinlichkeit für offene Angebote und Anfragen (%)",
    ),
  );
  await user.type(
    screen.getByLabelText(
      "Angenommene Wahrscheinlichkeit für offene Angebote und Anfragen (%)",
    ),
    "50",
  );
  await user.click(screen.getByRole("button", { name: "Szenario berechnen" }));
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith(
      "finance_forecast",
      expect.objectContaining({ p_pipeline_probability: 0.5 }),
    ),
  );
  await act(async () => {
    await i18n.changeLanguage("en");
  });
  expect(screen.getByRole("heading", { name: "Control Center" })).toBeVisible();
  expect(
    screen.getByText("Ratings appear only after at least three responses."),
  ).toBeVisible();
});

it("keeps a compact request queue and searches across its entire permitted result set", async () => {
  const user = userEvent.setup();
  let reportIntersection: IntersectionObserverCallback | undefined;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        reportIntersection = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const scrollToMore = () =>
    act(() => {
      expect(reportIntersection).toBeDefined();
      reportIntersection!(
        [{ isIntersecting: true }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      );
    });
  const control = fake.responses.control_center as ControlCenter;
  control.requests = Array.from({ length: 25 }, (_, index) => ({
    id: `c3000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    organisation_id: teacher,
    organisation_name:
      index === 24 ? "Fictional partner academy" : "Fictional academy",
    title: `Fictional request ${index + 1}`,
    status: "submitted",
    job_id: index === 24 ? job : null,
    created_at: "2020-01-20T14:00:00Z",
  }));
  mount(<ControlCenterPage />);
  const queue = within(
    await screen.findByRole("region", { name: "Unternehmensanfragen" }),
  );
  expect(
    queue.getByRole("group", { name: "Unternehmensanfragen" }),
  ).toHaveAttribute("tabindex", "0");
  expect(queue.getAllByRole("listitem")).toHaveLength(8);
  expect(queue.getByRole("status")).toHaveTextContent("8 von 25 Anfragen");
  const initialSearch = queue.getByRole("searchbox", {
    name: "Anfragen nach Titel oder Unternehmen suchen",
  });
  await user.type(initialSearch, "partner");
  expect(queue.getAllByRole("listitem")).toHaveLength(1);
  expect(queue.getByText("Fictional request 25")).toBeVisible();
  expect(queue.getByRole("link", { name: "Auftrag öffnen" })).toHaveAttribute(
    "href",
    `/jobs/${job}`,
  );
  await user.clear(initialSearch);
  expect(queue.getAllByRole("listitem")).toHaveLength(8);
  scrollToMore();
  expect(queue.getByRole("status")).toHaveTextContent("16 von 25 Anfragen");
  scrollToMore();
  expect(queue.getByRole("status")).toHaveTextContent("24 von 25 Anfragen");
  await user.click(
    queue.getByRole("button", { name: "Weitere Anfragen anzeigen" }),
  );
  expect(queue.getAllByRole("listitem")).toHaveLength(25);
  expect(
    queue.getAllByRole("link", { name: "Anfragen verwalten" })[0],
  ).toHaveAttribute("href", "/client");
});

// The forecast table deliberately overflows on narrow screens. Its wrapper
// must be reachable by normal Tab navigation so keyboard users can scroll it.
it("makes the forecast table a bilingual keyboard-reachable scroll group", async () => {
  const user = userEvent.setup();
  mount(<ControlCenterPage />);
  const table = await screen.findByRole("table");
  const scroll = table.parentElement!;
  await user.click(
    screen.getByLabelText(
      "Angenommene Wahrscheinlichkeit für offene Angebote und Anfragen (%)",
    ),
  );
  await user.tab();
  expect(
    screen.getByRole("button", { name: "Szenario berechnen" }),
  ).toHaveFocus();
  await user.tab();
  expect(
    screen.getByRole("button", {
      name: "Finanzszenario als CSV herunterladen",
    }),
  ).toHaveFocus();
  await user.tab();
  expect(scroll).toHaveFocus();
  expect(screen.getByRole("group", { name: "Finanzszenario" })).toBe(scroll);
  expect(scroll).toContainElement(table);
  await act(async () => {
    await i18n.changeLanguage("en");
  });
  expect(screen.getByRole("group", { name: "Financial scenario" })).toBe(
    scroll,
  );
  expect(scroll).toHaveFocus();
  expect(within(scroll).getByRole("table")).toBe(table);
});

it("exports the applied scenario while masking gross columns without the current permission", async () => {
  const user = userEvent.setup();
  const period = { from: "2020-01-01", until: "2020-02-01" };
  const forecast = fake.responses.finance_forecast as {
    gross_authorized: boolean;
    months: Array<Record<string, unknown>>;
  };
  forecast.gross_authorized = true;
  Object.assign(forecast.months[0], {
    accepted_gross_known: 500,
    accepted_margin_known: 200,
    unknown_gross_claims: 1,
    pipeline_lecturer_cost_known: null,
    pipeline_cost_unknown_positions: 2,
    pipeline_margin_known: -50,
    pipeline_margin_unknown_positions: 3,
  });
  mount(
    <ForecastExport
      actor={teacher}
      boundary={null}
      period={period}
      probability={0}
      hasRows
    />,
  );
  const button = screen.getByRole("button", {
    name: "Finanzszenario als CSV herunterladen",
  });
  await user.click(button);
  await waitFor(() => expect(fake.download).toHaveBeenCalledTimes(1));
  const [filename, [header, row]] = fake.download.mock.calls[0]!;
  expect(filename).toBe("luminovia-forecast-2020-01-01-2020-02-01.csv");
  expect(header).not.toContain("Bekannter Bruttoumsatz");
  expect(header).not.toContain("Gewichtete Marge bepreister Angebote");
  expect(row).toContain(null);
  expect(row).toContain(2);
  await waitFor(() => expect(button).toBeEnabled());
  fake.responses.get_my_permissions = [
    "jobs.manage",
    "finance.manage",
    "finance.gross.read",
  ];
  await user.click(button);
  await waitFor(() => expect(fake.download).toHaveBeenCalledTimes(2));
  const [, [authorisedHeader, authorisedRow]] = fake.download.mock.calls[1]!;
  expect(authorisedHeader).toContain("Bekannter Bruttoumsatz");
  expect(authorisedRow).toContain(500);
  expect(
    authorisedRow[
      authorisedHeader.indexOf("Gewichtete Marge bepreister Angebote")
    ],
  ).toBe(-50);
  expect(
    authorisedRow[
      authorisedHeader.indexOf("Offene Positionen ohne berechenbare Marge")
    ],
  ).toBe(3);
});

it("does not fetch any privileged Control Center or forecast data without current management permission", async () => {
  fake.responses.get_my_permissions = [];
  mount(<ControlCenterPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Managementberechtigung",
  );
  expect(fake.rpc).toHaveBeenCalledTimes(1);
  expect(fake.rpc).toHaveBeenCalledWith("get_my_permissions");
});

it("keeps an open role-dependent cost unknown in both languages instead of rendering a zero fee", async () => {
  const forecast = fake.responses.finance_forecast as {
    months: Array<Record<string, unknown>>;
  };
  forecast.months[0]!.pipeline_lecturer_cost_known = null;
  forecast.months[0]!.pipeline_cost_unknown_positions = 3;
  mount(<ControlCenterPage />);
  const table = await screen.findByRole("table");
  const marker = await within(table).findByText(
    "3 offene Positionen ohne verbindlich vereinbarte persönliche Vergütung",
  );
  const cell = marker.closest("td")!;
  expect(cell).toHaveTextContent("Nicht verfügbar");
  expect(cell).not.toHaveTextContent(/0[,.]00/);
  await act(async () => {
    await i18n.changeLanguage("en");
  });
  expect(cell).toHaveTextContent("Not available");
  expect(cell).toHaveTextContent(
    "3 open positions without agreed personal compensation",
  );
});

it("rejects impossible and oversized periods before any new data request", () => {
  for (const period of [
    { from: "2020-02-30", until: "2020-03-02" },
    { from: "2020-01-01", until: "2020-01-01" },
    { from: "2020-01-01", until: "2021-01-01" },
  ])
    expect(financePeriodSchema.safeParse(period).success).toBe(false);
  expect(
    financePeriodSchema.safeParse({ from: "2020-01-01", until: "2020-02-01" })
      .success,
  ).toBe(true);
});
