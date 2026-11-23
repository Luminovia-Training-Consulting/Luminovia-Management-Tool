import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { LearnerExam, PublishedExamResults } from "./timed-exam";
import type { TimedExam } from "./timed-exam-schema";

const { rpc, upload } = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../files/api", () => ({
  acceptedFiles: ".pdf",
  uploadCourseSubmission: upload,
}));

const run = "19bcd476-8f8b-4cc8-9e5d-19dea2550be2";
const version = "ef67dd2e-eb97-40f1-81f4-dcb6ef7ef28a";
const actor = "fictional-learner";
const client = new QueryClient();

afterEach(() => {
  cleanup();
  client.clear();
  vi.resetAllMocks();
});

it("keeps a scanned upload as a draft until the learner confirms final submission", async () => {
  await i18n.changeLanguage("en");
  const now = Date.now();
  const receipt = new Date(now).toISOString();
  const exam: TimedExam = {
    title: "Fictional exam",
    visible_from: new Date(now - 60_000).toISOString(),
    starts_at: new Date(now - 30_000).toISOString(),
    ends_at: new Date(now + 60_000).toISOString(),
    pass_percent: 60,
    version: 1,
    required: true,
    published: false,
    open: true,
    grading_open: false,
    can_submit: true,
    can_grade: false,
    submitted_at: null,
    draft: null,
    rows: [],
  };
  upload.mockResolvedValue({ status: "clean", current_version_id: version });
  rpc.mockResolvedValue({ data: receipt, error: null });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <LearnerExam
        actor={actor}
        run={run}
        zone="Australia/Brisbane"
        exam={exam}
        now={now}
      />
    </QueryClientProvider>,
  );
  const file = new File(["fictional"], "filled.pdf", {
    type: "application/pdf",
  });
  await user.upload(screen.getByLabelText("Completed exam"), file);
  await user.click(screen.getByRole("button", { name: "Upload file" }));
  await user.click(await screen.findByRole("button", { name: "Submit exam" }));
  expect(upload).toHaveBeenCalledWith(file, run, expect.any(String), true);
  expect(rpc).not.toHaveBeenCalled();
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Submit exam",
    }),
  );
  expect(rpc).toHaveBeenCalledExactlyOnceWith("submit_course_exam", {
    p_run_id: run,
    p_version_id: version,
  });
  expect(await screen.findByText(/^Submitted on /)).toBeVisible();
  expect(screen.queryByLabelText("Completed exam")).not.toBeInTheDocument();
});

it("shows the published percentage, pass status and cross-course average", async () => {
  await i18n.changeLanguage("en");
  rpc.mockResolvedValue({
    data: {
      average: 75.5,
      results: [
        {
          run_id: run,
          course: "Fictional course",
          title: "Practical exam",
          score: 82,
          passed: true,
          published_at: "2026-11-23T10:00:00+10:00",
        },
        {
          run_id: version,
          course: "Fictional second course",
          title: "Written exam",
          score: 69,
          passed: false,
          published_at: "2026-11-20T10:00:00+10:00",
        },
      ],
    },
    error: null,
  });
  render(
    <QueryClientProvider client={client}>
      <PublishedExamResults actor={actor} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Average 75.5%")).toBeVisible();
  expect(screen.getByText(/82%.*Passed/)).toBeVisible();
  expect(screen.getByText(/69%.*Did not pass/)).toBeVisible();
});
