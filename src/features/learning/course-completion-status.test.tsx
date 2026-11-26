/** Component checks for selected learner scope and truthful completion guidance. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import type { CourseCompletionStatus, CourseWorkspace } from "./api";
import { StaffCompletionRequirements } from "./course-completion-status";
import "./i18n";

const { rpc, useOnline } = vi.hoisted(() => ({
  rpc: vi.fn(),
  useOnline: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../../lib/online", () => ({ requireOnline: vi.fn(), useOnline }));

const course = {
  id: "fictional-course",
  time_zone: "Europe/Berlin",
  roster: [{ user_id: "fictional-learner", name: "Fictional learner" }],
} as CourseWorkspace;
const pending: CourseCompletionStatus = {
  enrolment_completed: false,
  session_count: 2,
  ended_count: 1,
  verified_count: 1,
  ends_at: "2026-11-28T08:00:00Z",
  quiz_version: 2,
  quiz_passed: false,
  reverify_required: true,
  rule_version: 1,
  state: "pending",
};

/** Render just the real staff completion panel with a local scoped query cache. */
function mount() {
  const client = new QueryClient();
  const panel = () => (
    <QueryClientProvider client={client}>
      <StaffCompletionRequirements course={course} actor="fictional-teacher" />
    </QueryClientProvider>
  );
  const view = render(panel());
  return () => view.rerender(panel());
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  useOnline.mockReturnValue(true);
  rpc.mockImplementation(() => ({
    abortSignal: async () => ({ data: pending, error: null }),
  }));
});
afterEach(() => {
  cleanup();
  rpc.mockReset();
});

it("only requests the chosen learner and explains each active requirement", async () => {
  mount();
  expect(rpc).not.toHaveBeenCalled();
  fireEvent.change(
    screen.getByRole("combobox", { name: "Select a participant" }),
    {
      target: { value: "fictional-learner" },
    },
  );
  expect(await screen.findByText(/outstanding requirements/)).toBeVisible();
  expect(screen.getByText(/enrolment must be marked completed/)).toBeVisible();
  expect(screen.getByText(/All sessions must have ended.*9:00/)).toBeVisible();
  expect(
    screen.getByText(/80% verified attendance \(1 of 2 verified\)/),
  ).toBeVisible();
  expect(screen.getByText(/published quiz \(version 2\)/)).toBeVisible();
  expect(screen.getByText(/staff must verify attendance again/)).toBeVisible();
  expect(rpc).toHaveBeenCalledWith("course_completion_status", {
    p_run_id: "fictional-course",
    p_user_id: "fictional-learner",
  });
});

it("preserves issued status in view and discards the displayed evidence offline", async () => {
  rpc.mockImplementation(() => ({
    abortSignal: async () => ({
      data: { ...pending, state: "issued" },
      error: null,
    }),
  }));
  const rerender = mount();
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "fictional-learner" },
  });
  expect(await screen.findByText("Completion document issued.")).toBeVisible();
  expect(
    screen.queryByText(/outstanding requirements/),
  ).not.toBeInTheDocument();
  useOnline.mockReturnValue(false);
  rerender();
  expect(screen.getByText(/available online/)).toBeVisible();
  expect(
    screen.queryByText("Completion document issued."),
  ).not.toBeInTheDocument();
});

it("shows a scoped exception and refreshes after the learner issues the document", async () => {
  const ready: CourseCompletionStatus = {
    ...pending,
    enrolment_completed: true,
    ended_count: 2,
    verified_count: 2,
    quiz_passed: true,
    reverify_required: false,
    rule_version: 2,
    state: "ready",
    policy: {
      version: 1,
      attendance_percent: 60,
      assignment: {
        title: "Fictional assignment",
        met: false,
        exception: { accepted: true, revision: 1 },
      },
      competency: null,
      verification: null,
      target_at: null,
    },
  };
  rpc.mockImplementationOnce(() => ({
    abortSignal: async () => ({ data: ready, error: null }),
  }));
  rpc.mockImplementationOnce(() => ({
    abortSignal: async () => ({
      data: { ...ready, state: "issued" },
      error: null,
    }),
  }));
  mount();
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "fictional-learner" },
  });
  expect(
    await screen.findByText(
      "Exception granted for the required assignment: Fictional assignment",
    ),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh completion status" }),
  );
  expect(await screen.findByText("Completion document issued.")).toBeVisible();
  expect(rpc).toHaveBeenCalledTimes(2);
});
