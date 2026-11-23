import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import "../../lib/i18n";
import { BuildingBlockSources } from "./building-blocks";
import type { BuildingBlock } from "./data";

const {
  from,
  saveDownload,
  uploadDocument,
  jobSourceAvailable,
  saveJobSource,
} = vi.hoisted(() => ({
  from: vi.fn(),
  saveDownload: vi.fn(),
  uploadDocument: vi.fn(),
  jobSourceAvailable: vi.fn(),
  saveJobSource: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ from }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
vi.mock("../files/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../files/api")>()),
  saveDownload,
  uploadDocument,
  jobSourceAvailable,
  saveJobSource,
}));

const source = {
  id: "source",
  building_block_id: "block",
  file_name: "Source.pdf",
  sha256: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
  page_count: 2,
  content_pages: [1],
  created_on: "2025-01-01",
  revision_on: "2025-01-02",
  is_primary: true,
};
const block: BuildingBlock = {
  id: "block",
  provider: "Example",
  code: "COURSE",
  title: "Example training",
  description: "",
  syllabus: "",
  prerequisites: "",
  duration_days: 1,
  duration_hours: 8,
  theory_percent: null,
  practice_percent: null,
  notes: "",
  default_template_id: "template",
  building_block_sources: [source],
};

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.resetAllMocks();
});

function mount(
  data: { id: string; document_id: string } | null,
  jobId?: string,
  canManageJobSource = false,
  sourceInLibrary = false,
) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    abortSignal: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
  from.mockReturnValue(query);
  jobSourceAvailable.mockResolvedValue(sourceInLibrary);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/jobs/job-a"]}>
        <BuildingBlockSources
          block={block}
          sourceId={source.id}
          jobId={jobId}
          canManageJobSource={canManageJobSource}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return query;
}

it("downloads the exact scanned PDF version attached to this job", async () => {
  const query = mount(
    { id: "version-original", document_id: "attachment" },
    "job-a",
  );
  const button = await screen.findByRole("button", { name: /Source\.pdf/ });
  expect(query.eq).toHaveBeenCalledWith("documents.job_id", "job-a");
  expect(query.is).toHaveBeenCalledWith("documents.deleted_at", null);
  expect(query.eq).toHaveBeenCalledWith("status", "clean");
  expect(query.eq).toHaveBeenCalledWith("mime_type", "application/pdf");
  expect(query.eq).toHaveBeenCalledWith("sha256", source.sha256);
  await userEvent.click(button);
  expect(saveDownload).toHaveBeenCalledExactlyOnceWith(
    "attachment",
    "Source.pdf",
    "version-original",
  );
});

it("links to the attachments when the source is metadata only", async () => {
  mount(null, "job-a");
  await screen.findByText(/Diese PDF ist|This PDF is/);
  expect(screen.queryByRole("button", { name: /Source\.pdf/ })).toBeNull();
  expect(
    screen.getByRole("link", { name: /Auftragsdateien|job attachments/ }),
  ).toHaveAttribute("href", "/jobs/job-a#job-documents");
  expect(saveDownload).not.toHaveBeenCalled();
  expect(
    screen.queryByText(/Original-PDF anhängen|Attach original PDF/),
  ).toBeNull();
});

it("does not look up private job files from a catalogue reference", () => {
  mount(null);
  expect(screen.getByText("Source.pdf")).toBeVisible();
  expect(from).not.toHaveBeenCalled();
});

it("lets job managers attach only bytes matching the referenced original", async () => {
  const query = mount(null, "job-a", true);
  const user = userEvent.setup();
  await user.click(
    await screen.findByText(/Original-PDF anhängen|Attach original PDF/),
  );
  const scope = screen.getByRole("combobox", { name: /Freigabe|Sharing/ });
  expect(scope).toHaveValue("job_after");
  const input = screen.getByLabelText(/Datei auswählen|Choose file/);
  const upload = screen.getByRole("button", {
    name: /Datei hochladen|Upload file/,
  });
  function pdf(bytes: string) {
    const file = new File([bytes], "Source.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new TextEncoder().encode(bytes).buffer,
    });
    return file;
  }

  await user.upload(input, pdf("different revision"));
  await user.click(upload);
  await screen.findByText(/anderen Dateiversion|different revision/);
  expect(uploadDocument).not.toHaveBeenCalled();

  const original = pdf("a");
  uploadDocument.mockImplementation(async () => {
    query.maybeSingle.mockResolvedValue({
      data: { id: "version-original", document_id: "attachment" },
      error: null,
    });
    return { id: "attachment" };
  });
  await user.upload(input, original);
  await user.click(upload);
  expect(
    await screen.findByRole("button", { name: /Source\.pdf/ }),
  ).toBeVisible();
  expect(uploadDocument).toHaveBeenCalledExactlyOnceWith(
    original,
    expect.objectContaining({ jobId: "job-a", scope: "job_after" }),
    expect.any(Function),
  );
});

it("downloads an original from the private library without a separate job attachment", async () => {
  mount(null, "job-a", true, true);
  await userEvent.click(
    await screen.findByRole("button", { name: /Source\.pdf/ }),
  );
  expect(saveJobSource).toHaveBeenCalledExactlyOnceWith(
    "job-a",
    source.id,
    "Source.pdf",
  );
  expect(uploadDocument).not.toHaveBeenCalled();
  expect(
    screen.queryByText(/Original-PDF anhängen|Attach original PDF/),
  ).toBeNull();
});
