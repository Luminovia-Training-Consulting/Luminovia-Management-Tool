import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import { WikiAttachments } from "./wiki-attachments";
import type { WikiPageRecord } from "./types";

const fake = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
vi.mock("../files/api", () => ({
  acceptedFiles: ".txt",
  uploadDocument: fake.upload,
}));
vi.mock("../learning/api", () => ({ downloadPortalDocument: fake.download }));
const page = {
  id: "page",
  version: 2,
  published_version: 1,
  status: "published",
} as WikiPageRecord;

function view(record = page, canEdit = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WikiAttachments actor="actor" page={record} canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("uploads once and retries the same version after an unconfirmed attachment, then downloads the authorized link", async () => {
  await i18n.changeLanguage("de");
  let attached = false;
  fake.upload.mockResolvedValue({ current_version_id: "version" });
  let attempts = 0;
  fake.rpc.mockImplementation(async (name: string) => {
    if (name === "wiki_attachments")
      return {
        data: attached
          ? [{ id: "link", version_id: "version", name: "fictional.txt" }]
          : [],
        error: null,
      };
    if (++attempts === 1) return { error: { message: "uncertain" } };
    attached = true;
    return { error: null };
  });
  view();
  const user = userEvent.setup();
  await user.upload(
    screen.getByLabelText("Datei für den Wiki-Entwurf auswählen"),
    new File(["fiction"], "fictional.txt", { type: "text/plain" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Datei prüfen und anhängen" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("nicht bestätigt");
  await user.click(
    screen.getByRole("button", { name: "Datei prüfen und anhängen" }),
  );
  const button = await screen.findByRole("button", {
    name: "Anhang fictional.txt herunterladen",
  });
  expect(fake.upload).toHaveBeenCalledTimes(1);
  expect(fake.rpc).toHaveBeenCalledWith("manage_wiki_attachment", {
    p_page_id: "page",
    p_revision: 2,
    p_version_id: "version",
    p_remove: false,
  });
  await user.click(button);
  expect(fake.download).toHaveBeenCalledWith(
    { kind: "wiki_resource", id: "link" },
    "fictional.txt",
  );
});
it("does not show editing controls on a published revision and handles a forbidden list without exposing cached files", async () => {
  await i18n.changeLanguage("en");
  fake.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
  view({ ...page, version: 1, published_version: 1 });
  const section = screen.getByRole("region", { name: "Attachments" });
  expect(await within(section).findByRole("alert")).toBeVisible();
  expect(
    within(section).queryByLabelText("Choose a file for the wiki draft"),
  ).not.toBeInTheDocument();
  expect(
    within(section).getByText("Save a new draft before changing attachments."),
  ).toBeVisible();
});
