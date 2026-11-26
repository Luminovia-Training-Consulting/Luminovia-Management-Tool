/** Bank interactions preserve the chosen revision and keep the answer index valid while editing. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { QuestionBank } from "./question-bank";
import { objectiveQuestionInput } from "./question-bank-schema";
import "./i18n";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: mocks.rpc }) }));
vi.mock("../../lib/online", () => ({
  requireOnline: vi.fn(),
  useOnline: () => true,
}));

const row = {
  id: "82ab2348-4504-42a4-bf7a-e310eda55ac9",
  revision: 4,
  topic: "Shell basics",
  difficulty: "introductory",
  content: {
    prompt: "Which command lists a directory?",
    options: ["pwd", "cd", "ls"],
    correct: 2,
  },
  archived: false,
  can_edit: true,
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
  mocks.rpc.mockImplementation((rpc) =>
    rpc === "course_question_bank"
      ? {
          abortSignal: async () => ({
            data: { items: [row], has_more: false },
            error: null,
          }),
        }
      : Promise.resolve({ data: { id: row.id, version: 5 }, error: null }),
  );
});
afterEach(cleanup);

/** Each render has an isolated query cache and no native services. */
async function openBank() {
  const onSelect = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <QuestionBank
        actor="actor"
        courseId="course"
        selected={new Set()}
        canSelect
        onSelect={onSelect}
      />
    </QueryClientProvider>,
  );
  expect(mocks.rpc).not.toHaveBeenCalled();
  const summary = screen.getByText("Question bank");
  const details = summary.closest("details");
  if (!details) throw Error("Expected disclosure around the bank");
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await screen.findByText(row.content.prompt);
  return { user: userEvent.setup(), onSelect };
}

it("pins precisely the listed revision when a bank question joins the builder", async () => {
  const { user, onSelect } = await openBank();
  await user.click(screen.getByRole("button", { name: "Add to quiz" }));
  expect(onSelect).toHaveBeenCalledWith(row);
});

it("submits a revision-checked update with a valid answer after options shrink", async () => {
  const { user } = await openBank();
  await user.click(
    screen.getByRole("button", { name: "Edit as new revision" }),
  );
  fireEvent.change(screen.getByLabelText(/Answer options/), {
    target: { value: "cd\nls" },
  });
  expect(screen.getByLabelText("Correct answer")).toHaveValue("1");
  await user.click(
    screen.getByRole("button", { name: "Save question revision" }),
  );
  await waitFor(() =>
    expect(mocks.rpc).toHaveBeenCalledWith("course_question_bank_action", {
      p_run_id: "course",
      p_action: "save",
      p_expected_version: 4,
      p_payload: {
        id: row.id,
        topic: row.topic,
        difficulty: row.difficulty,
        content: { ...row.content, options: ["cd", "ls"], correct: 1 },
      },
    }),
  );
});

it("rejects an answer index outside the objective question's options", () => {
  expect(
    objectiveQuestionInput.safeParse({ ...row.content, options: ["pwd", "ls"] })
      .success,
  ).toBe(false);
});
