import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WhiteLabelSetupPage } from "./white-label-setup";

const fake = vi.hoisted(() => ({
  actorRole: "admin",
  listCompanies: vi.fn(),
  rpc: vi.fn(),
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
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
vi.mock("../../lib/blob-download", () => ({ saveBlob: fake.saveBlob }));
vi.mock("../accounts/api", () => ({
  accountOrganisationsQuery: () => ({
    queryKey: ["companies"],
    queryFn: fake.listCompanies,
  }),
}));

const email = "coordinator@example.invalid";
const company = { id: "fictional-company", name: "Fictional Training Company" };
let queryClient: QueryClient;
beforeEach(() => {
  fake.actorRole = "admin";
  fake.listCompanies.mockResolvedValue([company]);
  let saved = { revision: 0, settings: null };
  fake.rpc.mockImplementation(async (_, args) => {
    if (args.p_settings)
      saved = { revision: saved.revision + 1, settings: args.p_settings };
    return { data: saved, error: null };
  });
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
  expect(await screen.findByLabelText("Legal company name")).toHaveValue(
    company.name,
  );
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
    submit: screen.getByRole("button", { name: "Save settings" }),
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

it("saves company settings and restores them after reopening without a download", async () => {
  const { user, submit } = await openDraft();
  await user.selectOptions(screen.getByLabelText("Default appearance"), "dark");
  await user.click(submit);
  expect(await screen.findByText("Settings saved.")).toBeVisible();
  expect(fake.rpc).toHaveBeenCalledWith("academy_customer_setup", {
    p_organisation_id: company.id,
    p_expected_revision: 0,
    p_settings: expect.objectContaining({
      legal_customer_name: company.name,
      branding: expect.objectContaining({
        name: "Fictional Academy",
        theme: "dark",
      }),
      initial_administrator: { email, username: "coordinator" },
      licence: expect.objectContaining({
        limits: expect.objectContaining({ seat_count: 50 }),
      }),
    }),
  });
  const toggle = screen.getByRole("switch");
  await user.click(toggle);
  await user.click(toggle);
  expect(await screen.findByLabelText("Academy name")).toHaveValue(
    "Fictional Academy",
  );
  expect(screen.getByLabelText("Data region")).toHaveValue("eu-central");
  expect(screen.getByLabelText("Default appearance")).toHaveValue("dark");
  expect(fake.saveBlob).not.toHaveBeenCalled();
});

it("shows server membership and version errors without claiming to save", async () => {
  const { user, submit } = await openDraft();
  fake.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "company_administrator" },
  });
  await user.click(submit);
  expect(
    await screen.findByText(/active company account at this company/),
  ).toBeVisible();
  fake.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "white_label_revision_changed" },
  });
  await user.click(submit);
  expect(
    await screen.findByRole("button", { name: "Load current settings" }),
  ).toBeVisible();
  expect(screen.queryByText("Settings saved.")).toBeNull();
});

it("rejects a private or malformed portal domain before saving", async () => {
  const { user, submit } = await openDraft();
  const target = screen.getByLabelText("Academy HTTPS address");
  fireEvent.change(target, {
    target: { value: "https://academy.luminovia.org" },
  });
  await user.click(submit);
  expect(target).toHaveAttribute("aria-invalid", "true");
  expect(fake.rpc).toHaveBeenCalledTimes(1);
  expect(fake.saveBlob).not.toHaveBeenCalled();
});
