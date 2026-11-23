import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { ContractsPage } from "./contracts";

const target = "d415d832-e22e-4e32-bacc-180811de988c";
const fake = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
vi.mock("../../lib/queries", () => ({
  profileQuery: (id: string) => ({
    queryKey: ["profile", id],
    queryFn: async () => ({ time_zone: "Europe/Berlin" }),
  }),
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
vi.mock("./pdf-upload", () => ({
  CommercialPdfUpload: ({ ownerId }: { ownerId: string }) => <p>{ownerId}</p>,
}));
let client: QueryClient;

afterEach(() => {
  cleanup();
  client.clear();
  fake.rpc.mockReset();
});

async function show(manager: boolean) {
  await i18n.changeLanguage("de");
  fake.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "commercial_access"
        ? { can_manage_contracts: manager }
        : name === "commercial_people"
          ? [{ id: target, display_name: "Fictional lecturer" }]
          : [],
    error: null,
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/contracts?user=${target}`]}>
        <ContractsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("preselects the lecturer and loads the scanned-file candidates in the registration dialog", async () => {
  await show(true);
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Ausgeführten Vertrag hinterlegen",
    }),
  );
  expect(await screen.findByLabelText("Dozent:in")).toHaveValue(target);
  expect(fake.rpc).toHaveBeenCalledWith("contract_registration_candidates", {
    p_user_id: target,
  });
});

it("does not grant management authority to a contract link", async () => {
  await show(false);
  await screen.findByText("actor");
  expect(
    screen.queryByRole("button", { name: "Ausgeführten Vertrag hinterlegen" }),
  ).not.toBeInTheDocument();
  expect(fake.rpc).not.toHaveBeenCalledWith("contract_records", {
    p_all: true,
  });
});
