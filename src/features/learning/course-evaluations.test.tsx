import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { CourseEvaluations } from "./course-evaluations";
import type { EvaluationTarget } from "./course-evaluation-schema";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
const run = "acbbd476-8f8b-4cc8-9e5d-19dea2550be2";
const instructor: EvaluationTarget = {
  subject_kind: "lecturer",
  subject_id: "ef67dd2e-eb97-40f1-81f4-dcb6ef7ef28a",
  rater_role: "learner",
  label: "Fictional instructor",
};
const difficulty: EvaluationTarget = {
  subject_kind: "course",
  subject_id: run,
  rater_role: "lecturer",
  label: "Fictional course",
};
const result = (data: unknown) => ({ data, error: null });
const clients: QueryClient[] = [];

function renderEvaluations(readOnly = false) {
  const client = new QueryClient();
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <CourseEvaluations
        actor="current-actor"
        courseId={run}
        readOnly={readOnly}
      />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  rpc.mockReset().mockImplementation(() => ({
    abortSignal: () => Promise.reject(new Error("Unexpected call")),
  }));
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

it("publishes the server-selected instructor rating and edits the confirmed version", async () => {
  let mine: Array<
    EvaluationTarget & { score: number; comment: string; version: number }
  > = [];
  rpc.mockImplementation(
    (
      name: string,
      params: {
        p_score: number;
        p_comment: string;
        p_expected_version: number;
      },
    ) => {
      if (name === "course_evaluations")
        return {
          abortSignal: async () =>
            result({
              completed: true,
              writable: true,
              targets: [instructor, difficulty],
              mine,
              summaries: [
                {
                  ...instructor,
                  count: 1,
                  average: 4,
                  can_read_comments: false,
                },
              ],
            }),
        };
      if (name === "save_course_evaluation") {
        const row = {
          ...instructor,
          score: params.p_score,
          comment: params.p_comment,
          version: params.p_expected_version + 1,
        };
        mine = [row];
        return Promise.resolve(result(row));
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  );
  const user = userEvent.setup();
  renderEvaluations();
  await user.selectOptions(await screen.findByLabelText("Score"), "4");
  await user.type(
    screen.getByLabelText("Comment (optional)"),
    "Clear practical explanations.",
  );
  await user.click(screen.getByRole("button", { name: "Save evaluation" }));
  expect(await screen.findByText("Evaluation saved.")).toBeVisible();
  expect(rpc).toHaveBeenCalledWith("save_course_evaluation", {
    p_run_id: run,
    p_subject_kind: "lecturer",
    p_subject_id: instructor.subject_id,
    p_rater_role: "learner",
    p_score: 4,
    p_comment: "Clear practical explanations.",
    p_expected_version: 0,
  });
  await user.selectOptions(screen.getByLabelText("Score"), "5");
  await user.click(screen.getByRole("button", { name: "Save evaluation" }));
  expect(await screen.findByText("Evaluation saved.")).toBeVisible();
  expect(rpc).toHaveBeenLastCalledWith("course_evaluations", { p_run_id: run });
  expect(rpc).toHaveBeenCalledWith(
    "save_course_evaluation",
    expect.objectContaining({ p_score: 5, p_expected_version: 1 }),
  );
  expect(
    screen.queryByRole("button", { name: /Comments/ }),
  ).not.toBeInTheDocument();
  expect(
    rpc.mock.calls.some(([name]) => name === "course_evaluation_comments"),
  ).toBe(false);
  await user.selectOptions(
    screen.getByLabelText("Who or what are you evaluating?"),
    `lecturer/course/${run}`,
  );
  expect(
    within(screen.getByLabelText("Course difficulty")).getByRole("option", {
      name: "5 · Very challenging",
    }),
  ).toBeVisible();
});

it("shows translated read-only results and requests the next scoped comment page", async () => {
  await i18n.changeLanguage("de");
  const first = "a28d0f03-58da-41d3-b98c-f6135d9f2a98";
  const second = "14b7fafa-1776-4aec-907a-5b025b560225";
  rpc.mockImplementation(
    (name: string, params: { p_after?: string | null }) => ({
      abortSignal: async () =>
        name === "course_evaluations"
          ? result({
              completed: true,
              writable: true,
              targets: [instructor],
              mine: [],
              summaries: [
                {
                  ...instructor,
                  count: 2,
                  average: 4.5,
                  can_read_comments: true,
                },
              ],
            })
          : result(
              params.p_after
                ? {
                    items: [
                      { id: second, score: 4, comment: "Zweiter Hinweis" },
                    ],
                    next: null,
                  }
                : {
                    items: [{ id: first, score: 5, comment: "Erster Hinweis" }],
                    next: first,
                  },
            ),
    }),
  );
  const user = userEvent.setup();
  renderEvaluations(true);
  expect(await screen.findByText(/4,5 von 5 · 2 Bewertungen/)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Bewertung speichern" }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", {
      name: /Einzelbewertungen.*Fictional instructor/,
    }),
  );
  expect(await screen.findByText("Erster Hinweis")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Nächste Seite" }));
  expect(await screen.findByText("Zweiter Hinweis")).toBeVisible();
  expect(rpc).toHaveBeenLastCalledWith("course_evaluation_comments", {
    p_run_id: run,
    p_subject_id: instructor.subject_id,
    p_subject_kind: "lecturer",
    p_rater_role: "learner",
    p_after: first,
  });
});

it("uses the confirmed revision while the results refresh is still pending", async () => {
  let reads = 0;
  let releaseRefresh = () => {};
  const refresh = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  let mine: Array<
    EvaluationTarget & { score: number; comment: string; version: number }
  > = [];
  rpc.mockImplementation((name, params) => {
    if (name === "course_evaluations") {
      return {
        abortSignal: async () => {
          if (++reads > 1) await refresh;
          return result({
            completed: true,
            writable: true,
            targets: [instructor],
            mine,
            summaries: [],
          });
        },
      };
    }
    const saved = {
      ...instructor,
      score: params.p_score,
      comment: params.p_comment.trim(),
      version: params.p_expected_version + 1,
    };
    mine = [saved];
    return Promise.resolve(result(saved));
  });
  const user = userEvent.setup();
  renderEvaluations();
  try {
    await user.selectOptions(await screen.findByLabelText("Score"), "4");
    await user.click(screen.getByRole("button", { name: "Save evaluation" }));
    expect(await screen.findByText("Evaluation saved.")).toBeVisible();
    expect(reads).toBeGreaterThan(1);
    await user.selectOptions(screen.getByLabelText("Score"), "5");
    await user.click(screen.getByRole("button", { name: "Save evaluation" }));
    expect(await screen.findByText("Evaluation saved.")).toBeVisible();
    expect(rpc).toHaveBeenCalledWith(
      "save_course_evaluation",
      expect.objectContaining({ p_score: 5, p_expected_version: 1 }),
    );
  } finally {
    releaseRefresh();
  }
});

it("requires reloading a changed evaluation before another write", async () => {
  const current = {
    ...instructor,
    score: 3,
    comment: "Changed elsewhere",
    version: 4,
  };
  let revision = { ...current, score: 2, comment: "Original", version: 3 };
  rpc.mockImplementation((name: string) => {
    if (name === "course_evaluations")
      return {
        abortSignal: async () =>
          result({
            completed: true,
            writable: true,
            targets: [instructor],
            mine: [revision],
            summaries: [],
          }),
      };
    revision = current;
    return Promise.resolve({ error: { code: "PT409" }, data: null });
  });
  const user = userEvent.setup();
  renderEvaluations();
  await user.click(
    await screen.findByRole("button", { name: "Save evaluation" }),
  );
  expect(await screen.findByText(/This evaluation changed/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Save evaluation" }),
  ).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Reload current evaluation" }),
  );
  expect(await screen.findByDisplayValue("Changed elsewhere")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save evaluation" })).toBeEnabled();
});
