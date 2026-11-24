import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { CourseCloseout } from "./course-closeout";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../../lib/online", () => ({
  useOnline: () => true,
  requireOnline: () => {},
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
afterEach(() => {
  cleanup();
  rpc.mockReset();
});

it("requires assignments for all open categories and uses the reviewed evidence token once", async () => {
  const [run, actor, learner, task] = Array.from({ length: 4 }, () =>
    crypto.randomUUID(),
  );
  const token = "e".repeat(32);
  const review = {
    can_close: true,
    review_token: token,
    items: [
      {
        kind: "grade",
        person_id: learner,
        person: "Fictional learner",
        session_id: null,
        session_start: null,
      },
    ],
    staff: [{ id: actor, name: "Fictional manager" }],
    confirmed_at: null,
    followups: {},
  };
  rpc.mockImplementation((name) =>
    name === "course_closeout"
      ? {
          abortSignal: () => Promise.resolve({ data: review, error: null }),
        }
      : Promise.resolve({
          error: null,
          data: {
            ...review,
            confirmed_at: "2026-11-24T02:00:00Z",
            followups: {
              grade: {
                task_id: task,
                state: "open",
                name: "Fictional manager",
              },
            },
          },
        }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CourseCloseout run={run} actor={actor} zone="Europe/Berlin" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const confirm = await screen.findByRole("button", {
    name: "Confirm course closeout",
  });
  expect(confirm).toBeDisabled();
  expect(screen.getByText("Fictional learner")).toBeVisible();
  fireEvent.change(
    screen.getByLabelText("Responsible person · Missing assessment results"),
    {
      target: { value: actor },
    },
  );
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith("confirm_course_closeout", {
      p_course_run_id: run,
      p_review_token: token,
      p_assignees: { grade: actor },
    }),
  );
  expect(
    await screen.findByRole("link", { name: "Fictional manager · Open" }),
  ).toHaveAttribute("href", "/workbench?task=" + task);
  expect(confirm).not.toBeInTheDocument();
});
