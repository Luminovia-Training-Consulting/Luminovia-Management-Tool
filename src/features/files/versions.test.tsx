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
it.each(["documents", "document", "document-versions"])(
  "replaces an initial pre-upload %s read with a confirmed post-upload read",
  async (key) => {
    const user = userEvent.setup();
    let release!: (value: PortalDocument[]) => void;
    let aborted = false;
    let reads = 0;
    const oldRead = new Promise<PortalDocument[]>((resolve) => {
      release = resolve;
    });
    function Documents() {
      const query = useQuery({
        queryKey: [key, "pending"],
        queryFn: ({ signal }) => {
          reads++;
          if (reads > 1) return Promise.resolve([file]);
          signal.addEventListener("abort", () => {
            aborted = true;
          });
          return oldRead;
        },
      });
      return <div>{query.data?.map((item) => item.original_name)}</div>;
    }
    state.uploadDocument.mockResolvedValue(file);
    setup(
      <>
        <Documents />
        <FileUpload context={{ scope: "personal" }} />
      </>,
    );
    await waitFor(() => expect(reads).toBe(1));
    await user.upload(
      screen.getByLabelText("Datei auswählen"),
      new File(["fictional"], "new.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "Datei hochladen" }));
    await screen.findByText(file.original_name);
    expect(aborted).toBe(true);
    expect(reads).toBe(2);
    release([]);
    await screen.findByText(file.original_name);
  },
);
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
  );
  cleanup();
  await waitFor(() =>
    expect(revoke).toHaveBeenCalledWith("blob:fictional-preview"),
  );
});
