/**
 * Regressions for direct account changes, retained local state for the same actor and the public
 * Auth callback. Focused SDK/DOM fixtures do not replace the separate real
 * Auth/RLS/Storage/browser acceptance suite.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { AuthProvider } from "../features/auth/auth-context";
import { App } from "./app";
import "../lib/i18n";
const state = vi.hoisted(() => ({
  actor: "actor-a",
  callback: null as
    null | ((event: AuthChangeEvent, session: Session | null) => void),
}));
vi.mock("../lib/supabase", () => ({
  isConfigured: true,
  supabase: {
    auth: {
      onAuthStateChange: (callback: typeof state.callback) => {
        state.callback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: async () => ({
        data: {
          session: {
            user: { id: state.actor, email: `${state.actor}@example.invalid` },
          },
        },
        error: null,
      }),
    },
  },
  db: () => ({
    rpc: async (name: string) => ({
      data: name === "portal_access" ? true : [],
      error: null,
    }),
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "limit", "maybeSingle"])
        builder[method] = () => builder;
      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data:
            table === "profiles"
              ? {
                  id: state.actor,
                  active: true,
                  display_name: "Fictional User",
                  time_zone: "Europe/Berlin",
                }
              : table === "user_roles"
                ? [{ role: "lecturer" }]
                : [],
          error: null,
        }).then(resolve);
      return builder;
    },
  }),
}));
vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    needRefresh: [false, vi.fn()],
    updateServiceWorker: vi.fn(),
  }),
}));
vi.mock("../features/profile/avatar", () => ({
  Avatar: () => <span>Avatar</span>,
}));
vi.mock("../features/dashboard/dashboard", () => ({
  Dashboard: () => <p>Fictional workspace</p>,
}));
vi.mock("../features/auth/callback", async () => {
  const { useState } = await import("react");
  const { useAuth } = await import("../features/auth/auth-context");
  return {
    AuthCallback: () => {
      useAuth();
      const [draft, setDraft] = useState("");
      return (
        <input
          aria-label="Public callback state"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      );
    },
  };
});
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
  state.actor = "actor-a";
  state.callback = null;
});
/** Render the subject with local provider/router fixtures and an isolated QueryClient. */
function setup(path = "/") {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, user: userEvent.setup() };
}
/** Emit the native Auth event fixture and wait for the resulting React state updates. */
async function sessionEvent(event: AuthChangeEvent, actor: string) {
  await act(async () => {
    state.actor = actor;
    state.callback!(event, {
      user: { id: actor, email: `${actor}@example.invalid` },
      access_token: `fictional-${actor}`,
    } as Session);
  });
}
it("clears real Shell local search state when a native Auth event changes actor without sign-out", async () => {
  const { client, user } = setup();
  await screen.findByText("Fictional workspace");
  // The persisted desktop rail starts compact, so open its search control first.
  const search = screen
    .getByRole("banner")
    .querySelector<HTMLInputElement>("#portal-global-search")!;
  await user.type(search, "Private actor A search draft");
  client.setQueryData(
    ["private", "actor-a"],
    "Previously authorised private query",
  );
  await sessionEvent("SIGNED_IN", "actor-b");
  await screen.findByText("Fictional workspace");
  expect(client.getQueryData(["private", "actor-a"])).toBeUndefined();
  expect(document.querySelector("#mobile-global-search")).toHaveValue("");
});
it("preserves protected local drafts on same-actor token refresh and rerenders", async () => {
  const { user } = setup();
  await screen.findByText("Fictional workspace");
  const search = screen
    .getByRole("banner")
    .querySelector<HTMLInputElement>("#portal-global-search")!;
  await user.type(search, "Same actor draft");
  await sessionEvent("TOKEN_REFRESHED", "actor-a");
  expect(
    screen.getByRole("banner").querySelector("#portal-global-search"),
  ).toHaveValue("Same actor draft");
});
it("keeps the public invitation/recovery callback mounted when Auth establishes another actor", async () => {
  const { user } = setup("/auth/callback");
  const input = await screen.findByLabelText("Public callback state");
  await user.type(input, "Pending native callback continuation");
  await waitFor(() => expect(state.callback).not.toBeNull());
  await sessionEvent("SIGNED_IN", "actor-b");
  expect(screen.getByLabelText("Public callback state")).toHaveValue(
    "Pending native callback continuation",
  );
});
