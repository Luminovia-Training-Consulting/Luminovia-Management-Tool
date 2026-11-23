import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import "../../lib/i18n";
import { BuildingBlockSources } from "./building-blocks";
import type { BuildingBlock } from "./data";

const { from, saveDownload } = vi.hoisted(() => ({
  from: vi.fn(),
  saveDownload: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ from }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
vi.mock("../files/api", () => ({ saveDownload }));

const source = {
  id: "source",
  building_block_id: "block",
  file_name: "Source.pdf",
  sha256: "a".repeat(64),
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
});

it("does not look up private job files from a catalogue reference", () => {
  mount(null);
  expect(screen.getByText("Source.pdf")).toBeVisible();
  expect(from).not.toHaveBeenCalled();
});
