/** New-account UI binds the selected role/company and clears transient passwords after confirmation. */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { CreateAccountForm } from "./create-account";

const fake = vi.hoisted(() => ({ request: vi.fn() }));
const classes = {
  first: "11111111-1111-4111-8111-111111111111",
  second: "22222222-2222-4222-8222-222222222222",
  third: "33333333-3333-4333-8333-333333333333",
};
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  accountRequest: fake.request,
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    from: () => ({
      select: () => ({
        is: () => ({
          order: async () => ({
            data: [
              { id: "org-a", name: "Fictional company" },
              { id: "org-b", name: "Training campus" },
            ],
            error: null,
          }),
        }),
      }),
    }),
    rpc: (
      _operation: string,
      { p_organisation_id }: { p_organisation_id: string },
    ) => ({
      abortSignal: async () => ({
        data: {
          classes: (p_organisation_id === "org-a"
            ? [
                { id: classes.first, name: "Linux basics" },
                { id: classes.second, name: "Cloud practice" },
              ]
            : [{ id: classes.third, name: "Network practice" }]
          ).map((entry) => ({ ...entry, meeting_url: null })),
          contact_id: null,
          contacts: [],
        },
        error: null,
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

it("creates a company with an explicit organisation and accepts the eight-character floor", async () => {
  await i18n.changeLanguage("de");
  fake.request.mockResolvedValue({ status: "created", user_id: "new-user" });
  mount();
  expect(
    screen.getByRole("option", { name: "Kursteilnehmer:in" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Plattformleitung" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Kontorolle")).toHaveValue("");
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
    screen.getByLabelText("Zugeordnetes Unternehmen"),
    "org-a",
  );
  await userEvent.type(screen.getByLabelText(/Startpasswort/), "Aa1!aaaa");
  expect(screen.getByLabelText(/Startpasswort/)).toHaveAttribute(
    "minLength",
    "8",
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
  expect(screen.getByLabelText(/Startpasswort/)).toHaveValue("");
});
it("rejects a seven-character initial password before requesting account creation", async () => {
  await i18n.changeLanguage("de");
  mount();
  await userEvent.type(screen.getByLabelText("Anzeigename"), "Fictional user");
  await userEvent.type(
    screen.getByLabelText("E-Mail"),
    "short-password@example.invalid",
  );
  const password = screen.getByLabelText(/Startpasswort/);
  await userEvent.selectOptions(
    screen.getByLabelText("Kontorolle"),
    "lecturer",
  );
  expect(password).toHaveAttribute("minLength", "8");
  await userEvent.type(password, "Aa1!aaa");
  await userEvent.click(
    screen.getByRole("button", { name: "Benutzerkonto erstellen" }),
  );
  expect(fake.request).not.toHaveBeenCalled();
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
    screen.getByLabelText(/Initial password/),
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
it("keeps the same idempotency key visible and reusable while a prior request is still finalizing", async () => {
  await i18n.changeLanguage("en");
  fake.request
    .mockRejectedValueOnce(new Error("creation_in_progress"))
    .mockResolvedValueOnce({ status: "created", user_id: "new-user" });
  mount();
  await userEvent.type(screen.getByLabelText("Display name"), "Fictional user");
  await userEvent.type(screen.getByLabelText("Email"), "retry@example.invalid");
  await userEvent.selectOptions(
    screen.getByLabelText("Account role"),
    "lecturer",
  );
  await userEvent.type(screen.getByLabelText(/Initial password/), "Aa1!aaaa");
  const submit = () =>
    userEvent.click(
      screen.getByRole("button", { name: "Create user account" }),
    );
  await submit();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "still being finalized",
  );
  const firstRequest = fake.request.mock.calls[0][2];
  await submit();
  await screen.findByRole("link", { name: "Open user account" });
  expect(fake.request).toHaveBeenCalledTimes(2);
  expect(fake.request.mock.calls[1][2]).toMatchObject({
    idempotency_key: firstRequest.idempotency_key,
  });
});

it("explains rejected participant placement without claiming account success", async () => {
  await i18n.changeLanguage("en");
  fake.request.mockRejectedValue(new Error("permission_required"));
  mount();
  await userEvent.type(screen.getByLabelText("Display name"), "Fictional user");
  await userEvent.type(
    screen.getByLabelText("Email"),
    "placement@example.invalid",
  );
  await userEvent.selectOptions(
    screen.getByLabelText("Account role"),
    "participant",
  );
  await screen.findByRole("option", { name: "Fictional company" });
  await userEvent.selectOptions(
    screen.getByLabelText("Participant company"),
    "org-a",
  );
  await userEvent.type(screen.getByLabelText(/Initial password/), "Aa1!aaaa");
  await userEvent.click(
    screen.getByRole("button", { name: "Create user account" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "role or company placement",
  );
  expect(
    screen.queryByRole("link", { name: "Open user account" }),
  ).not.toBeInTheDocument();
});

it("searches participant companies and classes, clears the old class on company change and submits the new placement", async () => {
  await i18n.changeLanguage("de");
  fake.request.mockResolvedValue({ status: "created", user_id: "new-learner" });
  mount();
  await userEvent.type(
    screen.getByLabelText("Anzeigename"),
    "Fictional learner",
  );
  await userEvent.type(
    screen.getByLabelText("E-Mail"),
    "learner@example.invalid",
  );
  await userEvent.type(screen.getByLabelText(/Startpasswort/), "Aa1!aaaa");
  await userEvent.selectOptions(
    screen.getByLabelText("Kontorolle"),
    "participant",
  );

  await screen.findByRole("option", { name: "Fictional company" });
  const companySearch = screen.getByRole("searchbox", {
    name: "Unternehmen suchen",
  });
  await userEvent.type(companySearch, "fictional");
  expect(
    screen.queryByRole("option", { name: "Training campus" }),
  ).not.toBeInTheDocument();
  const company = screen.getByLabelText("Unternehmen für die Teilnahme");
  await userEvent.selectOptions(company, "org-a");

  await screen.findByRole("option", { name: "Linux basics" });
  await userEvent.type(
    screen.getByRole("searchbox", { name: "Klassen suchen" }),
    "cloud",
  );
  expect(
    screen.queryByRole("option", { name: "Linux basics" }),
  ).not.toBeInTheDocument();
  await userEvent.selectOptions(
    screen.getByLabelText("Klasse"),
    classes.second,
  );
  await userEvent.clear(companySearch);
  await userEvent.selectOptions(company, "org-b");
  await screen.findByRole("option", { name: "Network practice" });
  expect(screen.getByLabelText("Klasse")).toHaveValue("");
  expect(
    screen.queryByRole("option", { name: "Cloud practice" }),
  ).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Klasse"), classes.third);
  await userEvent.click(
    screen.getByRole("button", { name: "Benutzerkonto erstellen" }),
  );
  await waitFor(() =>
    expect(fake.request).toHaveBeenCalledWith(
      "users",
      "POST",
      expect.objectContaining({
        role: "participant",
        organisation_id: "org-b",
        class_id: classes.third,
      }),
    ),
  );
});
