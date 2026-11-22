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
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountsPage } from "./accounts";
import { accountRoles } from "./api";

const fake = vi.hoisted(() => ({
  adminCatalog: false,
  capabilities: [] as string[],
  companyAccess: false,
  invoke: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("../commercial/lecturer-compensation", () => ({
  LecturerCompensation: ({ userId }: { userId: string }) => (
    <span data-testid="lecturer-compensation">{userId}</span>
  ),
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "own-actor" } } }),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: fake.rpc,
    functions: { invoke: fake.invoke },
    from: (table: string) => {
      const query = {
        select: () => query,
        is: () => query,
        eq: () => query,
        order: () => query,
        then: (resolve: (result: unknown) => unknown) =>
          Promise.resolve({
            data:
              table === "organisations"
                ? [{ id: "company-a", name: "Fictional conversion company" }]
                : [],
            error: null,
          }).then(resolve),
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
  fake.adminCatalog = false;
  fake.capabilities = [];
  fake.companyAccess = false;
  fake.invoke.mockReset();
  fake.rpc.mockReset();
  fake.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "commission_access"
        ? { can_manage_client_memberships: fake.companyAccess }
        : fake.capabilities,
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
            ...(fake.adminCatalog ? ["admin", "management"] : []),
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
            luminovia_user_id: "LV-ABCD-1234-5678-9ABC-DEF0",
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
    expect(
      screen.getByText("LV-ABCD-1234-5678-9ABC-DEF0", { exact: true }),
    ).toBeVisible();
  });
  it("offers only server-approved subordinate roles in editing and invitations", async () => {
    fake.capabilities = ["users.manage", "users.roles.manage"];
    page();
    const edit = await screen.findByRole("button", {
      name: "Rollen bearbeiten",
    });
    await waitFor(() => expect(edit).toBeEnabled());
    await userEvent.click(edit);
    expect(
      await screen.findByRole("checkbox", { name: "Senior-Dozent:in" }),
    ).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Gast" })).toBeVisible();

    expect(
      screen.getByRole("checkbox", { name: "Kursteilnehmer:in" }),
    ).toBeVisible();
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
  it("offers management and administrative roles when the server catalog authorizes an admin", async () => {
    fake.capabilities = ["users.manage", "users.roles.manage"];
    fake.adminCatalog = true;
    page();
    const edit = await screen.findByRole("button", {
      name: "Rollen bearbeiten",
    });
    await waitFor(() => expect(edit).toBeEnabled());
    await userEvent.click(edit);
    expect(
      await screen.findByRole("checkbox", { name: "Administration" }),
    ).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Management" })).toBeVisible();
    expect(
      screen.queryByRole("checkbox", {
        name: "Inhaberin / Plattformleitung",
      }),
    ).not.toBeInTheDocument();
  });
  it("adds management and learner capabilities while preserving the existing lecturer role", async () => {
    fake.capabilities = ["users.manage", "users.roles.manage"];
    fake.adminCatalog = true;
    page();
    const edit = await screen.findByRole("button", {
      name: "Rollen bearbeiten",
    });
    await waitFor(() => expect(edit).toBeEnabled());
    await userEvent.click(edit);
    expect(screen.getByRole("checkbox", { name: "Dozent:in" })).toBeChecked();
    await userEvent.click(screen.getByRole("checkbox", { name: "Management" }));
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Kursteilnehmer:in" }),
    );
    expect(
      screen.getByText(/An eingeschriebenen Kursen teilnehmen/),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Rollen speichern" }),
    );
    const confirmation = await screen.findByRole("dialog", {
      name: "Rollen für Anna ändern?",
    });
    await userEvent.click(
      within(confirmation).getByRole("button", { name: "Rollen speichern" }),
    );
    await waitFor(() =>
      expect(fake.invoke).toHaveBeenCalledWith(
        "accounts/v1/users/teacher-id/roles",
        {
          method: "PUT",
          body: { roles: ["lecturer", "management", "participant"] },
        },
      ),
    );
  });
  it("requires an authorised organisation before converting a lecturer to a company", async () => {
    fake.capabilities = ["users.manage", "users.roles.manage"];
    page();
    const edit = await screen.findByRole("button", {
      name: "Rollen bearbeiten",
    });
    await waitFor(() => expect(edit).toBeEnabled());
    await userEvent.click(edit);
    await userEvent.click(
      await screen.findByRole("checkbox", { name: "Dozent:in" }),
    );
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Unternehmen" }),
    );
    expect(
      screen.getByRole("button", { name: "Rollen speichern" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "Die Administration ordnet diesem Konto anschließend eine Organisation zu.",
      ),
    ).toBeVisible();
    expect(
      fake.invoke.mock.calls.some((call) => call[1]?.method === "PUT"),
    ).toBe(false);
  });
  it("sends company role conversion and chosen organisation together after confirmation", async () => {
    fake.capabilities = ["users.manage", "users.roles.manage"];
    fake.companyAccess = true;
    page();
    const edit = await screen.findByRole("button", {
      name: "Rollen bearbeiten",
    });
    await waitFor(() => expect(edit).toBeEnabled());
    await userEvent.click(edit);
    await userEvent.click(
      await screen.findByRole("checkbox", { name: "Dozent:in" }),
    );
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Unternehmen" }),
    );
    expect(
      screen.getByRole("button", { name: "Rollen speichern" }),
    ).toBeDisabled();
    await userEvent.selectOptions(
      await screen.findByLabelText("Zugeordnetes Unternehmen"),
      "company-a",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Rollen speichern" }),
    );
    await userEvent.click(
      screen.getAllByRole("button", { name: "Rollen speichern" }).at(-1)!,
    );
    await waitFor(() =>
      expect(fake.invoke).toHaveBeenCalledWith(
        "accounts/v1/users/teacher-id/roles",
        {
          method: "PUT",
          body: { roles: ["client"], organisation_id: "company-a" },
        },
      ),
    );
  });
  it("does not mount lecturer compensation for a company account", async () => {
    fake.capabilities = ["users.manage", "users.roles.manage"];
    const previous = fake.invoke.getMockImplementation()!;
    fake.invoke.mockImplementation(async (path: string) => {
      const result = await previous(path);
      if (path.includes("/users?")) result.data.items[0].roles = ["client"];
      return result;
    });
    page();
    const edit = await screen.findByRole("button", {
      name: "Rollen bearbeiten",
    });
    await waitFor(() => expect(edit).toBeEnabled());
    await userEvent.click(edit);
    expect(
      screen.queryByTestId("lecturer-compensation"),
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
      screen.queryByRole("button", {
        name: "Rollen bearbeiten",
      }),
    ).not.toBeInTheDocument();
  });
});
