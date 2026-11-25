/**
 * Regressions for version-bound metadata/bytes and disposal of late preview Blob URLs.
 * Controlled UI transport does not establish server file authorization.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { FileUpload, SubjectDocuments } from "./files";
import type { PortalDocument } from "./api";

const state = vi.hoisted(() => ({
  uploadDocument: vi.fn(),
  downloadDocument: vi.fn(),
  saveDownload: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  uploadDocument: state.uploadDocument,
  downloadDocument: state.downloadDocument,
  saveDownload: state.saveDownload,
}));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
const file: PortalDocument = {
  id: "file",
  owner_id: "actor",
  uploaded_by: "actor",
  scope: "personal",
  kind: "material",
  room_id: null,
  job_id: null,
  original_name: "Fictional image.png",
  mime_type: "image/png",
  size_bytes: 120,
  status: "clean",
  current_version_id: "reviewed-version",
  created_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
};

/** Render the subject with local provider/router fixtures and an isolated QueryClient. */
function setup(child: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  client.setQueryData(["documents", "actor", "actor", "", ""], [file]);
  render(<QueryClientProvider client={client}>{child}</QueryClientProvider>);
  return client;
}

it("invalidates existing version history after a confirmed replacement instead of reopening stale rows", async () => {
  const user = userEvent.setup();
  state.uploadDocument.mockResolvedValue({
    ...file,
    current_version_id: "new-version",
  });
  const client = setup(
    <FileUpload context={{ scope: "personal", replaceId: "file" }} />,
  );
  client.setQueryData(
    ["document-versions", "file"],
    [{ id: "reviewed-version", version: 1 }],
  );
  await user.upload(
    screen.getByLabelText("Datei auswählen"),
    new File(["fictional"], "new.png", { type: "image/png" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Neue Version hochladen" }),
  );
  await screen.findByText("Datei gespeichert und geprüft.");
  expect(
    client.getQueryState(["document-versions", "file"])?.isInvalidated,
  ).toBe(true);
});
it("clears the previous selection when a newly selected file is rejected", async () => {
  const user = userEvent.setup();
  setup(<FileUpload context={{ scope: "personal" }} />);
  const input = screen.getByLabelText("Datei auswählen");
  const upload = screen.getByRole("button", { name: "Datei hochladen" });

  await user.upload(input, new File(["x"], "valid.png", { type: "image/png" }));
  expect(upload).toBeEnabled();

  await user.upload(input, new File([], "empty.png", { type: "image/png" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByText(/valid\.png/)).not.toBeInTheDocument();
  expect(upload).toBeDisabled();
  await user.click(upload);
  expect(state.uploadDocument).not.toHaveBeenCalled();
});
it("refreshes a file list whose first read predates a confirmed upload", async () => {
  const user = userEvent.setup();
  let release!: (files: PortalDocument[]) => void;
  const stale = new Promise<PortalDocument[]>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  let initialSignal: AbortSignal | undefined;
  const queryFn = ({ signal }: { signal: AbortSignal }) => {
    calls += 1;
    if (calls === 1) {
      initialSignal = signal;
      return stale;
    }
    return Promise.resolve([file]);
  };
  state.uploadDocument.mockResolvedValue(file);

  function List() {
    const query = useQuery({
      queryKey: ["documents", "actor", "discovery"],
      queryFn,
    });
    return (
      <div>
        {query.data?.map((item) => (
          <span key={item.id}>{item.original_name}</span>
        ))}
      </div>
    );
  }

  setup(
    <>
      <List />
      <FileUpload context={{ scope: "personal" }} />
    </>,
  );
  await waitFor(() => expect(calls).toBe(1));
  await user.upload(
    screen.getByLabelText("Datei auswählen"),
    new File(["x"], "new.png", { type: "image/png" }),
  );
  await user.click(screen.getByRole("button", { name: "Datei hochladen" }));
  await waitFor(() => expect(state.uploadDocument).toHaveBeenCalled());
  release([]);
  await waitFor(() => expect(initialSignal?.aborted).toBe(true));
  await screen.findByText(file.original_name);
  expect(calls).toBeGreaterThanOrEqual(2);
});
it("pins previews and current-row downloads to the exact selected metadata version", async () => {
  const user = userEvent.setup();
  state.downloadDocument.mockResolvedValue(new Blob(["fictional image"]));
  const revoke = vi.fn();

  class PreviewURL extends URL {
    static createObjectURL = vi.fn(() => "blob:fictional-preview");
    static revokeObjectURL = revoke;
  }

  vi.stubGlobal("URL", PreviewURL);
  setup(<SubjectDocuments ownerId="actor" />);
  await user.click(
    screen.getByRole("button", { name: "Herunterladen: Fictional image.png" }),
  );
  expect(state.saveDownload).toHaveBeenCalledWith(
    "file",
    "Fictional image.png",
    "reviewed-version",
  );
  await user.click(
    screen.getByRole("button", { name: "Vorschau: Fictional image.png" }),
  );
  await screen.findByRole("img", { name: "Fictional image.png" });
  expect(state.downloadDocument).toHaveBeenCalledWith(
    "file",
    "reviewed-version",
    expect.any(AbortSignal),
  );
  cleanup();
  await waitFor(() =>
    expect(revoke).toHaveBeenCalledWith("blob:fictional-preview"),
  );
});

it("aborts a preview when closed and ignores a late response without creating a Blob URL", async () => {
  const user = userEvent.setup();
  let complete!: (blob: Blob) => void;
  let signal: AbortSignal | undefined;
  state.downloadDocument.mockImplementation((_id, _version, requestSignal) => {
    signal = requestSignal;
    return new Promise<Blob>((resolve) => {
      complete = resolve;
    });
  });
  const create = vi.fn(() => "blob:late-preview");
  class PreviewURL extends URL {
    static createObjectURL = create;
    static revokeObjectURL = vi.fn();
  }
  vi.stubGlobal("URL", PreviewURL);

  setup(<SubjectDocuments ownerId="actor" />);
  await user.click(
    screen.getByRole("button", { name: "Vorschau: Fictional image.png" }),
  );
  await waitFor(() => expect(state.downloadDocument).toHaveBeenCalled());
  await user.click(screen.getByRole("button", { name: "Schließen" }));

  expect(signal?.aborted).toBe(true);
  complete(new Blob(["late bytes"]));
  await waitFor(() => expect(create).not.toHaveBeenCalled());
});
