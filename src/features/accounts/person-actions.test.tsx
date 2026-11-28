/** Person actions target the selected account and require explicit server-confirmed changes. */
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { PersonManagementActions } from "./person-actions";

const lecturer = "d415d832-e22e-4e32-bacc-180811de988c";
const fake = vi.hoisted(() => ({
  rpc: vi.fn(),
  active: true,
  permissions: ["users.manage"] as string[],
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
vi.mock("../deletions/deletions", () => ({
  PermanentDeleteAction: () => null,
}));
vi.mock("../admin/people", () => ({
  ManagedExpertise: ({ accountId }: { accountId: string }) => (
    <div>Managed evidence for {accountId}</div>
  ),
}));
vi.mock("../../lib/queries", () => ({
  permissionsQuery: () => ({
    queryKey: ["permissions"],
    queryFn: async () => fake.permissions,
  }),
  profileQuery: (id: string) => ({
    queryKey: ["profile", id],
    queryFn: async () => ({ time_zone: "Europe/Berlin" }),
  }),
}));
vi.mock("../commercial/pdf-upload", () => ({
  CommercialPdfUpload: () => null,
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: fake.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { active: fake.active }, error: null }),
        }),
      }),
    }),
  }),
}));
let client: QueryClient;

function mount(id = "target") {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PersonManagementActions id={id} name="Fictional person" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(async () => {
  cleanup();
  await client.cancelQueries();
  client.clear();
  await act(async () => {
    await new Promise<void>((resolve) => notifyManager.schedule(resolve));
  });
  vi.clearAllMocks();
  fake.rpc.mockReset();
  fake.permissions = ["users.manage"];
  fake.active = true;
});
it("opens scoped management and confirms blocking without optimistic success", async () => {
  await i18n.changeLanguage("de");
  fake.rpc.mockResolvedValue({ error: new Error("denied") });
  mount();
  const block = await screen.findByRole("button", { name: "Zugang sperren" });
  expect(
    screen.getByRole("link", { name: "Rollen und Zugriffe bearbeiten" }),
  ).toHaveAttribute("href", "/admin/accounts?q=Fictional%20person&user=target");
  await userEvent.click(block);
  expect(fake.rpc).not.toHaveBeenCalledWith(
    "set_user_active",
    expect.anything(),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Kontostatus bestätigen" }),
  );
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith("set_user_active", {
      p_user_id: "target",
      p_active: false,
    }),
  );
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
it("keeps self blocking unavailable", async () => {
  await i18n.changeLanguage("de");
  mount("actor");
  expect(
    screen.getByRole("link", { name: "Profil bearbeiten" }),
  ).toHaveAttribute("href", "/profile");
  await waitFor(() =>
    expect(client.getQueryData(["permissions"])).toEqual(["users.manage"]),
  );
  expect(
    screen.queryByRole("button", { name: "Zugang sperren" }),
  ).not.toBeInTheDocument();
});
it("offers delegated evidence and expertise management from the selected person's actions", async () => {
  await i18n.changeLanguage("de");
  fake.permissions = ["users.manage", "qualifications.verify"];
  mount();
  expect(
    await screen.findByRole("button", {
      name: "Qualifikationen und Nachweise",
    }),
  ).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Qualifikationen und Nachweise" }),
  );
  expect(await screen.findByText("Managed evidence for target")).toBeVisible();
});

/** Simulate the projected PostgREST RPC and assert the exact target sent to the server. */
function commercialEligibility(id: string | null) {
  const response = {
    select: vi.fn(() => response),
    eq: vi.fn(() => response),
    abortSignal: vi.fn(() => response),
    maybeSingle: async () => ({ data: id ? { id } : null, error: null }),
  };
  return response;
}

it("opens lecturer contracts by keyboard and restores focus to the selected person's action", async () => {
  await i18n.changeLanguage("de");
  const filter = vi.fn(() => ({
    abortSignal: async () => ({ data: [], error: null }),
  }));
  const eligibility = commercialEligibility(lecturer);
  fake.rpc.mockImplementation((name: string) => {
    if (name === "contract_records") return { eq: filter };
    if (name === "commercial_people") return eligibility;
    return { data: { can_manage_contracts: true }, error: null };
  });
  mount(lecturer);
  const user = userEvent.setup();
  const action = await screen.findByRole("button", {
    name: /Verträge verwalten/,
  });
  expect(fake.rpc).not.toHaveBeenCalledWith(
    "contract_records",
    expect.anything(),
  );
  action.focus();
  await user.keyboard("{Enter}");
  const dialog = await screen.findByRole("dialog", {
    name: "Verträge verwalten",
  });
  expect(dialog).toHaveAccessibleDescription("Fictional person");
  expect(
    await within(dialog).findByRole("button", {
      name: "Ausgeführten Vertrag hinterlegen",
    }),
  ).toBeVisible();
  expect(filter).toHaveBeenCalledWith("user_id", lecturer);
  expect(eligibility.select).toHaveBeenCalledWith("id");
  expect(eligibility.eq).toHaveBeenCalledWith("id", lecturer);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(action).toHaveFocus());
});

it("does not offer lecturer contracts or read their records with only account management permission", async () => {
  await i18n.changeLanguage("de");
  fake.rpc.mockResolvedValue({
    data: { can_manage_contracts: false },
    error: null,
  });
  mount(lecturer);
  await waitFor(() =>
    expect(client.getQueryData(["commercial-access", "actor"])).toEqual({
      can_manage_contracts: false,
    }),
  );
  expect(
    screen.queryByRole("button", { name: /Verträge verwalten/ }),
  ).toBeNull();
  expect(fake.rpc).not.toHaveBeenCalledWith("commercial_people");
  expect(fake.rpc).not.toHaveBeenCalledWith(
    "contract_records",
    expect.anything(),
  );
});

it("does not offer the action for a target outside the permitted lecturer list", async () => {
  await i18n.changeLanguage("de");
  fake.rpc.mockImplementation((name: string) =>
    name === "commercial_people"
      ? commercialEligibility(null)
      : { data: { can_manage_contracts: true }, error: null },
  );
  mount(lecturer);
  await waitFor(() =>
    expect(client.getQueryData(["commercial-people", "actor", lecturer])).toBe(
      false,
    ),
  );
  expect(
    screen.queryByRole("button", { name: /Verträge verwalten/ }),
  ).toBeNull();
  expect(fake.rpc).not.toHaveBeenCalledWith(
    "contract_records",
    expect.anything(),
  );
});
