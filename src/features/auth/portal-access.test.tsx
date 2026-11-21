/** The private shell only mounts after an affirmative current server response. */
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { PortalAccess } from "./portal-access";
import "../../lib/i18n";

const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "fictional" } } }),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
afterEach(cleanup);

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <PortalAccess>
        <p>Private workspace</p>
      </PortalAccess>
    </QueryClientProvider>,
  );
}

it("does not mount private content when a retained token receives REST permission denial", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
  show();
  expect(
    await screen.findByText(/Dein Konto hat keinen Portalzugriff/),
  ).toBeInTheDocument();
  expect(screen.queryByText("Private workspace")).not.toBeInTheDocument();
});
it("mounts private content after positive database membership confirmation", async () => {
  state.rpc.mockResolvedValue({ data: true, error: null });
  show();
  expect(await screen.findByText("Private workspace")).toBeInTheDocument();
  expect(state.rpc).toHaveBeenCalledWith("portal_access");
});
