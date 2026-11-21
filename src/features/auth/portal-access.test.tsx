/** The private shell only mounts after an affirmative current server response. */
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { PortalAccess } from "./portal-access";
import "../../lib/i18n";

const state = vi.hoisted(() => ({ rpc: vi.fn(), online: true }));
vi.mock("./auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "fictional" } } }),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../../lib/online", () => ({ useOnline: () => state.online }));
vi.mock("../calendar/offline", () => ({
  OfflineSchedule: ({ actor, minimal }: { actor: string; minimal: boolean }) =>
    minimal && <p>Only the opted-in schedule for {actor}</p>,
}));
afterEach(() => {
  cleanup();
  state.online = true;
  state.rpc.mockReset();
});

function show(knownAccess?: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (knownAccess !== undefined)
    client.setQueryData(["portal-access", "fictional"], knownAccess);
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

it("renders only the actor-bound offline schedule on a cold offline launch", () => {
  state.online = false;
  show();
  expect(
    screen.getByText("Only the opted-in schedule for fictional"),
  ).toBeVisible();
  expect(screen.queryByText("Private workspace")).not.toBeInTheDocument();
  expect(state.rpc).not.toHaveBeenCalled();
});

it("does not offer the retained schedule after a known access denial", () => {
  state.online = false;
  show(false);
  expect(screen.getByText(/Dein Konto hat keinen Portalzugriff/)).toBeVisible();
  expect(
    screen.queryByText(/Only the opted-in schedule/),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Private workspace")).not.toBeInTheDocument();
});
