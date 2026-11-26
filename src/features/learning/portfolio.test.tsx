/** Keep the recipient and reviewed revision explicit in the owner's sharing form. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { PersonalPortfolio } from "./portfolio";
import { PortfolioEvidenceFiles } from "./portfolio-evidence";
import "./i18n";

const { rpc, upload, download } = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
}));
vi.mock("../files/api", () => ({
  acceptedFiles: ".txt",
  uploadPortfolioEvidence: upload,
}));
vi.mock("./api", () => ({ downloadPortalDocument: download }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../../lib/online", () => ({
  requireOnline: vi.fn(),
  useOnline: () => true,
}));

const entry = "26fb86d5-c086-4a3e-83cf-f62378b94756";
const course = "4fb6ebee-ff2b-4d35-a49f-cd284961b9a5";
const teacher = "03e8433c-34f1-412a-8eec-db613694df0c";
const projection = {
  entries: [
    {
      id: entry,
      current: {
        revision: 2,
        title: "Private reflection",
        body: "Current private text",
        created_at: "2026-11-26T08:00:00Z",
      },
      history: null,
      shares: [],
    },
  ],
  targets: [
    {
      course_id: course,
      course: "Fictional Linux training",
      teacher_id: teacher,
      teacher: "Fictional instructor",
    },
  ],
};

function mount(readOnly = false) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PersonalPortfolio actor="fictional-actor" readOnly={readOnly} />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  rpc.mockImplementation((name) =>
    name === "learning_portfolio"
      ? { abortSignal: async () => ({ data: projection, error: null }) }
      : Promise.resolve({ data: { share_id: entry }, error: null }),
  );
});
afterEach(() => {
  cleanup();
  rpc.mockReset();
  upload.mockReset();
  download.mockReset();
});

it("requires a named recipient and sends the reviewed immutable revision", async () => {
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: /^Share revision$/ }),
  );
  const share = screen.getByRole("button", {
    name: /^Share revision 2$/,
  });
  expect(share).toBeDisabled();
  fireEvent.change(
    screen.getByRole("combobox", { name: "Instructor and course" }),
    {
      target: { value: course + ":" + teacher },
    },
  );
  fireEvent.click(share);
  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith("learning_portfolio_command", {
      p_entry_id: entry,
      p_action: "share",
      p_expected_revision: 2,
      p_payload: { course_id: course, teacher_id: teacher },
    }),
  );
});

it("shows personal entries and export with no edit or share controls during licence grace", async () => {
  mount(true);
  expect(await screen.findByText("Current private text")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Export my portfolio" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Edit entry" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Share revision" }),
  ).not.toBeInTheDocument();
});

it("links only the scanner-confirmed version to the visible owner revision", async () => {
  const cleanVersion = "5ee2578b-a20c-4fd1-8095-476d6dfea006";
  upload.mockResolvedValue(cleanVersion);
  mount();
  fireEvent.change(await screen.findByLabelText("Choose a file"), {
    target: {
      files: [
        new File(["Fictional proof"], "exercise.txt", { type: "text/plain" }),
      ],
    },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Scan and link file", hidden: true }),
  );
  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith("learning_portfolio_command", {
      p_entry_id: entry,
      p_action: "link",
      p_expected_revision: 2,
      p_payload: { version_id: cleanVersion },
    }),
  );
});

it("requests the exact version from the named share without owner controls", async () => {
  download.mockResolvedValue(undefined);
  const version = "5ee2578b-a20c-4fd1-8095-476d6dfea006";
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PortfolioEvidenceFiles
        id={entry}
        revision={2}
        shared
        items={[{ version_id: version, name: "exercise.txt" }]}
      />
    </QueryClientProvider>,
  );
  expect(
    screen.queryByRole("button", { name: "Unlink exercise.txt" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Download exercise.txt" }),
  );
  await waitFor(() =>
    expect(download).toHaveBeenCalledWith(
      {
        kind: "portfolio_evidence",
        id: entry,
        revision: 2,
        shared: true,
        version_id: version,
      },
      "exercise.txt",
    ),
  );
});
