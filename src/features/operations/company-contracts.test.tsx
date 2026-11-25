import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CompanyContracts } from "./company-contract-trigger";

const { rpc, upload, save } = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  save: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../files/api", () => ({
  uploadOrganisationContract: upload,
  saveOrganisationContract: save,
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const companyId = "9fc0be73-43d7-427d-8bc7-6426be1678d4";
const documentId = "1475b60f-833c-4cf3-a266-63abdba8aed9";
const entry = {
  id: documentId,
  file_name: "Agreement.pdf",
  created_at: "2026-10-25T12:00:00Z",
};

function list(items = [entry], hasMore = false) {
  return {
    abortSignal: vi.fn().mockResolvedValue({
      data: { items, has_more: hasMore },
      error: null,
    }),
  };
}

function renderDossier(archived = false) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CompanyContracts
        actor="manager"
        organisationId={companyId}
        organisationName="Fictional company"
        archived={archived}
      />
    </QueryClientProvider>,
  );
}

it("loads and paginates only the opened company's PDFs, allowing downloads after archive", async () => {
  const first = list([entry], true);
  rpc.mockReturnValueOnce(first).mockReturnValueOnce(list([]));
  const user = userEvent.setup();
  renderDossier(true);
  expect(rpc).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Unternehmensverträge" }),
  );
  expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
    "Fictional company",
  );
  expect(
    screen.queryByLabelText("Vertrag als PDF auswählen"),
  ).not.toBeInTheDocument();
  const file = await screen.findByRole("button", {
    name: "PDF herunterladen: Agreement.pdf",
  });
  expect(rpc).toHaveBeenNthCalledWith(1, "organisation_contracts", {
    p_organisation_id: companyId,
  });
  expect(first.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  await user.click(file);
  expect(save).toHaveBeenCalledWith(companyId, documentId, "Agreement.pdf");
  await user.click(
    screen.getByRole("button", { name: "Weitere Verträge laden" }),
  );
  expect(rpc).toHaveBeenNthCalledWith(2, "organisation_contracts", {
    p_organisation_id: companyId,
    p_before_at: entry.created_at,
    p_before_id: documentId,
  });
});

it("retries the selected PDF with the same request ID and shows it only after a confirmed upload", async () => {
  rpc.mockReturnValueOnce(list([])).mockReturnValue(list());
  upload
    .mockRejectedValueOnce(new Error("unavailable"))
    .mockResolvedValueOnce({ status: "clean" });
  const user = userEvent.setup();
  renderDossier();
  await user.click(
    screen.getByRole("button", { name: "Unternehmensverträge" }),
  );
  await screen.findByText(
    "Noch keine Verträge für dieses Unternehmen hinterlegt.",
  );
  const button = screen.getByRole("button", { name: "PDF hochladen" });
  expect(button).toBeDisabled();
  const pdf = new File(["test PDF"], "Agreement.pdf", {
    type: "application/pdf",
  });
  await user.upload(screen.getByLabelText("Vertrag als PDF auswählen"), pdf);
  await user.click(button);
  await screen.findByText("Das PDF konnte nicht hinterlegt werden.");
  expect(screen.queryByText("Vertrag hinterlegt.")).not.toBeInTheDocument();
  expect(rpc).toHaveBeenCalledOnce();
  await user.click(button);
  await screen.findByText("Vertrag hinterlegt.");
  expect(upload).toHaveBeenCalledTimes(2);
  expect(upload.mock.calls[0]).toEqual([pdf, companyId, expect.any(String)]);
  expect(upload.mock.calls[1]).toEqual(upload.mock.calls[0]);
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
  expect(
    await screen.findByRole("button", {
      name: "PDF herunterladen: Agreement.pdf",
    }),
  ).toBeVisible();
});
