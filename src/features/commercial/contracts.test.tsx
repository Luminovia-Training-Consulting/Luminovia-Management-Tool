/** Exercise scoped registration and exact-version access using isolated SDK and file-gateway fixtures. */
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { PersonContractAction } from "../accounts/person-contract-action";
import { ContractsPage } from "./contracts";
import type { ContractRecord } from "./types";

const target = "d415d832-e22e-4e32-bacc-180811de988c";
const second = "8dfbba01-bc2e-406e-b5d5-86eccfee37c7";
const fake = vi.hoisted(() => ({
  rpc: vi.fn(),
  readVersion: vi.fn(),
  saveDownload: vi.fn(),
  uploadDocument: vi.fn(),
}));
vi.mock("../files/files", () => ({
  SubjectDocuments: ({ ownerId, kind }: { ownerId: string; kind: string }) => (
    <p>{`Fictional file listing for ${ownerId}: ${kind}`}</p>
  ),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: fake.rpc,
    from: (table: string) => ({
      select: (columns: string) => {
        const filters: Record<string, string> = {};
        const query = {
          eq: (key: string, value: string) => {
            filters[key] = value;
            return query;
          },
          abortSignal: () => query,
          maybeSingle: () => fake.readVersion(table, columns, filters),
        };
        return query;
      },
    }),
  }),
}));
vi.mock("../../lib/queries", () => ({
  profileQuery: (id: string) => ({
    queryKey: ["profile", id],
    queryFn: async () => ({ time_zone: "Europe/Berlin" }),
  }),
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
vi.mock("../files/api", () => ({
  saveDownload: fake.saveDownload,
  uploadDocument: fake.uploadDocument,
}));
let client: QueryClient;

afterEach(() => {
  cleanup();
  client.clear();
  vi.resetAllMocks();
});

/** Produce one exact registered version per record; the ID is unrelated to the current document version. */
function record(id: string, user: string, title: string): ContractRecord {
  return {
    id,
    user_id: user,
    user_name: user === target ? "Fictional lecturer" : "Another lecturer",
    title,
    kind: "master",
    parent_contract_id: null,
    status: "active",
    effective_from: "2026-04-01T00:00:00Z",
    expires_at: null,
    version: 1,
    document_version_id: `${id}-version`,
    document_id: `${id}-document`,
    sha256: `${id}-hash`,
    acknowledged_at: null,
    created_at: "2026-04-01T00:00:00Z",
  };
}

/** Mount either the legacy page or the same contextual action used on a selected person's profile. */
async function show(manager: boolean, contextual = false) {
  await i18n.changeLanguage("de");
  fake.rpc.mockImplementation(
    async (name: string, args?: { p_all?: boolean; p_user_id?: string }) => {
      let data: unknown = null;
      switch (name) {
        case "commercial_access":
          data = { can_manage_contracts: manager };
          break;
        case "commercial_people":
          data = [
            { id: target, display_name: "Fictional lecturer" },
            { id: second, display_name: "Another lecturer" },
          ];
          break;
        case "contract_records":
          data = args?.p_all
            ? [
                record("delegated", target, "Delegated contract"),
                record("private", target, "Lecturer's own upload"),
                record("other", second, "Other person's contract"),
              ]
            : [record("personal", "actor", "Personal contract")];
          break;
        case "contract_registration_candidates":
          data = [
            {
              version_id: `scan-${args?.p_user_id}`,
              file_name: "Scanned contract.pdf",
            },
          ];
          break;
        case "register_executed_contract":
          data = "new-contract";
      }
      return { data, error: null };
    },
  );
  fake.readVersion.mockImplementation(async (_table, _columns, filters) => ({
    data: filters.id === "delegated-version" ? { id: filters.id } : null,
    error: null,
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (id: string) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/contracts?user=${target}`]}>
        {contextual ? (
          <PersonContractAction
            actor="actor"
            id={id}
            name={id === target ? "Fictional lecturer" : "Another lecturer"}
          />
        ) : (
          <ContractsPage />
        )}
      </MemoryRouter>
    </QueryClientProvider>
  );
  const { rerender } = render(view(target));
  return { select: (id: string) => rerender(view(id)) };
}

it("preselects the lecturer and loads the scanned-file candidates in the registration dialog", async () => {
  await show(true);
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Ausgeführten Vertrag hinterlegen",
    }),
  );
  expect(await screen.findByLabelText("Dozent:in")).toHaveValue(target);
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith("contract_registration_candidates", {
      p_user_id: target,
    }),
  );
});

it("does not grant management authority to a contract link", async () => {
  await show(false);
  await screen.findByRole("heading", { name: "Personal contract" });
  expect(
    screen.queryByRole("button", { name: "Ausgeführten Vertrag hinterlegen" }),
  ).not.toBeInTheDocument();
  expect(fake.rpc).not.toHaveBeenCalledWith("contract_records", {
    p_all: true,
  });
});

it("files an own PDF without registering a contract or selecting the URL target as owner", async () => {
  await show(false);
  fake.uploadDocument.mockResolvedValue({
    original_name: "Own.pdf",
    current_version_id: "own-clean-version",
  });
  const pdf = new File(["%PDF"], "Own.pdf", { type: "application/pdf" });
  await userEvent.upload(
    await screen.findByLabelText("Ausgeführter Vertrag als PDF"),
    pdf,
  );
  await waitFor(() =>
    expect(fake.uploadDocument).toHaveBeenCalledWith(
      pdf,
      expect.objectContaining({
        kind: "contract",
        ownerId: "actor",
        scope: "personal",
      }),
      expect.any(Function),
    ),
  );
  expect(fake.rpc).not.toHaveBeenCalledWith(
    "register_executed_contract",
    expect.anything(),
  );
  await userEvent.click(screen.getByText("Meine Vertragsdateien"));
  expect(
    await screen.findByText("Fictional file listing for actor: contract"),
  ).toBeVisible();
});

async function openContext(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: /Verträge verwalten:/ }),
  );
  return within(
    await screen.findByRole("dialog", { name: "Verträge verwalten" }),
  );
}

async function openRegistration(
  user: ReturnType<typeof userEvent.setup>,
  context: ReturnType<typeof within>,
) {
  await user.click(
    await context.findByRole("button", {
      name: "Ausgeführten Vertrag hinterlegen",
    }),
  );
  return within(
    await screen.findByRole("dialog", {
      name: "Ausgeführten Vertrag hinterlegen",
    }),
  );
}

it("registers only the selected lecturer and offers only their parent contracts and scanned files", async () => {
  await show(true, true);
  const user = userEvent.setup();
  const context = await openContext(user);
  expect(
    await context.findByRole("heading", { name: "Delegated contract" }),
  ).toBeVisible();
  expect(context.queryByText("Other person's contract")).toBeNull();
  const registration = await openRegistration(user, context);
  expect(registration.queryByLabelText("Dozent:in")).toBeNull();
  await user.type(registration.getByLabelText("Titel"), "Fictional addendum");
  await user.selectOptions(registration.getByLabelText("Art"), "addendum");
  const parent = registration.getByLabelText("Zugehöriger Vertrag");
  expect(
    within(parent).queryByRole("option", { name: /Other person's contract/ }),
  ).toBeNull();
  await user.selectOptions(parent, "delegated");
  await registration.findByRole("option", { name: "Scanned contract.pdf" });
  expect(fake.rpc).toHaveBeenCalledWith("contract_registration_candidates", {
    p_user_id: target,
  });
  expect(fake.rpc).not.toHaveBeenCalledWith(
    "contract_registration_candidates",
    { p_user_id: second },
  );
  await user.selectOptions(
    registration.getByLabelText("Hochgeladene Vertragsdatei"),
    `scan-${target}`,
  );
  await user.click(
    registration.getByRole("button", { name: "Vertrag speichern" }),
  );
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith(
      "register_executed_contract",
      expect.objectContaining({
        p_user_id: target,
        p_parent_id: "delegated",
        p_document_version_id: `scan-${target}`,
      }),
    ),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", {
        name: "Ausgeführten Vertrag hinterlegen",
      }),
    ).toBeNull(),
  );
});

it("uses the scanner upload workflow with the lecturer as owner and registers the confirmed version", async () => {
  await show(true, true);
  fake.uploadDocument.mockResolvedValue({
    original_name: "Uploaded.pdf",
    current_version_id: "clean-upload-version",
  });
  const user = userEvent.setup();
  const registration = await openRegistration(user, await openContext(user));
  const save = registration.getByRole("button", { name: "Vertrag speichern" });
  expect(save).toBeDisabled();
  await user.type(
    registration.getByLabelText("Titel"),
    "Fictional uploaded contract",
  );
  const pdf = new File(["%PDF"], "Uploaded.pdf", { type: "application/pdf" });
  await user.upload(
    registration.getByLabelText("Ausgeführter Vertrag als PDF"),
    pdf,
  );
  expect(fake.uploadDocument).toHaveBeenCalledWith(
    pdf,
    expect.objectContaining({
      kind: "contract",
      ownerId: target,
      scope: "personal",
    }),
    expect.any(Function),
  );
  await waitFor(() => expect(save).toBeEnabled());
  await user.click(save);
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith(
      "register_executed_contract",
      expect.objectContaining({
        p_user_id: target,
        p_document_version_id: "clean-upload-version",
      }),
    ),
  );
});

it("downloads only the exact registered PDF that the file policy allows and does not acknowledge for the owner", async () => {
  await show(true, true);
  const user = userEvent.setup();
  const context = await openContext(user);
  const [allowed, denied] = await context.findAllByRole("button", {
    name: "Dokument herunterladen",
  });
  await waitFor(() => expect(allowed).toBeEnabled());
  expect(fake.readVersion).toHaveBeenCalledWith("document_versions", "id", {
    id: "delegated-version",
    document_id: "delegated-document",
    status: "clean",
    mime_type: "application/pdf",
  });
  expect(denied).toBeDisabled();
  await user.click(denied);
  expect(fake.saveDownload).not.toHaveBeenCalled();
  await user.click(allowed);
  expect(fake.saveDownload).toHaveBeenCalledWith(
    "delegated-document",
    "Delegated contract.pdf",
    "delegated-version",
  );
  expect(
    context.queryByRole("button", { name: "Empfang bestätigen" }),
  ).toBeNull();
});

it("discards the open registration draft when the selected person changes", async () => {
  const { select } = await show(true, true);
  const user = userEvent.setup();
  const firstRegistration = await openRegistration(
    user,
    await openContext(user),
  );
  await user.type(
    firstRegistration.getByLabelText("Titel"),
    "First lecturer's draft",
  );
  select(second);
  expect(screen.queryByRole("dialog")).toBeNull();
  const context = await openContext(user);
  expect(
    await context.findByRole("heading", { name: "Other person's contract" }),
  ).toBeVisible();
  expect(context.queryByText("Delegated contract")).toBeNull();
  const registration = await openRegistration(user, context);
  expect(registration.getByLabelText("Titel")).toHaveValue("");
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith("contract_registration_candidates", {
      p_user_id: second,
    }),
  );
});

it("retains the owner's download and version-specific receipt acknowledgement on the personal page", async () => {
  await show(false);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Dokument herunterladen" }),
  );
  expect(fake.saveDownload).toHaveBeenCalledWith(
    "personal-document",
    "Personal contract.pdf",
    "personal-version",
  );
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Empfang bestätigen" }));
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith(
      "acknowledge_contract",
      expect.objectContaining({
        p_contract_id: "personal",
        p_sha256: "personal-hash",
      }),
    ),
  );
});
