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
import { DateTime } from "luxon";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AnalyticsPage } from "./analytics";
import { analyticsPreset, analyticsUntil } from "./api";
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
          (["EUR", "AUD"] as const).map((currency) => [
            currency,
            {
              past_net: scope === "personal" ? 50 : null,
              future_net: scope === "personal" ? 100 : null,
              past_gross:
                scope === "company" ? (currency === "EUR" ? 250 : 450) : null,
              future_gross: scope === "company" ? 100 : null,
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

function openAnalytics(access: AnalyticsAccess, canModel = false) {
  rpc.mockImplementation(
    (
      name: string,
      input?: { p_scope: string; p_pipeline_probability?: number },
    ) => {
      const report = fakeReport(input?.p_scope ?? "");
      report.can_model_pipeline = canModel;
      const forecast = {
        from: "2026-11-01",
        until: "2027-01-30",
        time_zone: "Europe/Berlin",
        pipeline_probability: input?.p_pipeline_probability,
        gross_authorized: false,
        payment_basis: "lecturer_invoice_payment_records",
        months: [],
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
      <AnalyticsPage />
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
    screen.queryByRole("option", { name: "Customer fees" }),
  ).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("View"), "company");
  await screen.findByRole("option", { name: "Customer fees" });
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
  await screen.findByText("Estimated lecturer costs");
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
});
