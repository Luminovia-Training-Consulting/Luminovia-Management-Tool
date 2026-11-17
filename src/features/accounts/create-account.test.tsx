/** New-account UI binds the selected role/company and clears transient passwords after confirmation. */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { CreateAccountForm } from "./create-account";
const fake = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./api", () => ({ accountRequest: fake.request }));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    from: () => ({
      select: () => ({
        is: () => ({
          order: async () => ({
            data: [{ id: "org-a", name: "Fictional company" }],
            error: null,
          }),
        }),
      }),
    }),
  }),
}));
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});
function mount() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CreateAccountForm
          actor="admin"
          canLinkOrganisations
          roles={[
            { role: "owner", assignable: false, permissions: [] },
            { role: "admin", assignable: true, permissions: [] },
            { role: "lecturer", assignable: true, permissions: [] },
            { role: "client", assignable: true, permissions: [] },
            { role: "guest", assignable: true, permissions: [] },
            { role: "participant", assignable: true, permissions: [] },
          ]}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it("creates a company with an explicit organisation and keeps passwords out of success state", async () => {
  await i18n.changeLanguage("de");
  fake.request.mockResolvedValue({ status: "created", user_id: "new-user" });
  mount();
  expect(
    screen.queryByRole("option", { name: "Kursteilnehmer:in" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Inhaberin / Plattformleitung" }),
  ).not.toBeInTheDocument();
  await userEvent.type(
    screen.getByLabelText("Anzeigename"),
    "Fictional account",
  );
  await userEvent.type(
    screen.getByLabelText("E-Mail"),
    "fictional@example.invalid",
  );
  await userEvent.selectOptions(screen.getByLabelText("Kontorolle"), "client");
  await screen.findByRole("option", { name: "Fictional company" });
  await userEvent.selectOptions(
    screen.getByLabelText("Auftraggeber-Organisation"),
    "org-a",
  );
  await userEvent.type(
    screen.getByLabelText("Startpasswort (mindestens 12 Zeichen)"),
    "Fictional!Password123",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Benutzerkonto erstellen" }),
  );
  await waitFor(() =>
    expect(fake.request).toHaveBeenCalledWith(
      "users",
      "POST",
      expect.objectContaining({
        role: "client",
        organisation_id: "org-a",
        email: "fictional@example.invalid",
        display_name: "Fictional account",
        idempotency_key: expect.any(String),
      }),
    ),
  );
  expect(
    await screen.findByRole("link", { name: "Benutzerkonto öffnen" }),
  ).toHaveAttribute("href", "/people/new-user");
  expect(
    screen.getByLabelText("Startpasswort (mindestens 12 Zeichen)"),
  ).toHaveValue("");
});
it("allows guest creation without a company but never displays success for rejected creation", async () => {
  await i18n.changeLanguage("en");
  fake.request.mockRejectedValue(new Error("creation_failed"));
  mount();
  await userEvent.type(
    screen.getByLabelText("Display name"),
    "Fictional guest",
  );
  await userEvent.type(screen.getByLabelText("Email"), "guest@example.invalid");
  await userEvent.selectOptions(screen.getByLabelText("Account role"), "guest");
  await userEvent.type(
    screen.getByLabelText("Initial password (at least 12 characters)"),
    "Fictional!Password123",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Create user account" }),
  );
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Open user account" }),
  ).not.toBeInTheDocument();
  expect(fake.request).toHaveBeenCalledWith(
    "users",
    "POST",
    expect.objectContaining({ role: "guest", organisation_id: null }),
  );
});
