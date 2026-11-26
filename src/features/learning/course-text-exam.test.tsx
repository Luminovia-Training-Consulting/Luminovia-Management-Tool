/** Native exam state, disclosure and read-only policies at the component boundary. */
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
import { textExamCommand, type TextExamState } from "./course-text-exam-schema";
import { CourseTextExam } from "./course-text-exam";

const fake = vi.hoisted(() => ({ rpc: vi.fn(), online: true }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
vi.mock("../../lib/online", () => ({
  requireOnline: vi.fn(),
  useOnline: () => fake.online,
}));

const run = "8d28ce3a-8240-4c00-a0d0-9676be0fe4bf";
const now = "2026-11-26T04:45:00+00:00";
const beforeOpening: TextExamState = {
  now,
  staff: false,
  can_write: true,
  can_author: false,
  head_revision: null,
  versions: [{ revision: 1, title: "Network exam", published_at: now }],
  exam: {
    revision: 1,
    title: "Network exam",
    opens_at: "2026-11-26T05:00:00+00:00",
    closes_at: "2026-11-26T06:00:00+00:00",
    deadline: "2026-11-26T06:00:00+00:00",
    pass_percent: 70,
    published_at: now,
    questions: null,
  },
  submissions: [],
  has_more: false,
  attempt: null,
  review: null,
};

function openExam() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CourseTextExam actor="learner" course={run} zone="Australia/Brisbane" />
    </QueryClientProvider>,
  );
  expect(fake.rpc).not.toHaveBeenCalled();
  const details = screen.getByText("Text exam").closest("details");
  if (!details) throw new Error("Missing exam disclosure");
  details.open = true;
  fireEvent(details, new Event("toggle"));
}

function backend(data: TextExamState) {
  fake.rpc.mockImplementation(() => ({
    abortSignal: async () => ({ data, error: null }),
  }));
}

beforeEach(async () => {
  fake.rpc.mockReset();
  fake.online = true;
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

it("fetches on disclosure, shows the course zone and keeps unopened questions private", async () => {
  backend(beforeOpening);
  openExam();
  expect(
    await screen.findByText("Questions are available when the exam opens."),
  ).toBeVisible();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByText(/3:00 PM/)).toBeVisible();
  expect(fake.rpc).toHaveBeenCalledWith("course_text_exam", {
    p_run_id: run,
    p_revision: null,
    p_learner_id: null,
    p_offset: 0,
  });
});

it("allows reading an active exam during licence grace and disables editing", async () => {
  backend({
    ...beforeOpening,
    now: "2026-11-26T05:15:00+00:00",
    can_write: false,
    exam: {
      ...beforeOpening.exam!,
      questions: [{ prompt: "Describe the default route.", max_points: 10 }],
    },
  });
  openExam();
  expect(await screen.findByText("This exam is read-only.")).toBeVisible();
  expect(
    screen.getByRole("textbox", { name: "Answer to question 1" }),
  ).toHaveAttribute("readonly");
  expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
});

it("does not request private exam data offline", async () => {
  fake.online = false;
  openExam();
  expect(
    await screen.findByText("Text exams are available online."),
  ).toBeVisible();
  expect(fake.rpc).not.toHaveBeenCalled();
});

it("gives every answer a distinct name and associates the correct prompt", async () => {
  backend({
    ...beforeOpening,
    now: "2026-11-26T05:15:00+00:00",
    exam: {
      ...beforeOpening.exam!,
      questions: [
        { prompt: "Describe the default route.", max_points: 10 },
        { prompt: "Explain route priority.", max_points: 8 },
      ],
    },
  });
  openExam();
  const first = await screen.findByRole("textbox", {
    name: "Answer to question 1",
  });
  expect(first).toHaveAccessibleDescription("Describe the default route.");
  expect(
    screen.getByRole("textbox", { name: "Answer to question 2" }),
  ).toHaveAccessibleDescription("Explain route priority.");
  expect(screen.getByRole("status")).toHaveTextContent(
    "Saved drafts remain open until you submit them.",
  );
});

it("accepts only the action-specific schema and exact revision input", () => {
  const command = {
    p_run_id: run,
    p_action: "submit",
    p_expected: 3,
    p_revision: 1,
    p_payload: { answers: ["Use the configured next hop."] },
  };
  expect(textExamCommand.safeParse(command).success).toBe(true);
  expect(
    textExamCommand.safeParse({ ...command, p_revision: null }).success,
  ).toBe(false);
  expect(
    textExamCommand.safeParse({
      ...command,
      p_payload: { ...command.p_payload, learner_id: run },
    }).success,
  ).toBe(false);
});

it("saves the selected sitting and the selected allowance revision from the manager form", async () => {
  const learner = "633c3d79-6851-4638-b2e5-6a05cc9fd24a";
  backend({
    ...beforeOpening,
    staff: true,
    can_author: true,
    head_revision: 1,
    time_allowances: {
      rows: [
        {
          learner_id: learner,
          name: "Fictional learner",
          revision: 3,
          extra_minutes: 15,
        },
      ],
      has_more: false,
    },
  });
  openExam();
  const disclosure = await screen.findByText("Manage extra time");
  disclosure.closest("details")!.open = true;
  fireEvent.change(
    screen.getByRole("combobox", { name: "Learner receiving extra time" }),
    {
      target: { value: learner },
    },
  );
  const minutes = screen.getByRole("spinbutton", {
    name: "Extra time in minutes",
  });
  expect(minutes).toHaveValue(15);
  fireEvent.change(minutes, { target: { value: "481" } });
  expect(
    screen.getByRole("button", { name: "Save extra time" }),
  ).toBeDisabled();
  fireEvent.change(minutes, { target: { value: "0" } });
  fake.rpc.mockResolvedValueOnce({ data: 4, error: null });
  fireEvent.click(screen.getByRole("button", { name: "Save extra time" }));
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith("course_text_exam_action", {
      p_run_id: run,
      p_action: "set_extra_time",
      p_revision: 1,
      p_expected: 3,
      p_payload: { learner_id: learner, extra_minutes: 0 },
    }),
  );
});
