/**
 * Regressions proving a missing gross-price capability triggers neither requests nor rendering
 * of private revenue data. Mocked capability projections do not establish native access
 * controls.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../../lib/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { RevenuePanel } from "./revenue";
import { commissionKeys, type CommissionRecord } from "./commission-api";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "lecturer" } } }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("never renders or fetches gross report data for an actor without that capability", () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(commissionKeys.access("lecturer"), {
    can_manage_gross: false,
    can_request: false,
    can_manage_client_memberships: false,
  });
  client.setQueryData(
    [...commissionKeys.report("lecturer"), null],
    [{ title: "Confidential full contract fee", gross_total_amount: 2500 }],
  );
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RevenuePanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    screen.queryByText("Confidential full contract fee"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/Plattformerlöse/)).not.toBeInTheDocument();
  expect(rpc).not.toHaveBeenCalled();
});

it("limits rendered revenue, searches past the first batch and restarts the list after filtering", async () => {
  await i18n.changeLanguage("de");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(commissionKeys.access("lecturer"), {
    can_manage_gross: true,
  });
  const rows: CommissionRecord[] = Array.from({ length: 25 }, (_, index) => ({
    job_id: `job-${index}`,
    claim_id: null,
    organisation_id: null,
    organisation_name: "Fictional academy",
    title: `Fictional course ${index + 1}`,
    status: "draft",
    pricing_model: "commission",
    currency: "EUR",
    gross_amount: 1500,
    gross_total_amount: 1500,
    platform_percent: 20,
    platform_total_amount: 300,
    lecturer_net_amount: 1200,
    lecturer_net_total_amount: 1200,
    lecturer_id: null,
    lecturer_name: null,
    accepted_at: null,
  }));
  client.setQueryData([...commissionKeys.report("lecturer"), null], rows);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RevenuePanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const getList = () =>
    within(
      screen.getByRole("region", { name: "Auftragsvolumen & Plattformerlöse" }),
    );
  expect(getList().getAllByRole("row")).toHaveLength(13);
  await userEvent.click(
    getList().getByRole("button", { name: "Weitere Einträge laden" }),
  );
  expect(getList().getAllByRole("row")).toHaveLength(25);
  const search = screen.getByRole("searchbox", {
    name: "Aufträge, Unternehmen oder Dozierende suchen",
  });
  await userEvent.type(search, "25");
  expect(
    getList().getByRole("link", { name: "Fictional course 25" }),
  ).toBeVisible();
  expect(getList().getAllByRole("row")).toHaveLength(2);
  await userEvent.clear(search);
  expect(getList().getAllByRole("row")).toHaveLength(13);
});
