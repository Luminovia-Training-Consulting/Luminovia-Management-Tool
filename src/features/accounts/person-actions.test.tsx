/** Person actions target the selected account and require explicit server-confirmed changes. */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { PersonManagementActions } from "./person-actions";

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
vi.mock("../../lib/queries", () => ({
  permissionsQuery: () => ({
    queryKey: ["permissions"],
    queryFn: async () => fake.permissions,
  }),
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

afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
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
  expect(fake.rpc).not.toHaveBeenCalled();
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
  expect(
    screen.queryByRole("button", { name: "Zugang sperren" }),
  ).not.toBeInTheDocument();
});
