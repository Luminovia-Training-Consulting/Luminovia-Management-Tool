import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import {
  ExamGrades,
  ExamTimeAllowance,
  LearnerExam,
  PublishedExamResults,
} from "./timed-exam";
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

it("reviews a spreadsheet replacement against its captured examination version", async () => {
  await i18n.changeLanguage("en");
  const stamp = "2026-11-23T10:00:00+10:00";
  const exam: TimedExam = {
    title: "Fictional exam grade import",
    required: true,
    published: false,
    visible_from: stamp,
    starts_at: stamp,
    ends_at: stamp,
    pass_percent: 60,
    version: 2,
    grading_open: true,
    open: false,
    can_submit: false,
    can_grade: true,
    submitted_at: null,
    draft: null,
    rows: [
      {
        participant_id: version,
        name: "Fictional participant",
        score: 65,
        submitted_at: null,
        version_id: null,
        file_name: null,
        grade_import_eligible: true,
      },
    ],
  };
  const view = (snapshot: TimedExam) => (
    <QueryClientProvider client={client}>
      <ExamGrades actor={actor} run={run} exam={snapshot} />
    </QueryClientProvider>
  );
  const rendered = render(view(exam));
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Import exam grades" }),
  );
  const dialog = within(screen.getByRole("dialog"));
  const spreadsheet = (examVersion: number) =>
    Object.assign(new File([], "scores.csv"), {
      arrayBuffer: async () =>
        new TextEncoder().encode(
          `course_id,exam_version,participant_id,name,score\n${run},${examVersion},${version},Alternate name,81`,
        ).buffer,
    });
  await user.upload(
    dialog.getByLabelText("Choose grade spreadsheet"),
    spreadsheet(2),
  );
  expect(await dialog.findByText("65% → 81%")).toBeVisible();
  const apply = dialog.getByRole("button", { name: "Save 1 grade as draft" });
  expect(apply).toBeDisabled();
  await user.click(
    dialog.getByRole("checkbox", { name: "Replace 1 saved draft" }),
  );
  expect(apply).toBeEnabled();
  expect(rpc).not.toHaveBeenCalled();
  rendered.rerender(view({ ...exam, version: 3 }));
  expect(apply).toBeDisabled();
  expect(
    dialog.getByText(/^The exam, grades or learners changed/),
  ).toBeVisible();
  await user.upload(
    dialog.getByLabelText("Choose grade spreadsheet"),
    spreadsheet(3),
  );
  await user.click(
    await dialog.findByRole("checkbox", { name: "Replace 1 saved draft" }),
  );
  rpc.mockResolvedValue({ data: 1, error: null });
  const applyCurrent = dialog.getByRole("button", {
    name: "Save 1 grade as draft",
  });
  expect(applyCurrent).toBeEnabled();
  await user.click(applyCurrent);
  expect(await dialog.findByText("1 grade was saved as draft.")).toBeVisible();
  expect(rpc).toHaveBeenCalledExactlyOnceWith("import_course_exam_grades", {
    p_run_id: run,
    p_version: 3,
    p_rows: [{ participant_id: version, expected_score: 65, score: 81 }],
  });
});

it("keeps a scanned upload as a draft until the learner confirms within the individual window", async () => {
  await i18n.changeLanguage("en");
  const now = Date.now();
  const receipt = new Date(now).toISOString();
  const exam: TimedExam = {
    title: "Fictional exam",
    visible_from: new Date(now - 60_000).toISOString(),
    starts_at: new Date(now - 30_000).toISOString(),
    ends_at: new Date(now - 1_000).toISOString(),
    learner_ends_at: new Date(now + 60_000).toISOString(),
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
  expect(screen.getByRole("timer")).toHaveTextContent("1 minute remaining");
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
  expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Completed exam")).not.toBeInTheDocument();
});

it("saves the selected participant’s time allowance from its reviewed revision", async () => {
  await i18n.changeLanguage("en");
  const stamp = "2026-11-23T10:00:00+10:00";
  const exam: TimedExam = {
    title: "Fictional written examination",
    visible_from: stamp,
    starts_at: stamp,
    ends_at: stamp,
    pass_percent: 60,
    version: 1,
    required: true,
    published: false,
    open: false,
    grading_open: false,
    can_grade: true,
    can_submit: false,
    can_set_extra_time: true,
    submitted_at: null,
    draft: null,
    rows: [
      {
        participant_id: version,
        name: "Fictional participant",
        submitted_at: null,
        version_id: null,
        file_name: null,
        score: null,
        time_allowance: { extra_minutes: 15, revision: 2 },
      },
    ],
  };
  rpc.mockResolvedValue({ data: 3, error: null });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <ExamTimeAllowance actor="manager" run={run} exam={exam} />
    </QueryClientProvider>,
  );
  await user.selectOptions(screen.getByLabelText("Participant"), version);
  const minutes = screen.getByLabelText("Additional minutes");
  expect(minutes).toHaveValue(15);
  await user.clear(minutes);
  await user.type(minutes, "30");
  await user.click(screen.getByRole("button", { name: "Save exam time" }));
  expect(await screen.findByText("Saved.")).toBeVisible();
  expect(rpc).toHaveBeenCalledExactlyOnceWith("set_course_exam_extra_time", {
    p_run_id: run,
    p_participant_id: version,
    p_extra_minutes: 30,
    p_expected_revision: 2,
  });
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
