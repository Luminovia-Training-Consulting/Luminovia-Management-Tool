import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { CourseSubmissions } from "./course-submissions";
import "./i18n";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: mocks.rpc }) }));
vi.mock("./api", () => ({ downloadPortalDocument: mocks.download }));
vi.mock("../files/api", () => ({
  acceptedFiles: ".txt",
  uploadCourseSubmission: mocks.upload,
}));

const courseId = "6b0b7d6b-47c6-4f36-9bb4-39a03aedb3d7";
const version = "88367f07-a9e3-4e76-9e34-5cbd1228cb98";
const entry = {
  name: "Fictional lab.txt",
  version_id: version,
  size_bytes: 12,
  submitted_at: "2026-11-22T11:30:00+00:00",
  participant: null,
  can_withdraw: true,
};
const empty = {
  enabled: false,
  can_manage: false,
  can_upload: false,
  entries: [],
  next: null,
};

function show() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CourseSubmissions actor="fictional-actor" courseId={courseId} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("opens intake only after the course authorizes the manager's update", async () => {
  let enabled = false;
  mocks.rpc.mockImplementation(async (name, input) => {
    if (name === "set_course_submissions") enabled = input.p_enabled;
    return { data: { ...empty, enabled, can_manage: true }, error: null };
  });
  const user = show();
  expect(await screen.findByText(/currently closed/)).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "Allow file submissions" }),
  );
  expect(mocks.rpc).toHaveBeenCalledWith("set_course_submissions", {
    p_run_id: courseId,
    p_enabled: true,
  });
  expect(
    await screen.findByRole("button", { name: "Close file submissions" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Submit file" }),
  ).not.toBeInTheDocument();
});

it("retries the same file reservation and withdraws only the confirmed exact version", async () => {
  let entries: (typeof entry)[] = [];
  mocks.rpc.mockImplementation(async (name) => {
    if (name === "withdraw_course_submission") entries = [];
    return {
      data: { ...empty, enabled: true, can_upload: true, entries },
      error: null,
    };
  });
  mocks.upload
    .mockRejectedValueOnce(new Error("scanner_unavailable"))
    .mockImplementationOnce(async () => {
      entries = [entry];
    });
  const user = show();
  const file = new File(["Fictional lab"], entry.name, { type: "text/plain" });
  await user.upload(await screen.findByLabelText("Choose file"), file);
  await user.click(screen.getByRole("button", { name: "Submit file" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /temporarily unavailable/,
  );
  await user.click(screen.getByRole("button", { name: "Submit file" }));
  expect(
    await screen.findByText("The scanned file was submitted."),
  ).toBeVisible();
  const first = mocks.upload.mock.calls[0];
  expect(first.slice(0, 2)).toEqual([file, courseId]);
  expect(mocks.upload.mock.calls[1]).toEqual(first);
  await user.click(
    screen.getByRole("button", { name: "Download file: Fictional lab.txt" }),
  );
  expect(mocks.download).toHaveBeenCalledWith(
    { kind: "participant_submission", id: courseId, version_id: version },
    entry.name,
  );
  await user.click(
    screen.getByRole("button", {
      name: "Withdraw submission: Fictional lab.txt",
    }),
  );
  const dialog = screen.getByRole("dialog", { name: "Withdraw submission" });
  expect(
    mocks.rpc.mock.calls.some(
      ([name]) => name === "withdraw_course_submission",
    ),
  ).toBe(false);
  await user.click(
    within(dialog).getByRole("button", { name: "Withdraw submission" }),
  );
  expect(
    await screen.findByText("The submission was withdrawn."),
  ).toBeVisible();
  expect(mocks.rpc).toHaveBeenCalledWith("withdraw_course_submission", {
    p_run_id: courseId,
    p_version_id: version,
  });
  expect(screen.queryByText(entry.name)).not.toBeInTheDocument();
});
