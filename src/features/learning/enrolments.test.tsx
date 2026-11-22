/** Component regressions for live course enrolment commands and own withdrawal. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import type { CourseWorkspace } from "./api";
import { AttendancePanel } from "./attendance";
import { CourseEnrolmentsPanel, CourseWithdrawal } from "./enrolments";
import "./i18n";

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
  user_id: "43d83f70-e5cf-4f28-bf0b-65e9781dfd10",
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
function view(
  component: ReactNode,
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
) {
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
    const session = {
      id: "9f9a92be-1b47-4b25-bf7a-c3aec254376a",
      starts_at: "2025-01-02T09:00:00Z",
      ends_at: "2025-01-02T11:00:00Z",
      attendance: null,
      minutes: null,
      version: 0,
      can_check_in: false,
      can_verify: false,
    };
    const scheduledCourse = { ...course, sessions: [session] };
    rpc.mockImplementation((name: string) => {
      if (name === "course_enrolments") return reply(roster);
      if (name === "course_enrolment_candidates")
        return reply(roster.length ? [] : [participant]);
      if (name === "course_session_register")
        return reply({
          session_id: session.id,
          starts_at: session.starts_at,
          ends_at: session.ends_at,
          time_zone: course.time_zone,
          rows: roster.map(({ user_id, display_name }) => ({
            user_id,
            name: display_name,
            status: null,
            note: "",
            arrival_at: null,
            departure_at: null,
            version: 0,
          })),
          evidence: [],
          history: [],
        });
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
    view(
      <>
        <CourseEnrolmentsPanel course={scheduledCourse} actor="company" />
        <AttendancePanel course={scheduledCourse} actor="company" />
      </>,
    );
    expect(await screen.findByText("No enrolled participants.")).toBeVisible();
    const user = userEvent.setup();
    const management = within(
      screen.getByRole("region", { name: "Manage course enrolments" }),
    );
    await user.type(management.getByRole("searchbox"), "Fictional");
    await user.click(management.getByRole("button", { name: "Search" }));
    expect(rpc).toHaveBeenCalledWith("course_enrolment_candidates", {
      p_course_run_id: course.id,
      p_search: "Fictional",
    });
    await user.selectOptions(
      await management.findByRole("combobox"),
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
    expect(
      await screen.findByText("Import attendance from CSV or XLSX"),
    ).toBeVisible();
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
              user_id: participant.user_id,
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

describe("Standalone learner withdrawal", () => {
  const window = {
    deadline_at: "2039-10-24T13:00:00+02:00",
    can_withdraw: true,
  };

  it("keeps the deadline visible during grace and hides the write control", async () => {
    rpc.mockReturnValue(reply(window));
    view(
      <CourseWithdrawal
        course={learnerCourse}
        actor="learner"
        academy="grace"
      />,
    );
    expect(await screen.findByText(/Withdraw by/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Withdraw from course" }),
    ).toBeNull();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("course_withdrawal_window", {
      p_course_run_id: course.id,
    });
  });

  it("purges only confirmed course access and its actor's timetable", async () => {
    const cache = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const privateKeys = [
      ["course-workspace", "learner", course.id],
      ["course-workspace-entitlement", "learner", course.id],
      ["course-welcome", "learner", course.id],
      ["course-chat-messages", "learner", course.id, "room"],
      ["academy-timetable", "learner", "2039-10-27", "2039-11-02"],
    ];
    for (const key of privateKeys)
      cache.setQueryData(key, ["Fictional protected data"]);
    const otherCourse = ["course-workspace", "learner", "other-course"];
    cache.setQueryData(otherCourse, ["Fictional accessible data"]);
    cache.setQueryData(
      ["course-workspaces", "learner"],
      [{ id: course.id }, { id: "other-course" }],
    );
    let confirm!: (value: { data: null; error: null }) => void;
    const pending = new Promise<{ data: null; error: null }>((resolve) => {
      confirm = resolve;
    });
    rpc.mockImplementation((name: string) =>
      name === "course_withdrawal_window" ? reply(window) : pending,
    );
    const user = userEvent.setup();
    view(
      <CourseWithdrawal
        course={learnerCourse}
        actor="learner"
        academy="active"
      />,
      cache,
    );
    await user.click(
      await screen.findByRole("button", { name: "Withdraw from course" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm",
      }),
    );
    expect(screen.queryByRole("heading", { name: "My courses" })).toBeNull();
    for (const key of privateKeys)
      expect(cache.getQueryData(key)).toBeDefined();
    confirm({ data: null, error: null });
    expect(
      await screen.findByRole("heading", { name: "My courses" }),
    ).toBeVisible();
    for (const key of privateKeys)
      expect(cache.getQueryData(key)).toBeUndefined();
    expect(cache.getQueryData(otherCourse)).toEqual([
      "Fictional accessible data",
    ]);
    expect(cache.getQueryData(["course-workspaces", "learner"])).toEqual([
      { id: "other-course" },
    ]);
  });

  it("keeps the workspace after deadline refusal and refreshes the confirmed window", async () => {
    let expired = false;
    rpc.mockImplementation((name: string) => {
      if (name === "course_withdrawal_window")
        return reply({ ...window, can_withdraw: !expired });
      expired = true;
      return reply(null, { code: "22023" });
    });
    view(
      <CourseWithdrawal
        course={learnerCourse}
        actor="learner"
        academy="active"
      />,
    );
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Withdraw from course" }),
    );
    const confirm = within(screen.getByRole("dialog")).getByRole("button", {
      name: "Confirm",
    });
    await user.click(confirm);
    expect(
      await screen.findByText(/withdrawal was not confirmed/),
    ).toBeVisible();
    expect(confirm).toBeDisabled();
    expect(screen.queryByRole("heading", { name: "My courses" })).toBeNull();
  });
});
