import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ProfileCompanyContracts } from "./company-contracts";

const { from, rpc, upload } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ from, rpc }) }));
vi.mock("../files/api", () => ({
  uploadOrganisationContract: upload,
  saveOrganisationContract: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const ownCompany = "9fc0be73-43d7-427d-8bc7-6426be1678d4";
const otherCompany = "1475b60f-833c-4cf3-a266-63abdba8aed9";

function showProfileContracts(memberships: string[]) {
  const activeOnly = vi.fn().mockResolvedValue({
    data: memberships.map((organisation_id) => ({ organisation_id })),
    error: null,
  });
  const actorOnly = vi.fn().mockReturnValue({ is: activeOnly });
  from.mockReturnValue({ select: () => ({ eq: actorOnly }) });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ProfileCompanyContracts actor="own-actor" />
    </QueryClientProvider>,
  );
  expect(from).toHaveBeenCalledWith("client_organisation_memberships");
  expect(actorOnly).toHaveBeenCalledWith("user_id", "own-actor");
  expect(activeOnly).toHaveBeenCalledWith("removed_at", null);
}

it("opens and saves PDFs through the own company dossier even when the directory also returns another company", async () => {
  rpc.mockImplementation((name) =>
    name === "client_organisations"
      ? Promise.resolve({
          error: null,
          data: [
            { id: ownCompany, name: "Fictional own company" },
            { id: otherCompany, name: "Different company" },
          ],
        })
      : {
          abortSignal: async () => ({
            data: { items: [], has_more: false },
            error: null,
          }),
        },
  );
  upload.mockResolvedValue(undefined);
  showProfileContracts([ownCompany]);
  const region = await screen.findByRole("region", {
    name: "Unternehmensverträge",
  });
  expect(within(region).getAllByRole("button")).toHaveLength(1);
  expect(
    within(region).queryByText("Different company"),
  ).not.toBeInTheDocument();
  expect(rpc).not.toHaveBeenCalledWith(
    "organisation_contracts",
    expect.anything(),
  );
  const user = userEvent.setup();
  await user.click(
    within(region).getByRole("button", { name: /Fictional own company/ }),
  );
  const dialog = screen.getByRole("dialog", { name: "Unternehmensverträge" });
  expect(dialog).toHaveAccessibleDescription("Fictional own company");
  const pdf = new File(["synthetic"], "Company agreement.pdf", {
    type: "application/pdf",
  });
  await user.upload(
    await within(dialog).findByLabelText("Vertrag als PDF auswählen"),
    pdf,
  );
  await user.click(
    within(dialog).getByRole("button", { name: "PDF hochladen" }),
  );
  expect(await within(dialog).findByText("Vertrag hinterlegt.")).toBeVisible();
  expect(upload).toHaveBeenCalledExactlyOnceWith(
    pdf,
    ownCompany,
    expect.any(String),
  );
  expect(rpc).toHaveBeenCalledWith("organisation_contracts", {
    p_organisation_id: ownCompany,
  });
  expect(rpc).not.toHaveBeenCalledWith("organisation_contracts", {
    p_organisation_id: otherCompany,
  });
});

it("does not load the company directory or offer an upload without an active membership", async () => {
  showProfileContracts([]);
  await waitFor(() =>
    expect(screen.queryByRole("status")).not.toBeInTheDocument(),
  );
  expect(rpc).not.toHaveBeenCalled();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
