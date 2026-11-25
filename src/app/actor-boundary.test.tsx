/**
 * Regressions for direct account changes, retained local state for the same actor and the public
 * Auth callback. Focused SDK/DOM fixtures do not replace the separate real
 * Auth/RLS/Storage/browser acceptance suite.
 */
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { AuthProvider } from "../features/auth/auth-context";
import { App } from "./app";
import "../lib/i18n";

const state = vi.hoisted(() => ({
  actor: "actor-a",
  roles: ["lecturer"],
  permissions: [] as string[],
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
      data:
        name === "portal_access"
          ? true
          : name === "get_my_permissions"
            ? state.permissions
            : name === "knowledge_access"
              ? { can_author: !state.roles.includes("client") }
              : [],
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
                ? state.roles.map((role) => ({ role }))
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
const { accountPage } = vi.hoisted(() => ({ accountPage: vi.fn() }));
vi.mock("../features/accounts/accounts", () => ({
  AccountsPage: () => {
    accountPage();
    return <h1>Fictional account administration</h1>;
  },
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
  state.roles = ["lecturer"];
  state.permissions = [];
  state.callback = null;
  accountPage.mockClear();
});

/** Observe the Router URL without exposing it in the real recovery page. */
function CurrentLocation() {
  const { pathname, search } = useLocation();
  return <output aria-label="Current location">{pathname + search}</output>;
}

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
        <CurrentLocation />
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
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
  const client = setup();
  await screen.findByText("Fictional workspace");
  const search = screen
    .getByRole("banner")
    .querySelector<HTMLInputElement>("#portal-global-search")!;
  fireEvent.change(search, {
    target: { value: "Private actor A search draft" },
  });
  expect(search).toHaveValue("Private actor A search draft");
  client.setQueryData(
    ["private", "actor-a"],
    "Previously authorised private query",
  );
  await sessionEvent("SIGNED_IN", "actor-b");
  await screen.findByText("Fictional workspace");
  expect(client.getQueryData(["private", "actor-a"])).toBeUndefined();
  expect(document.querySelector("#portal-global-search")).toHaveValue("");
});
it("preserves protected local drafts on same-actor token refresh and rerenders", async () => {
  setup();
  await screen.findByText("Fictional workspace");
  const search = screen
    .getByRole("banner")
    .querySelector<HTMLInputElement>("#portal-global-search")!;
  fireEvent.change(search, { target: { value: "Same actor draft" } });
  await sessionEvent("TOKEN_REFRESHED", "actor-a");
  expect(
    (await screen.findByRole("banner")).querySelector("#portal-global-search"),
  ).toHaveValue("Same actor draft");
});
it("keeps the public invitation/recovery callback mounted when Auth establishes another actor", async () => {
  setup("/auth/callback");
  const input = await screen.findByLabelText("Public callback state");
  fireEvent.change(input, {
    target: { value: "Pending native callback continuation" },
  });
  await waitFor(() => expect(state.callback).not.toBeNull());
  await sessionEvent("SIGNED_IN", "actor-b");
  expect(screen.getByLabelText("Public callback state")).toHaveValue(
    "Pending native callback continuation",
  );
});

it.each([
  ["lecturer", "/admin"],
  ["lecturer", "/admin/accounts"],
  ["lecturer", "/control-center"],
  ["client", "/ADMIN/ACCOUNTS/"],
  ["client", "/reset"],
  ["client", "/chats/forum"],
  ["lecturer", "/missing-page?private=example"],
])(
  "shows the same actionable 404 at the original URL for %s on %s",
  async (role, path) => {
    state.roles = [role];
    setup(path);
    const heading = await screen.findByRole("heading", {
      name: /Diese Seite wurde nicht gefunden|This page could not be found/,
    });
    expect(heading).toHaveFocus();
    expect(screen.getByLabelText("Current location")).toHaveTextContent(path);
    expect(
      screen.getByRole("link", { name: /Zur Übersicht|Go to overview/ }),
    ).toHaveAttribute("href", "/");
    expect(
      screen.getByRole("link", { name: /Hilfe öffnen|Open help/ }),
    ).toHaveAttribute("href", "/help?topic=troubleshooting");
    expect(accountPage).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("heading", { name: /^(Verwaltung|Administration)$/ }),
    ).not.toBeInTheDocument();
  },
);

it("allows the authorized administration destination and unmounts it when its permission is lost", async () => {
  state.roles = ["management"];
  state.permissions = ["users.manage", "jobs.manage"];
  const client = setup("/admin/accounts");
  expect(
    await screen.findByRole("heading", {
      name: "Fictional account administration",
    }),
  ).toBeVisible();
  act(() => client.setQueryData(["permissions", "actor-a"], ["jobs.manage"]));
  expect(
    await screen.findByRole("heading", {
      name: /Diese Seite wurde nicht gefunden|This page could not be found/,
    }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Fictional account administration" }),
  ).not.toBeInTheDocument();
});
