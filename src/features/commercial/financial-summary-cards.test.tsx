/** Verify that another account or finance destination cannot reuse dashboard details. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { FinancialSummaryCards } from "./financial-summary-cards";

const fake = vi.hoisted(() => ({
  actor: "owner",
  rpc: vi.fn(),
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: fake.actor } } }),
}));
vi.mock("../../lib/supabase", () => ({ db: () => fake }));

const platform = [
  {
    kind: "platform",
    currency: "EUR",
    amount: 69.01,
    accepted_gross: 100.01,
    organisation_id: null,
    organisation_name: null,
  },
];
const clients: QueryClient[] = [];

function renderCards() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(queryClient);
  const cards = () => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FinancialSummaryCards />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(cards());
  return { ...view, refresh: () => view.rerender(cards()) };
}

function reply(data: unknown[], error?: Error) {
  fake.rpc.mockReturnValueOnce({
    abortSignal: vi.fn().mockResolvedValue({ data, error }),
  });
}

describe("dashboard finance cards", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    fake.actor = "owner";
    fake.rpc.mockReset();
  });

  afterEach(() => {
    cleanup();
    for (const client of clients.splice(0)) client.clear();
  });

  it("opens the existing revenue report after one scoped request and reloads for another actor", async () => {
    reply(platform);
    const view = renderCards();
    const link = await screen.findByRole("link");
    expect(link.getAttribute("href")).toBe("/admin/finance");
    expect(link.textContent).toContain("69.01");
    expect(link.textContent).toContain("100.01");
    expect(fake.rpc.mock.calls).toEqual([["dashboard_financial_summary"]]);

    fake.actor = "lecturer";
    reply([
      {
        kind: "lecturer",
        currency: "AUD",
        amount: 32.04,
        accepted_gross: null,
        organisation_id: null,
        organisation_name: null,
      },
    ]);
    view.refresh();
    expect(screen.queryByText(/69\.01/)).toBeNull();
    const ownLink = await screen.findByRole("link", {
      name: /Your accepted compensation/,
    });
    expect(ownLink.getAttribute("href")).toBe("/finance");
    expect(fake.rpc.mock.calls).toEqual([
      ["dashboard_financial_summary"],
      ["dashboard_financial_summary"],
    ]);
  });

  it("retries failed totals and links company cards to the company portal", async () => {
    reply([], new Error("Finance unavailable"));
    renderCards();
    const retry = await screen.findByRole("button", { name: /try again/i });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("href")),
    ).toEqual(["/help?topic=troubleshooting"]);
    reply([
      {
        kind: "client",
        currency: "CHF",
        amount: 500,
        accepted_gross: null,
        organisation_id: "4143259f-f1e8-44ca-979c-fbd82843e182",
        organisation_name: "Fictional training company",
      },
    ]);
    fireEvent.click(retry);
    const link = await screen.findByRole("link", {
      name: /Fictional training company/,
    });
    expect(link.getAttribute("href")).toBe("/client");
    expect(link.textContent).toContain("Confirmed assignment spend");
  });

  it("keeps empty or inaccessible summaries out of navigation", async () => {
    reply([]);
    renderCards();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.queryByRole("link")).toBeNull();
    expect(fake.rpc).toHaveBeenCalledTimes(1);
  });
});
