import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WhiteLabelSetupPage } from "./white-label-setup";

const fake = vi.hoisted(() => ({
  actorRole: "admin",
  listCompanies: vi.fn(),
  listAccounts: vi.fn(),
  memberships: vi.fn(),
  saveBlob: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string) => key,
  }),
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "fictional-operator" } } }),
}));
vi.mock("../../lib/queries", () => ({
  userRolesQuery: () => ({
    queryKey: ["roles"],
    queryFn: async () => [fake.actorRole],
  }),
  profileQuery: () => ({
    queryKey: ["profile"],
    queryFn: async () => ({ active: true }),
  }),
}));
vi.mock("../../lib/online", () => ({
  requireOnline: () => undefined,
  useOnline: () => true,
}));
vi.mock("../../lib/blob-download", () => ({ saveBlob: fake.saveBlob }));
vi.mock("../accounts/api", () => ({
  accountOrganisationsQuery: () => ({
    queryKey: ["companies"],
    queryFn: fake.listCompanies,
  }),
  accountRequest: fake.listAccounts,
  accountMemberships: fake.memberships,
}));

const email = "coordinator@example.invalid";
const company = { id: "fictional-company", name: "Fictional Training Company" };
const account = {
  id: "coordinator-id",
  email,
  active: true,
  roles: ["client"],
};

let queryClient: QueryClient;
beforeEach(() => {
  fake.actorRole = "admin";
  fake.listCompanies.mockResolvedValue([company]);
  fake.listAccounts.mockResolvedValue({ items: [account], total: 1 });
  fake.memberships.mockResolvedValue([{ organisation_id: company.id }]);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.resetAllMocks();
});

function mount() {
  render(
    <QueryClientProvider client={queryClient}>
      <WhiteLabelSetupPage />
    </QueryClientProvider>,
  );
}

async function openDraft() {
  mount();
  const user = userEvent.setup();
  const toggle = await screen.findByRole("switch", {
    name: "Open White Label setup",
  });
  expect(toggle).not.toBeChecked();
  expect(fake.listCompanies).not.toHaveBeenCalled();
  await user.click(toggle);
  await user.selectOptions(await screen.findByLabelText("Company"), company.id);
  expect(screen.getByLabelText("Legal company name")).toHaveValue(company.name);
  for (const [label, value] of [
    ["Company account email", email],
    ["Academy username (optional)", "coordinator"],
    ["Academy name", "Fictional Academy"],
    ["Short name", "Academy"],
    ["Approved logo and icon reference", "FICTIONAL-ASSET-1"],
    ["Academy HTTPS address", "https://academy.fictional-training.example.edu"],
    ["Installation directory", "/opt/academies/fictional-training"],
    ["Host reference", "FICTIONAL-HOST"],
    ["Data region", "eu-central"],
    ["Agreement reference", "FICTIONAL-AGREEMENT"],
    ["Support email", "support@example.invalid"],
    ["Reviewed Git commit (SHA)", "1".repeat(40)],
    ["Account seats", "50"],
    ["Storage limit in bytes", "5000000000"],
    ["API requests per minute", "120"],
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  return {
    user,
    submit: screen.getByRole("button", { name: "Download private draft" }),
  };
}

it("blocks the setup route for management before reading companies", async () => {
  fake.actorRole = "management";
  mount();
  expect(
    await screen.findByText(/active administrators and owners only/),
  ).toBeVisible();
  expect(screen.queryByRole("switch")).toBeNull();
  expect(fake.listCompanies).not.toHaveBeenCalled();
});

it("exports licence and branding selections with a company member as installation administrator", async () => {
  const { user, submit } = await openDraft();
  await user.selectOptions(screen.getByLabelText("Default appearance"), "dark");
  await user.click(submit);
  expect(await screen.findByText(/Draft exported/)).toBeVisible();
  expect(fake.memberships).toHaveBeenCalledWith(account.id);
  const [blob, filename] = fake.saveBlob.mock.calls[0];
  expect(filename).toBe("academy-customer-draft.json");
  expect(blob.type).toBe("application/json");
  const json = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  });
  expect(JSON.parse(json)).toMatchObject({
    version: 1,
    purpose: "customer",
    legal_customer_name: company.name,
    branding: { name: "Fictional Academy", theme: "dark" },
    initial_administrator: { email, username: "coordinator" },
    target: {
      edition: "customer-self-hosted",
      domain_status: "temporary-pending",
    },
    licence: { limits: { seat_count: 50, storage_bytes: 5_000_000_000 } },
  });
});

it("rejects an inactive account and refuses an active account from another company", async () => {
  fake.listAccounts.mockResolvedValueOnce({
    items: [{ ...account, active: false }],
    total: 1,
  });
  fake.memberships.mockResolvedValue([{ organisation_id: "other-company" }]);
  const { user, submit } = await openDraft();
  await user.click(submit);
  const denied = /active company account at this company/;
  expect(await screen.findByText(denied)).toBeVisible();
  expect(fake.memberships).not.toHaveBeenCalled();
  await user.click(submit);
  expect(await screen.findByText(denied)).toBeVisible();
  expect(fake.memberships).toHaveBeenCalledWith(account.id);
  expect(fake.saveBlob).not.toHaveBeenCalled();
});

it("rejects a private or malformed portal domain before account lookup", async () => {
  const { user, submit } = await openDraft();
  const target = screen.getByLabelText("Academy HTTPS address");
  fireEvent.change(target, {
    target: { value: "https://academy.luminovia.org" },
  });
  await user.click(submit);
  expect(target).toHaveAttribute("aria-invalid", "true");
  expect(fake.listAccounts).not.toHaveBeenCalled();
  expect(fake.saveBlob).not.toHaveBeenCalled();
});
