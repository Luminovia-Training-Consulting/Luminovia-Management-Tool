/** Component regressions for live course enrolment commands and own withdrawal. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import type { CourseWorkspace } from "./api";
import { CourseEnrolmentsPanel, CourseWithdrawal } from "./enrolments";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));

const course = {
  id: "course-a",
  title: "Fictional astronomy workshop",
  time_zone: "Europe/Berlin",
  lms_enabled: true,
  ended: false,
  access: { manager: false, client: true, learner: false },
} as CourseWorkspace;
const participant = {
  user_id: "approved",
  display_name: "Fictional approved learner",
  luminovia_user_id: "LU-FICTIONAL",
};
const learnerCourse = {
  ...course,
  access: { ...course.access, learner: true, client: false },
};

/** The SDK's read builder accepts an AbortSignal and is also awaitable for writes. */
function reply(data: unknown, error?: unknown) {
  const result = Promise.resolve({ data, error });
  return Object.assign(result, { abortSignal: () => result });
}

/** Mount the actual role-specific workspace controls and withdrawal destination. */
function view(component: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/courses/course-a/workspace"]}>
        <Routes>
          <Route path="/courses/:course/workspace" element={component} />
          <Route path="/learning" element={<h1>My courses</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

beforeEach(async () => {
  await i18n.changeLanguage("en");
  rpc.mockReset();
});

describe("Premium course enrolment management", () => {
  it("searches accepted associations and waits for a confirmed enrolment", async () => {
    let roster: Record<string, string>[] = [];
    rpc.mockImplementation((name: string) => {
      if (name === "course_enrolments") return reply(roster);
      if (name === "course_enrolment_candidates")
        return reply(roster.length ? [] : [participant]);
      if (name === "manage_course_enrolment") {
        roster = [
          {
            user_id: participant.user_id,
            display_name: participant.display_name,
            status: "enrolled",
          },
        ];
        return reply(null);
      }
      throw new Error("Unexpected RPC " + name);
    });
    view(<CourseEnrolmentsPanel course={course} actor="company" />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox"), "Fictional");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(rpc).toHaveBeenCalledWith("course_enrolment_candidates", {
      p_course_run_id: course.id,
      p_search: "Fictional",
    });
    await user.selectOptions(
      await screen.findByRole("combobox"),
      participant.user_id,
    );
    await user.click(
      screen.getByRole("button", { name: "Enrol in this course" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleDescription(/Fictional approved learner/);
    expect(rpc).not.toHaveBeenCalledWith(
      "manage_course_enrolment",
      expect.anything(),
    );
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Enrolled")).toBeVisible();
    expect(rpc).toHaveBeenCalledWith("manage_course_enrolment", {
      p_course_run_id: course.id,
      p_user_id: participant.user_id,
      p_status: "enrolled",
    });
    expect(
      screen.queryByRole("button", { name: "Record completion" }),
    ).not.toBeInTheDocument();
  });

  it("does not give learners roster controls or load another participant's records", () => {
    view(<CourseEnrolmentsPanel course={learnerCourse} actor="learner" />);
    expect(
      screen.queryByRole("heading", { name: "Manage course enrolments" }),
    ).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps the current roster after a refused removal", async () => {
    rpc.mockImplementation((name: string) =>
      name === "course_enrolments"
        ? reply([
            {
              user_id: "approved",
              display_name: participant.display_name,
              status: "enrolled",
            },
          ])
        : name === "course_enrolment_candidates"
          ? reply([])
          : reply(null, { code: "42501" }),
    );
    view(<CourseEnrolmentsPanel course={course} actor="company" />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: /Remove course enrolment for Fictional approved learner/,
      }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm",
      }),
    );
    expect(await screen.findByText(/change was not confirmed/)).toBeVisible();
    expect(screen.getByText("Enrolled")).toBeInTheDocument();
    expect(screen.queryByText("Course enrolment updated.")).toBeNull();
  });
});

describe("Premium participant withdrawal", () => {
  it("hides the action when the server says the deadline passed", async () => {
    rpc.mockReturnValue(
      reply({ deadline_at: "2026-09-22T12:15:00+02:00", can_withdraw: false }),
    );
    view(<CourseWithdrawal course={learnerCourse} actor="learner" />);
    expect(await screen.findByText(/Withdraw by/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Withdraw from course" }),
    ).toBeNull();
  });

  it("returns to My courses only after an explicit and successful withdrawal", async () => {
    rpc.mockImplementation((name: string) =>
      name === "course_withdrawal_window"
        ? reply({
            deadline_at: "2026-10-24T13:00:00+02:00",
            can_withdraw: true,
          })
        : reply(null),
    );
    view(<CourseWithdrawal course={learnerCourse} actor="learner" />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Withdraw from course" }),
    );
    expect(rpc).not.toHaveBeenCalledWith(
      "cancel_own_course_enrolment",
      expect.anything(),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm",
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "My courses" }),
    ).toBeVisible();
    expect(rpc).toHaveBeenCalledWith("cancel_own_course_enrolment", {
      p_course_run_id: course.id,
    });
  });
});
