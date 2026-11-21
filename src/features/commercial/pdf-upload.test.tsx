/**
 * Regressions for scan completion, exact PDF versions and retained upload retry identity.
 * Controlled transport does not replace real scanning/Storage checks.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommercialPdfUpload } from "./pdf-upload";
import type { PortalDocument } from "../files/api";

const { uploadDocument } = vi.hoisted(() => ({ uploadDocument: vi.fn() }));
vi.mock("../files/api", () => ({ uploadDocument }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Render the subject with local provider/router fixtures and an isolated QueryClient. */
function setup(done: (document: PortalDocument | null) => void) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <CommercialPdfUpload
        kind="contract"
        ownerId="lecturer"
        label="Ausgeführter Vertrag als PDF"
        onDocument={done}
      />
    </QueryClientProvider>,
  );
}

it("clears a previous PDF while scanning and exposes only the confirmed immutable version", async () => {
  const user = userEvent.setup();
  const done = vi.fn();
  let confirm: (value: PortalDocument) => void = () => undefined;
  uploadDocument.mockImplementation(
    () =>
      new Promise((resolve) => {
        confirm = resolve;
      }),
  );
  setup(done);
  await user.upload(
    screen.getByLabelText("Ausgeführter Vertrag als PDF"),
    new File(["%PDF-1.7"], "contract.pdf", { type: "application/pdf" }),
  );
  expect(done).toHaveBeenCalledWith(null);
  expect(done).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/PDF wird hochgeladen und geprüft/)).toBeVisible();
  const document = {
    id: "doc",
    current_version_id: "immutable-v1",
    owner_id: "lecturer",
    original_name: "contract.pdf",
    status: "clean",
  } as PortalDocument;
  confirm(document);
  await screen.findByText(/contract.pdf/);
  expect(done).toHaveBeenLastCalledWith(document);
});
it("retains one retry key for an uncertain failed upload and never marks it clean", async () => {
  const user = userEvent.setup();
  const done = vi.fn();
  uploadDocument.mockRejectedValue(new Error("scanner_unavailable"));
  setup(done);
  const file = new File(["%PDF-1.7"], "contract.pdf", {
    type: "application/pdf",
    lastModified: 10,
  });
  const input = screen.getByLabelText("Ausgeführter Vertrag als PDF");
  await user.upload(input, file);
  await screen.findByRole("alert");
  await user.upload(input, file);
  await screen.findByRole("alert");
  expect(uploadDocument.mock.calls[0][1].clientId).toBe(
    uploadDocument.mock.calls[1][1].clientId,
  );
  expect(done.mock.calls.every((call) => call[0] === null)).toBe(true);
  expect(screen.queryByText(/PDF geprüft und bereit/)).not.toBeInTheDocument();
});
it("routes a dropped executed PDF through the same owner-scoped scan and version callback", async () => {
  const done = vi.fn();
  const uploaded = {
    id: "staff-uploaded-contract",
    current_version_id: "clean-contract-version",
    owner_id: "lecturer",
    original_name: "executed-contract.pdf",
    status: "clean",
  } as PortalDocument;
  uploadDocument.mockResolvedValue(uploaded);
  const { container } = render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <CommercialPdfUpload
        kind="contract"
        ownerId="lecturer"
        label="Executed agreement PDF"
        onDocument={done}
      />
    </QueryClientProvider>,
  );
  const dropTarget = container.querySelector(".commercial-upload");
  const file = new File(["%PDF-1.7"], "executed-contract.pdf", {
    type: "application/pdf",
  });
  fireEvent.dragOver(dropTarget!, {
    dataTransfer: { types: ["Files"], files: [file] },
  });
  expect(dropTarget).toHaveClass("is-dragging");
  fireEvent.drop(dropTarget!, {
    dataTransfer: { types: ["Files"], files: [file] },
  });

  await screen.findByText(/executed-contract\.pdf/);
  expect(uploadDocument).toHaveBeenCalledWith(
    file,
    expect.objectContaining({
      scope: "personal",
      kind: "contract",
      ownerId: "lecturer",
    }),
    expect.any(Function),
  );
  expect(done).toHaveBeenLastCalledWith(uploaded);
  expect(dropTarget).not.toHaveClass("is-dragging");
});
