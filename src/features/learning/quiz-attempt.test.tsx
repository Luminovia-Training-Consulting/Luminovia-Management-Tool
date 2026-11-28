/** Verify that a workspace refresh and a second tab cannot silently replace pending quiz answers. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import type { CourseWorkspace } from "./api";
import { QuizAttempt } from "./quiz-attempt";
import "./i18n";

const { rpc, courseAction } = vi.hoisted(() => ({
  rpc: vi.fn(),
  courseAction: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("./api", async (load) => ({
  ...(await load<typeof import("./api")>()),
  courseAction,
}));

const request = "b8bf9185-020b-43b7-83c6-beb7fe1fe1d5";
const quiz = {
  version: 3,
  published: true,
  attempts: 0,
  max_attempts: 2,
  pass_percent: 50,
  questions: [
    { prompt: "Fictional first question", options: ["First A", "First B"] },
    { prompt: "Fictional second question", options: ["Second A", "Second B"] },
  ],
  last_score: null,
  passed: false,
  draft: { request_id: request, revision: 1, answers: [0, 0] },
};
const client = new QueryClient();
const view = (revision: number, answers: number[]) => (
  <QueryClientProvider client={client}>
    <QuizAttempt
      actor="learner"
      academy={false}
      course={
        {
          id: "example-course",
          quiz: { ...quiz, draft: { request_id: request, revision, answers } },
        } as CourseWorkspace
      }
    />
  </QueryClientProvider>
);
afterEach(() => {
  cleanup();
  client.clear();
  vi.resetAllMocks();
  vi.useRealTimers();
});

it("uses the latest confirmed answers in a clean tab before submitting", async () => {
  await i18n.changeLanguage("en");
  const user = userEvent.setup();
  const rendered = render(view(1, [0, 0]));
  rendered.rerender(view(2, [1, 1]));
  expect(screen.getByRole("radio", { name: "First B" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Submit answers" }));
  expect(courseAction).toHaveBeenCalledWith(
    "example-course",
    "quiz_attempt",
    { request_id: request, answers: [1, 1] },
    3,
    false,
  );
});

it("keeps dirty edits visible and stops autosave and submission when a newer version differs", async () => {
  await i18n.changeLanguage("en");
  vi.useFakeTimers();
  const rendered = render(view(1, [0, 0]));
  fireEvent.click(screen.getByRole("radio", { name: "First B" }));
  rendered.rerender(view(2, [0, 1]));
  await act(async () => vi.advanceTimersByTimeAsync(700));
  expect(screen.getByRole("radio", { name: "First B" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Second A" })).toBeChecked();
  expect(
    screen.getByText("The answer draft changed. Reload the current draft."),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Submit answers" })).toBeDisabled();
  expect(rpc).not.toHaveBeenCalled();
  expect(courseAction).not.toHaveBeenCalled();
});
