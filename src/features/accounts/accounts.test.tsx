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
  directoryFilter: vi.fn(),
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
        eq: (field: string, value: string) => {
          fake.directoryFilter(table, field, value);
          return query;
        },
        order: () => query,
        maybeSingle: async () => ({
          data: { time_zone: "Europe/Berlin" },
          error: null,
        }),
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
  fake.directoryFilter.mockClear();
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
  it("opens the same person-bound contracts dialog from a lecturer's account row", async () => {
    fake.capabilities = ["users.manage", "contracts.manage"];
    const previous = fake.rpc.getMockImplementation()!;
    fake.rpc.mockImplementation(async (name: string) => {
      if (name === "commercial_access")
        return { data: { can_manage_contracts: true }, error: null };
      if (name === "commercial_people")
        return {
          data: [{ id: "teacher-id", display_name: "Anna" }],
          error: null,
        };
      if (name === "contract_records") return { data: [], error: null };
      return previous(name);
    });
    page();
    await userEvent.click(
      await screen.findByRole("button", { name: "Verträge verwalten: Anna" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Verträge verwalten",
    });
    expect(dialog).toHaveAccessibleDescription("Anna");
    expect(
      await within(dialog).findByRole("button", {
        name: "Ausgeführten Vertrag hinterlegen",
      }),
    ).toBeVisible();
    expect(fake.rpc).toHaveBeenCalledWith("contract_records", { p_all: true });
  });

  it("opens profile and expertise for the selected account and preserves profile drafts across views", async () => {
    fake.capabilities = ["users.manage", "qualifications.verify"];
    const previous = fake.rpc.getMockImplementation()!;
    fake.rpc.mockImplementation(async (name: string) =>
      name === "managed_profile"
        ? {
            data: {
              display_name: "Anna",
              locale: "de",
              time_zone: "Europe/Berlin",
            },
            error: null,
          }
        : previous(name),
    );
    page();
    await userEvent.click(await screen.findByRole("button", { name: "Anna" }));
    const details = within(
      screen.getByRole("dialog", { name: "Kontodetails" }),
    );
    const name = await details.findByLabelText("Anzeigename");
    await userEvent.type(name, " QA");
    expect(fake.directoryFilter).not.toHaveBeenCalledWith(
      "profiles",
      "id",
      "teacher-id",
    );
    await userEvent.click(
      details.getByRole("button", { name: "Person & Expertise" }),
    );
    expect(
      details.getByRole("button", { name: "Person & Expertise" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(details.getByTestId("lecturer-compensation")).toHaveTextContent(
      "teacher-id",
    );
    expect(details.getByTestId("lecturer-compensation")).toBeVisible();
    await waitFor(() => {
      expect(fake.directoryFilter).toHaveBeenCalledWith(
        "profiles",
        "id",
        "teacher-id",
      );
      expect(fake.directoryFilter).toHaveBeenCalledWith(
        "lecturer_topics",
        "user_id",
        "teacher-id",
      );
    });
    await userEvent.click(details.getByRole("button", { name: "Profil" }));
    expect(details.getByLabelText("Anzeigename")).toHaveValue("Anna QA");
  });
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
      screen.queryByRole("checkbox", { name: "Plattformmanagement" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Administration" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Plattformmanagement" }),
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
    expect(
      screen.getByRole("checkbox", { name: "Plattformmanagement" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("checkbox", {
        name: "Plattformleitung",
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
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Plattformmanagement" }),
    );
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
        "Für die Zuordnung eines Unternehmens sind aktuelle Verwaltungsrechte erforderlich.",
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
  it("assigns an existing organisation directly from a company account's details", async () => {
    fake.capabilities = [
      "users.manage",
      "users.roles.manage",
      "organisations.manage",
    ];
    fake.companyAccess = true;
    const previous = fake.invoke.getMockImplementation()!;
    fake.invoke.mockImplementation(async (path: string) => {
      const result = await previous(path);
      if (path.includes("/users?")) result.data.items[0].roles = ["client"];
      return result;
    });
    page();
    await userEvent.click(await screen.findByRole("button", { name: "Anna" }));
    const details = within(
      screen.getByRole("dialog", { name: "Kontodetails" }),
    );
    await userEvent.type(
      await details.findByRole("searchbox", { name: "Organisationen suchen" }),
      "conversion",
    );
    await userEvent.selectOptions(
      details.getByLabelText("Zugeordnetes Unternehmen"),
      "company-a",
    );
    await userEvent.click(
      details.getByRole("button", { name: "Organisation zuordnen" }),
    );
    expect(fake.invoke).toHaveBeenCalledWith(
      "accounts/v1/users/teacher-id/organisations/company-a",
      {
        method: "PUT",
      },
    );
    await details.findByText("Organisationszugriff wurde aktualisiert.");
    expect(fake.invoke).not.toHaveBeenCalledWith(
      "accounts/v1/users/teacher-id/roles",
      expect.anything(),
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
  it("shows own shortcuts and saves the administrator’s combined roles and company together", async () => {
    fake.capabilities = ["users.manage", "users.roles.manage"];
    fake.adminCatalog = true;
    fake.companyAccess = true;
    const previous = fake.invoke.getMockImplementation()!;
    fake.invoke.mockImplementation(async (path: string) => {
      const result = await previous(path);
      if (path.includes("/users?")) {
        Object.assign(result.data.items[0], {
          id: "own-actor",
          roles: ["admin"],
          can_assign_roles: false,
          can_change_active: false,
        });
      }
      return result;
    });
    page();
    await userEvent.click(await screen.findByRole("button", { name: "Anna" }));
    expect(
      await screen.findByRole("link", {
        name: "Mein Profil und meine Expertise",
      }),
    ).toHaveAttribute("href", "/profile");
    await userEvent.keyboard("{Escape}");
    expect(
      screen.getByRole("link", { name: "Meine Verträge" }),
    ).toHaveAttribute("href", "/contracts");
    const roles = await screen.findByRole("button", { name: "Meine Rollen" });
    await waitFor(() => expect(roles).toBeEnabled());
    await userEvent.click(roles);
    const dialog = within(screen.getByRole("dialog", { name: "Meine Rollen" }));
    expect(dialog.getAllByRole("checkbox")).toHaveLength(5);
    expect(
      dialog.getByRole("checkbox", { name: "Administration" }),
    ).toBeChecked();
    expect(
      dialog.queryByRole("checkbox", { name: "Senior-Dozent:in" }),
    ).not.toBeInTheDocument();
    for (const name of [
      "Plattformmanagement",
      "Dozent:in",
      "Kursteilnehmer:in",
      "Unternehmen",
    ])
      await userEvent.click(dialog.getByRole("checkbox", { name }));
    const save = dialog.getByRole("button", { name: "Rollen speichern" });
    expect(save).toBeDisabled();
    await userEvent.selectOptions(
      await dialog.findByLabelText("Zugeordnetes Unternehmen"),
      "company-a",
    );
    await userEvent.click(save);
    const confirm = within(
      await screen.findByRole("dialog", { name: "Rollen für Anna ändern?" }),
    );
    await userEvent.click(
      confirm.getByRole("button", { name: "Rollen speichern" }),
    );
    await waitFor(() =>
      expect(fake.rpc).toHaveBeenCalledWith(
        "set_account_roles_with_organisation",
        {
          p_user_id: "own-actor",
          p_roles: ["admin", "management", "lecturer", "participant", "client"],
          p_organisation_id: "company-a",
        },
      ),
    );
  });
  it("confirms relinquishing administration and surfaces the last-admin denial", async () => {
    fake.capabilities = ["users.manage", "users.roles.manage"];
    fake.adminCatalog = true;
    const previous = fake.invoke.getMockImplementation()!;
    fake.invoke.mockImplementation(async (path: string) => {
      const result = await previous(path);
      if (path.includes("/users?"))
        Object.assign(result.data.items[0], {
          id: "own-actor",
          roles: ["admin", "management"],
        });
      return result;
    });
    const priorRpc = fake.rpc.getMockImplementation()!;
    fake.rpc.mockImplementation((name: string, args: unknown) =>
      name === "set_account_roles"
        ? Promise.resolve({
            data: null,
            error: { message: "Last active administrator protected" },
          })
        : priorRpc(name, args),
    );
    page();
    const own = await screen.findByRole("button", { name: "Meine Rollen" });
    await waitFor(() => expect(own).toBeEnabled());
    await userEvent.click(own);
    const dialog = within(screen.getByRole("dialog", { name: "Meine Rollen" }));
    await userEvent.click(
      dialog.getByRole("checkbox", { name: "Administration" }),
    );
    await userEvent.click(
      dialog.getByRole("button", { name: "Rollen speichern" }),
    );
    const confirm = within(
      await screen.findByRole("dialog", { name: "Rollen für Anna ändern?" }),
    );
    expect(
      confirm.getByText(
        /Ein anderes Konto mit Administrationsrechten oder Plattformleitung/,
      ),
    ).toBeVisible();
    await userEvent.click(
      confirm.getByRole("button", { name: "Rollen speichern" }),
    );
    expect(await confirm.findByRole("alert")).toHaveTextContent(
      "Mindestens ein anderes aktives Konto mit Administrationsrechten oder Plattformleitung",
    );
    expect(fake.rpc).toHaveBeenCalledWith("set_account_roles", {
      p_user_id: "own-actor",
      p_roles: ["management"],
    });
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
