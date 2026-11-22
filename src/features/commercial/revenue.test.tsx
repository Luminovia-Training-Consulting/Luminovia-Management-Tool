/**
 * Regressions proving a missing gross-price capability triggers neither requests nor rendering
 * of private revenue data. Mocked capability projections do not establish native access
 * controls.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { RevenuePanel } from "./revenue";
import { commissionKeys } from "./commission-api";

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
