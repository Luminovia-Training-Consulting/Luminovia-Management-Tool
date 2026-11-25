import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { DateTime } from "luxon";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AnalyticsPage } from "./analytics";
import { ProfileOutlook } from "./profile-outlook";
import { analyticsPreset, analyticsUntil } from "./period";
import type { AnalyticsAccess, AnalyticsReport } from "./schema";
import i18n from "../../lib/i18n";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "fictional-actor" } } }),
}));

const company = "9b542f92-ed1d-43a0-a51f-28ab7042f8a1";

function fakeReport(scope: string): AnalyticsReport {
  return {
    time_zone: "Europe/Berlin",
    can_model_pipeline: false,
    months: [
      {
        month: "2026-11-01",
        history: true,
        forecast: true,
        past_assignments: 2,
        future_assignments: 3,
        past_minutes: 120,
        future_minutes: 360,
        open_positions: scope === "staff" ? 4 : null,
        currencies: Object.fromEntries(
          (["EUR", "AUD", "USD", "CHF"] as const).map((currency) => [
            currency,
            {
              past_net: scope !== "company" ? 50 : null,
              future_net: scope !== "company" ? 100 : null,
              past_gross:
                scope !== "personal"
                  ? { EUR: 250, AUD: 450, USD: 650, CHF: 850 }[currency]
                  : null,
              future_gross: scope !== "personal" ? 100 : null,
              missing_gross: scope === "company" ? 1 : null,
              lecturer_cash: scope === "personal" ? 25 : null,
              customer_cash: scope === "company" ? -20 : null,
            },
          ]),
        ) as AnalyticsReport["months"][number]["currencies"],
      },
    ],
  };
}

function openAnalytics(
  access: AnalyticsAccess,
  canModel = false,
  path = "/analytics",
  scope?: "personal" | "staff",
  grossForecast = false,
  personalScenario = false,
) {
  rpc.mockImplementation(
    (
      name: string,
      input?: { p_scope: string; p_pipeline_probability?: number },
    ) => {
      const report = fakeReport(input?.p_scope ?? "");
      report.can_model_pipeline = canModel;
      if (grossForecast && input?.p_scope === "staff") {
        const amounts = report.months[0].currencies.EUR;
        amounts.customer_cash = 340;
        amounts.lecturer_cash = 140;
      }
      if (input?.p_scope === "staff") {
        report.months.push({
          ...report.months[0],
          month: "2026-12-01",
          history: false,
          past_assignments: 0,
          past_minutes: 0,
          open_positions: 0,
        });
      }
      if (personalScenario && input?.p_scope === "personal") {
        const month = DateTime.now().setZone(report.time_zone).startOf("month");
        report.months[0].month = month.toISODate()!;
        report.months.push({
          ...report.months[0],
          month: month.plus({ months: 1 }).toISODate()!,
          history: false,
        });
      }
      const forecast = {
        from: "2026-11-01",
        until: "2027-01-30",
        time_zone: "Europe/Berlin",
        pipeline_probability: input?.p_pipeline_probability,
        gross_authorized: grossForecast,
        payment_basis: "lecturer_invoice_payment_records",
        months: [
          {
            month: "2026-11-01",
            currency: "EUR",
            accepted_lecturer_cost: 0,
            accepted_gross_known: grossForecast ? 1000 : null,
            accepted_margin_known: grossForecast ? 200 : null,
            unknown_gross_claims: grossForecast ? 1 : null,
            pipeline_lecturer_cost_known: null,
            pipeline_cost_unknown_positions: 1,
            pipeline_gross_known: grossForecast
              ? 400 * (input?.p_pipeline_probability ?? 0)
              : null,
            lecturer_invoice_payments: 0,
          },
          {
            month: "2026-12-01",
            currency: "EUR",
            accepted_lecturer_cost: 0,
            accepted_gross_known: grossForecast ? 500 : null,
            accepted_margin_known: grossForecast ? -25 : null,
            unknown_gross_claims: grossForecast ? 0 : null,
            pipeline_lecturer_cost_known: 100,
            pipeline_cost_unknown_positions: 0,
            pipeline_gross_known: grossForecast
              ? 200 * (input?.p_pipeline_probability ?? 0)
              : null,
            lecturer_invoice_payments: 0,
          },
        ],
      };
      const data =
        name === "analytics_access"
          ? access
          : name === "finance_forecast"
            ? forecast
            : report;
      return { abortSignal: async () => ({ data, error: null }) };
    },
  );
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[path]}>
        <AnalyticsPage scope={scope} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  rpc.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows known platform margin as a signed period total, with a missing-revenue warning", async () => {
  openAnalytics(
    {
      staff: true,
      personal: false,
      time_zone: "Europe/Berlin",
      organisations: [],
    },
    true,
    "/admin/finance/analytics",
    "staff",
    true,
  );
  const heading = await screen.findByRole("heading", {
    name: "Known platform margin",
  });
  const margin = within(heading.closest("section")!);
  expect(margin.getByText("€175.00", { selector: "dd" })).toBeVisible();
  expect(margin.getByText(/has no contract amount/)).toBeVisible();
  await userEvent.click(margin.getByText("Monthly values as a table"));
  expect(margin.getByText("-€25.00", { selector: "td" })).toBeVisible();
});

it("adds a currency-specific personal scenario without requesting administrative forecast data", async () => {
  openAnalytics(
    {
      staff: false,
      personal: true,
      time_zone: "Europe/Berlin",
      organisations: [],
    },
    false,
    "/finance/analytics",
    "personal",
    false,
    true,
  );
  const scenario = within(
    (
      await screen.findByRole("heading", {
        name: "Personal income scenario",
      })
    ).closest("section")!,
  );
  const amount = scenario.getByLabelText(
    "Extra income per full future month (EUR)",
  );
  await userEvent.type(amount, "75.25");
  expect(scenario.getByText("€75.25", { selector: "dd" })).toBeVisible();
  expect(scenario.getByText("€275.25", { selector: "dd" })).toBeVisible();
  await userEvent.selectOptions(screen.getByLabelText("Currency"), "AUD");
  expect(
    scenario.getByLabelText("Extra income per full future month (AUD)"),
  ).toHaveValue(null);
  expect(rpc.mock.calls.some(([name]) => name === "finance_forecast")).toBe(
    false,
  );
});

it("requests only the actor's next 90 days for the private profile outlook", async () => {
  rpc.mockReturnValue({
    abortSignal: async () => ({ data: fakeReport("personal"), error: null }),
  });
  const zone = "Australia/Brisbane";
  const now = DateTime.now().setZone(zone);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ProfileOutlook actor="fictional-actor" zone={zone} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("6 hr", { selector: "dd" })).toBeVisible();
  expect(document.querySelector(".analytics-data table")).toBeNull();
  await userEvent.click(screen.getByText("Monthly values as a table"));
  const table = await screen.findByRole("table");
  expect(within(table).getByText("6 hr", { selector: "td" })).toBeVisible();
  await userEvent.click(screen.getByText("Monthly values as a table"));
  await waitFor(() => expect(table).not.toBeInTheDocument());
  expect(
    screen.getByRole("link", { name: "Open my finance analytics" }),
  ).toHaveAttribute("href", "/finance/analytics");
  expect(rpc.mock.calls).toEqual([
    [
      "analytics_report",
      {
        p_scope: "personal",
        p_organisation_id: null,
        p_from: now.toISODate(),
        p_until: now.plus({ days: 90 }).toISODate(),
      },
    ],
  ]);
});

it("keeps company finance separate from teaching income and uses original currency", async () => {
  const user = userEvent.setup();
  openAnalytics({
    time_zone: "Europe/Berlin",
    staff: false,
    personal: true,
    organisations: [
      {
        id: company,
        name: "Fictional Academy",
        time_zone: "Australia/Brisbane",
        company: true,
      },
    ],
  });

  await screen.findByRole("heading", { name: "Financial trend" });
  expect(
    screen.getByRole("option", { name: "Lecturer compensation" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Contract fees" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Show in the assignment chart")).toBeNull();
  await user.selectOptions(screen.getByLabelText("View"), "company");
  await screen.findByRole("option", { name: "Contract fees" });
  expect(
    screen.getByText("Reporting time zone: Australia/Brisbane"),
  ).toBeInTheDocument();
  expect(screen.getByText("€250.00", { selector: "dd" })).toBeInTheDocument();
  expect(rpc).toHaveBeenCalledWith(
    "analytics_report",
    expect.objectContaining({
      p_scope: "company",
      p_organisation_id: company,
    }),
  );
  expect(
    screen.queryByRole("option", { name: "Recorded lecturer payments" }),
  ).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Currency"), "USD");
  expect(screen.getByText("$650.00", { selector: "dd" })).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Currency"), "CHF");
  expect(
    screen.getByText(/CHF\s*850\.00/, { selector: "dd" }),
  ).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Currency"), "AUD");
  expect(screen.getByText("A$450.00", { selector: "dd" })).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Metric"), "customerCash");
  expect(screen.getByText("-A$20.00", { selector: "dd" })).toBeInTheDocument();

  await user.click(screen.getAllByText("Monthly values as a table")[2]);
  const finance = screen
    .getByRole("heading", { name: "Financial trend" })
    .closest("section");
  expect(
    within(finance!).getByRole("columnheader", { name: "Recorded" }),
  ).toBeInTheDocument();
});

it("applies a selected staff company and an inclusive date range, with German labels", async () => {
  const user = userEvent.setup();
  await act(() => i18n.changeLanguage("de"));
  openAnalytics({
    time_zone: "Europe/Berlin",
    staff: true,
    personal: false,
    organisations: [
      {
        id: company,
        name: "Fiktive Akademie",
        time_zone: "Europe/Berlin",
        company: false,
      },
    ],
  });

  await screen.findByRole("heading", { name: "Bestätigte Aufträge" });
  expect(
    screen.getByRole("heading", { name: "Unterrichtszeit laut Terminplan" }),
  ).toBeInTheDocument();
  expect(screen.getAllByText("Offene Plätze")).not.toHaveLength(0);
  await user.selectOptions(
    screen.getByLabelText("Kennzahl im Monatsvergleich"),
    "monthlyHours",
  );
  expect(
    screen.getByRole("heading", { name: "Unterrichtsstunden pro Monat" }),
  ).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Unternehmen"), company);

  await user.click(screen.getByText("Eigenen Zeitraum wählen"));
  const from = screen.getByLabelText("Von");
  const through = screen.getByLabelText("Bis einschließlich");
  await user.clear(from);
  await user.type(from, "2026-10-01");
  await user.clear(through);
  await user.type(through, "2026-10-31");
  await user.click(screen.getByRole("button", { name: "Zeitraum anwenden" }));
  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith("analytics_report", {
      p_scope: "staff",
      p_from: "2026-10-01",
      p_until: "2026-11-01",
      p_organisation_id: company,
    }),
  );
});

it("applies the finance scenario probability and hides the global scenario when a company is selected", async () => {
  const user = userEvent.setup();
  openAnalytics(
    {
      time_zone: "Europe/Berlin",
      personal: false,
      staff: true,
      organisations: [
        {
          id: company,
          name: "Fictional Academy",
          time_zone: "Europe/Berlin",
          company: false,
        },
      ],
    },
    true,
  );
  const scenario = within(
    (
      await screen.findByRole("heading", { name: "Open work scenario" })
    ).closest("section")!,
  );
  await scenario.findByText("Estimated lecturer costs", { selector: "dt" });
  expect(scenario.getByText("Estimate unavailable")).toBeVisible();
  expect(scenario.queryByText("Estimated known contract fees")).toBeNull();
  await user.click(scenario.getByText("Monthly values as a table"));
  expect(scenario.getByText("€100.00", { selector: "td" })).toBeVisible();
  await user.selectOptions(screen.getByLabelText("Forecast window"), "30");
  const request = rpc.mock.calls
    .filter(([name]) => name === "finance_forecast")
    .at(-1)?.[1];
  expect(
    DateTime.fromISO(request.p_until).diff(
      DateTime.fromISO(request.p_from),
      "days",
    ).days,
  ).toBe(30);
  await user.selectOptions(
    screen.getByLabelText("Acceptance probability"),
    "0.75",
  );
  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith(
      "finance_forecast",
      expect.objectContaining({ p_pipeline_probability: 0.75 }),
    ),
  );
  await user.selectOptions(screen.getByLabelText("Company"), company);
  await screen.findByRole("heading", { name: "Confirmed assignments" });
  expect(
    screen.queryByRole("heading", { name: "Open work scenario" }),
  ).not.toBeInTheDocument();
});

it("combines confirmed and already weighted contract amounts without masking missing prices", async () => {
  const user = userEvent.setup();
  openAnalytics(
    {
      time_zone: "Europe/Berlin",
      staff: true,
      personal: false,
      organisations: [],
    },
    true,
    "/admin/finance/analytics",
    "staff",
    true,
  );
  const revenue = within(
    (await screen.findByRole("heading", { name: "Expected revenue" })).closest(
      "section",
    )!,
  );
  expect(revenue.getByText("€1,800.00", { selector: "dd" })).toBeVisible();
  expect(revenue.getByText(/one confirmed assignment/i)).toBeVisible();
  const cash = within(
    screen
      .getByRole("heading", { name: "Recorded monthly payments" })
      .closest("section")!,
  );
  await user.click(cash.getByText("Payments as a table"));
  expect(cash.getByText("€340.00", { selector: "td" })).toBeVisible();
  expect(cash.getByText("€140.00", { selector: "td" })).toBeVisible();
  await user.click(revenue.getByText("Monthly values as a table"));
  expect(revenue.getByText("€1,200.00", { selector: "td" })).toBeVisible();
  const costs = within(
    screen
      .getByRole("heading", { name: "Monthly lecturer costs" })
      .closest("section")!,
  );
  expect(costs.getByText("Estimate unavailable")).toBeVisible();
  await user.selectOptions(
    screen.getByLabelText("Acceptance probability"),
    "0",
  );
  await waitFor(() => {
    expect(
      screen.getByText("Expected known revenue", { selector: "dt" })
        .nextElementSibling,
    ).toHaveTextContent("€1,500.00");
  });
  expect(screen.queryByText("Estimate unavailable")).toBeNull();
});

it("shows an operations or a finance comparison without reloading the scoped report", async () => {
  const user = userEvent.setup();
  openAnalytics({
    time_zone: "Europe/Berlin",
    staff: true,
    personal: false,
    organisations: [],
  });
  const assignmentHeading = await screen.findByRole("heading", {
    name: "Confirmed assignments",
  });
  const assignments = within(assignmentHeading.closest("section")!);
  await user.selectOptions(
    assignments.getByLabelText("Show in the assignment chart"),
    "open",
  );
  expect(assignments.getByText("4", { selector: "dd" })).toBeVisible();
  expect(assignments.queryByText("Past", { selector: "dt" })).toBeNull();
  const finance = within(
    screen
      .getByRole("heading", { name: "Financial trend" })
      .closest("section")!,
  );
  await user.selectOptions(finance.getByLabelText("Metric"), "comparison");
  await user.selectOptions(finance.getByLabelText("Display"), "cumulative");
  await user.click(finance.getByText("Cumulative values as a table"));
  expect(
    finance.getByRole("columnheader", { name: "Contract fees" }),
  ).toBeVisible();
  expect(
    finance.getByRole("columnheader", { name: "Lecturer compensation" }),
  ).toBeVisible();
  expect(finance.getByText("€350.00", { selector: "td" })).toBeVisible();
  expect(finance.getByText("€450.00", { selector: "td" })).toBeVisible();
  expect(finance.getByText("€250.00", { selector: "td" })).toBeVisible();
  expect(
    rpc.mock.calls.filter(([name]) => name === "analytics_report"),
  ).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Reset filters" }));
  expect(screen.getByLabelText("Show in the assignment chart")).toHaveValue(
    "all",
  );
  expect(screen.getByLabelText("Display")).toHaveValue("monthly");
});

it("narrows a long company list without changing the active company or report", async () => {
  const user = userEvent.setup();
  const organisations = Array.from({ length: 9 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    name: `Fictional company ${index}`,
    time_zone: "Europe/Berlin",
    company: false,
  }));
  openAnalytics({
    time_zone: "Europe/Berlin",
    staff: true,
    personal: false,
    organisations,
  });
  await screen.findByRole("heading", { name: "Confirmed assignments" });
  const picker = screen.getByLabelText("Company", { selector: "select" });
  await user.selectOptions(picker, organisations[0].id);
  await screen.findByRole("heading", { name: "Confirmed assignments" });
  const calls = rpc.mock.calls.length;
  await user.type(
    screen.getByRole("searchbox", { name: "Search companies" }),
    "company 8",
  );
  expect(picker).toHaveValue(organisations[0].id);
  expect(
    within(picker).getByRole("option", { name: "Fictional company 8" }),
  ).toBeInTheDocument();
  expect(
    within(picker).queryByRole("option", { name: "Fictional company 1" }),
  ).toBeNull();
  expect(rpc.mock.calls).toHaveLength(calls);
});

it("validates dates and uses a 90-day outlook in the selected reporting zone", () => {
  expect(analyticsUntil({ from: "2024-02-29", through: "2024-02-29" })).toBe(
    "2024-03-01",
  );
  expect(
    analyticsUntil({ from: "2026-02-29", through: "2026-03-01" }),
  ).toBeNull();
  expect(
    analyticsUntil({ from: "2026-03-01", through: "2026-02-28" }),
  ).toBeNull();
  expect(analyticsUntil({ from: "2024-01-01", through: "2025-12-31" })).toBe(
    "2026-01-01",
  );
  expect(
    analyticsUntil({ from: "2024-01-01", through: "2026-01-01" }),
  ).toBeNull();
  const localDate = DateTime.fromISO("2026-12-31T20:30:00Z").setZone(
    "Australia/Brisbane",
  );
  const preset = analyticsPreset("nextQuarter", localDate);
  expect(preset.from).toBe("2027-01-01");
  expect(analyticsUntil(preset)).toBe("2027-04-01");
  expect(analyticsPreset("previousQuarter", localDate)).toEqual({
    from: "2026-10-01",
    through: "2026-12-31",
  });
  expect(analyticsPreset("yearToDate", localDate)).toEqual({
    from: "2027-01-01",
    through: "2027-01-01",
  });
});

it("opens the company report from a deep link for an administrator who belongs to a company", async () => {
  openAnalytics(
    {
      staff: true,
      personal: false,
      time_zone: "Europe/Berlin",
      organisations: [
        {
          id: company,
          name: "Fictional Academy",
          time_zone: "Europe/Berlin",
          company: true,
        },
      ],
    },
    false,
    "/analytics?scope=company",
  );
  await screen.findByRole("option", { name: "Contract fees" });
  expect(screen.getByLabelText("View")).toHaveValue("company");
  expect(
    rpc.mock.calls.filter(([name]) => name === "analytics_report"),
  ).toEqual([
    [
      "analytics_report",
      expect.objectContaining({
        p_scope: "company",
        p_organisation_id: company,
      }),
    ],
  ]);
});

it("disregards a company deep link when the caller has no company membership", async () => {
  openAnalytics(
    {
      staff: false,
      personal: true,
      time_zone: "Europe/Berlin",
      organisations: [],
    },
    false,
    "/analytics?scope=company",
  );
  await screen.findByRole("option", { name: "Lecturer compensation" });
  expect(
    rpc.mock.calls.filter(([name]) => name === "analytics_report"),
  ).toEqual([
    [
      "analytics_report",
      expect.objectContaining({ p_scope: "personal", p_organisation_id: null }),
    ],
  ]);
});

it("ignores a platform query parameter in a fixed personal analytics view", async () => {
  openAnalytics(
    {
      staff: true,
      personal: true,
      time_zone: "Europe/Berlin",
      organisations: [],
    },
    true,
    "/finance/analytics?scope=staff",
    "personal",
  );
  await screen.findByRole("heading", { name: "Financial trend" });
  expect(screen.queryByLabelText("View")).toBeNull();
  const finance = within(
    screen
      .getByRole("heading", { name: "Financial trend" })
      .closest("section")!,
  );
  expect(finance.getByLabelText("Display")).toHaveValue("monthly");
  await userEvent.selectOptions(
    finance.getByLabelText("Display"),
    "cumulative",
  );
  await userEvent.click(finance.getByText("Cumulative values as a table"));
  expect(
    finance.getByRole("columnheader", { name: "Confirmed, past" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Open work scenario" }),
  ).toBeNull();
  expect(
    rpc.mock.calls.filter(([name]) => name === "analytics_report"),
  ).toEqual([
    [
      "analytics_report",
      expect.objectContaining({ p_scope: "personal", p_organisation_id: null }),
    ],
  ]);
});
