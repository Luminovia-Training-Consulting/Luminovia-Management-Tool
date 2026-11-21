import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import type { AcademyAdministration } from "../accounts/academy-schema";
import { AcademyAdministrationPage } from "./academy-administration";

const { read, createAccount, createOrganisation, setActive, setManagement } =
  vi.hoisted(() => ({
    read: vi.fn<() => Promise<AcademyAdministration | null>>(),
    createAccount: vi.fn(),
    createOrganisation: vi.fn(),
    setActive: vi.fn(),
    setManagement: vi.fn(),
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
  setAcademyMemberActive: setActive,
  setAcademyManagement: setManagement,
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
  management_delegated: false,
  management_version: 0,
  can_set_active: true,
  can_set_management: false,
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
  read.mockResolvedValue({
    can_write: true,
    can_create_management: false,
    organisations: [],
    accounts: [],
  });
  createOrganisation.mockImplementation(async () => {
    read.mockResolvedValue({
      can_write: true,
      can_create_management: false,
      organisations: [org],
      accounts: [],
    });
    return org;
  });
  createAccount.mockImplementation(async () => {
    read.mockResolvedValue({
      can_write: true,
      can_create_management: false,
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
    can_create_management: false,
    organisations: [org],
    accounts: [{ ...member, can_set_active: false }],
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
  expect(
    screen.queryByRole("button", { name: /Suspend account/ }),
  ).not.toBeInTheDocument();
});

it("lets an admin delegate to a current instructor and suspend the same retained account", async () => {
  const teacher = {
    ...member,
    display_name: "Fictional instructor",
    role: "lecturer" as const,
    confirmed: true,
    can_set_management: true,
  };
  const manager = {
    ...teacher,
    role: "management" as const,
    management_delegated: true,
    management_version: 1,
  };
  const projection = {
    can_write: true,
    can_create_management: true,
    organisations: [org],
  };
  read.mockResolvedValue({ ...projection, accounts: [teacher] });
  setManagement.mockImplementation(async () => {
    read.mockResolvedValue({ ...projection, accounts: [manager] });
    return manager;
  });
  setActive.mockImplementation(async () => {
    const inactive = { ...manager, active: false };
    read.mockResolvedValue({ ...projection, accounts: [inactive] });
    return inactive;
  });
  const user = setup();
  expect(
    await screen.findByRole("option", { name: "Course manager" }),
  ).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: /Grant management rights/ }),
  );
  expect(setManagement).toHaveBeenCalledWith(teacher, true);
  expect(
    await screen.findByRole("button", { name: /Withdraw management rights/ }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: /Suspend account/ }));
  expect(setActive).toHaveBeenCalledWith(manager, false);
  expect(
    await screen.findByRole("button", { name: /Reactivate account/ }),
  ).toBeVisible();
  expect(
    screen.getByText(/Fictional instructor.*Course manager.*Inactive/),
  ).toBeVisible();
});

it("reports seat exhaustion for account creation and server-confirmed reactivation", async () => {
  const inactive = { ...member, active: false };
  read.mockResolvedValue({
    can_write: true,
    can_create_management: false,
    organisations: [org],
    accounts: [inactive],
  });
  createAccount.mockRejectedValue(new Error("academy_seat_limit"));
  setActive.mockRejectedValue({
    code: "PT409",
    details: "academy_seat_limit",
  });
  const user = setup();
  await user.type(await screen.findByLabelText("Display name"), "Instructor");
  await user.type(
    screen.getByLabelText("Email address"),
    "teacher@example.invalid",
  );
  await user.click(screen.getByRole("button", { name: "Send invitation" }));
  expect(
    await screen.findByText("All licensed account seats are in use."),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: /Reactivate account/ }));
  await waitFor(() => {
    expect(
      screen.getAllByText("All licensed account seats are in use."),
    ).toHaveLength(2);
  });
  expect(setActive).toHaveBeenCalledWith(inactive, true);
  expect(screen.getByText(/Fictional learner.*Inactive/)).toBeVisible();
});
