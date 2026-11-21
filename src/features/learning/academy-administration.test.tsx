import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import type { AcademyAdministration } from "../accounts/academy-schema";
import { AcademyAdministrationPage } from "./academy-administration";

const { read, createAccount, createOrganisation } = vi.hoisted(() => ({
  read: vi.fn<() => Promise<AcademyAdministration | null>>(),
  createAccount: vi.fn(),
  createOrganisation: vi.fn(),
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "current-academy-actor" } } }),
}));
vi.mock("../../lib/online", () => ({ useOnline: () => true }));
vi.mock("../accounts/academy-api", () => ({
  academyAdministrationQuery: (actor: string) => ({
    queryKey: ["academy-administration", actor],
    queryFn: read,
  }),
  createAcademyAccount: createAccount,
  createAcademyOrganisation: createOrganisation,
}));

const org = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Fictional training team",
  time_zone: "Pacific/Auckland",
};
const member = {
  id: "22222222-2222-4222-8222-222222222222",
  display_name: "Fictional learner",
  role: "participant" as const,
  active: true,
  confirmed: false,
};

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("de");
});

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AcademyAdministrationPage />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

it("creates an organisation then invites the learner into that exact organisation", async () => {
  read.mockResolvedValue({ can_write: true, organisations: [], accounts: [] });
  createOrganisation.mockImplementation(async () => {
    read.mockResolvedValue({
      can_write: true,
      organisations: [org],
      accounts: [],
    });
    return org;
  });
  createAccount.mockImplementation(async () => {
    read.mockResolvedValue({
      can_write: true,
      organisations: [org],
      accounts: [member],
    });
    return { status: "created", user_id: member.id };
  });
  const user = setup();
  await user.type(await screen.findByLabelText("Organisation name"), org.name);
  await user.clear(screen.getByLabelText("Time zone"));
  await user.type(screen.getByLabelText("Time zone"), org.time_zone);
  await user.click(screen.getByRole("button", { name: "Save organisation" }));
  expect(await screen.findByText("Organisation created.")).toBeVisible();
  expect(createOrganisation).toHaveBeenCalledWith(
    expect.any(String),
    org.name,
    org.time_zone,
  );
  await user.selectOptions(screen.getByLabelText("Role"), "participant");
  await user.selectOptions(
    screen.getByLabelText("Learner organisation"),
    org.id,
  );
  await user.type(screen.getByLabelText("Display name"), member.display_name);
  await user.type(
    screen.getByLabelText("Email address"),
    "learner@example.invalid",
  );
  await user.click(screen.getByRole("button", { name: "Send invitation" }));
  expect(await screen.findByText("Invitation requested.")).toBeVisible();
  expect(createAccount).toHaveBeenCalledWith({
    idempotency_key: expect.any(String),
    display_name: member.display_name,
    email: "learner@example.invalid",
    role: "participant",
    organisation_id: org.id,
    mode: "invite",
  });
  await waitFor(() =>
    expect(
      screen.getByText(/Fictional learner.*Confirmation pending/),
    ).toBeVisible(),
  );
});

it("uses the live denied or read-only projection to withhold management forms", async () => {
  read.mockResolvedValue(null);
  setup();
  expect(
    await screen.findByText("Administration is unavailable to your account."),
  ).toBeVisible();
  expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument();
  cleanup();

  read.mockResolvedValue({
    can_write: false,
    organisations: [org],
    accounts: [member],
  });
  setup();
  expect(
    await screen.findByText(
      "Organisations and accounts are currently read-only.",
    ),
  ).toBeVisible();
  expect(screen.getByText(/Fictional learner/)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Send invitation" }),
  ).not.toBeInTheDocument();
});
