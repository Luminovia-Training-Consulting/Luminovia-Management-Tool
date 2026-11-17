/**
 * Regressions for permission checks before account search and retained search focus during
 * pending page requests. SDK/DOM fixtures do not replace real account API/database acceptance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountsPage } from "./accounts";
import { accountRoles } from "./api";
const fake = vi.hoisted(() => ({
  capabilities: [] as string[],
  invoke: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "own-actor" } } }),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: fake.rpc,
    functions: { invoke: fake.invoke },
    from: () => {
      const query = {
        select: () => query,
        is: () => query,
        eq: () => query,
        order: () => query,
        then: (resolve: (result: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return query;
    },
  }),
}));
let client: QueryClient;
/** Render the real page in its router/query context for the interaction checks below. */
function page() {
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AccountsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  fake.capabilities = [];
  fake.invoke.mockReset();
  fake.rpc.mockReset();
  fake.rpc.mockImplementation(async () => ({
    data: fake.capabilities,
    error: null,
  }));
  fake.invoke.mockImplementation(async (path: string) => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (path.endsWith("/roles"))
      return {
        data: accountRoles.map((role) => ({
          role,
          permissions: [],
          assignable: [
            "lecturer",
            "senior_lecturer",
            "client",
            "participant",
            "guest",
          ].includes(role),
        })),
        error: null,
      };
    return {
      data: {
        items: [
          {
            id: "teacher-id",
            display_name: "Anna",
            email: "anna@example.invalid",
            active: true,
            locale: "de",
            time_zone: "Europe/Berlin",
            roles: ["lecturer"],
            can_assign_roles: true,
            can_change_active: true,
          },
        ],
        total: 1,
        limit: 25,
        offset: 0,
      },
      error: null,
    };
  });
});
afterEach(async () => {
  // Detach React observers before cancelling pending search requests.
  cleanup();
  await client.cancelQueries();
  client.clear();
  // The mocked transport ignores cancellation; let its real promises finish.
  await Promise.all(
    [...fake.rpc.mock.results, ...fake.invoke.mock.results]
      .filter((result) => result.type === "return")
      .map((result) => result.value),
  );
  // Flush already-queued query notifications while jsdom still owns window.
  await act(async () => {
    await new Promise<void>((resolve) => notifyManager.schedule(resolve));
  });
});
describe("Account administration", () => {
  it("does not request the private account directory before administrative permission is available", async () => {
    page();
    await screen.findByText(
      /Für die Kontoverwaltung sind aktuelle Verwaltungsrechte/,
    );
    expect(fake.invoke).not.toHaveBeenCalled();
    expect(screen.queryByText("anna@example.invalid")).not.toBeInTheDocument();
  });
  it("keeps search focus and typed input while successive real-query promises are pending", async () => {
    fake.capabilities = ["users.manage"];
    page();
    const input = await screen.findByRole("searchbox", {
      name: "Konten suchen",
    });
    await userEvent.type(input, "Anna");
    expect(input).toHaveFocus();
    expect(input).toHaveValue("Anna");
    await waitFor(() =>
      expect(
        fake.invoke.mock.calls.some((call) =>
          String(call[0]).includes("q=Anna"),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("anna@example.invalid")).toBeVisible();
  });
  it("offers only server-approved subordinate roles in editing and invitations", async () => {
    fake.capabilities = ["users.manage", "users.roles.manage"];
    page();
    const edit = await screen.findByRole("button", {
      name: "Rollen bearbeiten: Anna",
    });
    await waitFor(() => expect(edit).toBeEnabled());
    await userEvent.click(edit);
    expect(
      await screen.findByRole("checkbox", { name: "Senior-Dozent:in" }),
    ).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Gast" })).toBeVisible();
    expect(
      screen.queryByRole("checkbox", { name: "Management" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Administration" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Management" }),
    ).not.toBeInTheDocument();
  });
  it("does not offer editing for a server-protected target", async () => {
    fake.capabilities = ["users.manage", "users.roles.manage"];
    const previous = fake.invoke.getMockImplementation()!;
    fake.invoke.mockImplementation(async (path: string) => {
      const result = await previous(path);
      if (path.includes("/users?"))
        result.data.items[0].can_assign_roles = false;
      return result;
    });
    page();
    await screen.findByText("anna@example.invalid");
    expect(
      screen.queryByRole("button", { name: "Rollen bearbeiten: Anna" }),
    ).not.toBeInTheDocument();
  });
});
