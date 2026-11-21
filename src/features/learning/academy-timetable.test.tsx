import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { AcademyTimetable } from "./academy-timetable";
import {
  academyTimetableRequestSchema,
  academyTimetableSchema,
} from "./academy-timetable-schema";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));

const session = {
  session_id: "c23c5015-398f-4d6a-9dd2-f7bb1d8b27ca",
  course_run_id: "68871423-fc38-4b89-b17e-b54ac8b56f69",
  course_title: "Fictional time zone workshop",
  starts_at: "2030-10-27T00:30:00Z",
  ends_at: "2030-10-27T01:30:00Z",
  time_zone: "Europe/Berlin",
  local_day: "2030-10-27",
  venue: "Fictional classroom",
  delivery_type: "onsite",
};

function view() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <AcademyTimetable actor="fictional-actor" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function result(data: unknown) {
  const response = Promise.resolve({ data, error: null });
  return { abortSignal: () => response };
}

beforeEach(async () => {
  vi.setSystemTime(new Date("2030-10-27T12:00:00Z"));
  await i18n.changeLanguage("en");
  rpc
    .mockReset()
    .mockImplementation(() => result({ rows: [session], next: null }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("shows the confirmed course with both actual offsets when a local hour repeats", async () => {
  view();
  expect(
    await screen.findByRole("link", { name: session.course_title }),
  ).toHaveAttribute(
    "href",
    `/courses/${session.course_run_id}/workspace#course-overview`,
  );
  expect(screen.getByText(/GMT\+2/)).toHaveAttribute(
    "datetime",
    session.starts_at,
  );
  expect(screen.getByText(/GMT\+1/)).toHaveAttribute(
    "datetime",
    session.ends_at,
  );
  expect(
    screen.getByRole("heading", { name: /October 27, 2030/ }),
  ).toBeVisible();
  expect(rpc).toHaveBeenCalledWith("academy_timetable", {
    p_from: "2030-10-27",
    p_until: "2030-11-02",
  });
});

it("shows the current viewer's German date and schedule labels", async () => {
  await i18n.changeLanguage("de");
  view();
  expect(
    await screen.findByRole("heading", { name: /27. Oktober 2030/ }),
  ).toBeVisible();
  expect(screen.getByText("Beginn")).toBeVisible();
  expect(screen.getByText(/Vor Ort.*Fictional classroom/)).toBeVisible();
});

it("rejects an invalid date range locally and resets pages when moving to the next dates", async () => {
  const user = userEvent.setup();
  view();
  await screen.findByRole("link", { name: session.course_title });
  fireEvent.change(screen.getByLabelText("Through"), {
    target: { value: "2030-12-05" },
  });
  await user.click(screen.getByRole("button", { name: "Show dates" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Choose a date range of 1 to 31 days.",
  );
  expect(rpc).toHaveBeenCalledTimes(1);

  rpc.mockImplementation(() => result({ rows: [], next: null }));
  await user.click(screen.getByRole("button", { name: "Next dates" }));
  expect(
    await screen.findByText("There are no course sessions in this date range."),
  ).toBeVisible();
  expect(screen.queryByRole("link", { name: session.course_title })).toBeNull();
  expect(rpc).toHaveBeenLastCalledWith("academy_timetable", {
    p_from: "2030-11-03",
    p_until: "2030-11-09",
  });
});

it("loads a second reviewed cursor page using the dates of the existing timetable", async () => {
  rpc.mockImplementationOnce(() =>
    result({
      rows: [session],
      next: { start: session.starts_at, id: session.session_id },
    }),
  );
  rpc.mockImplementationOnce(() =>
    result({
      rows: [
        {
          ...session,
          session_id: "c23c5015-398f-4d6a-9dd2-f7bb1d8b27cb",
          course_title: "Fictional second session",
        },
      ],
      next: null,
    }),
  );
  view();
  await userEvent.click(
    await screen.findByRole("button", { name: "Load more sessions" }),
  );
  expect(
    await screen.findByRole("link", { name: "Fictional second session" }),
  ).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("2 sessions displayed");
  expect(rpc).toHaveBeenLastCalledWith("academy_timetable", {
    p_from: "2030-10-27",
    p_until: "2030-11-02",
    p_after_start: session.starts_at,
    p_after_id: session.session_id,
  });
});

it("accepts 31 days and closes both the row shape and cursor pair", () => {
  const request = { p_from: "2030-10-01", p_until: "2030-10-31" };
  expect(academyTimetableRequestSchema.safeParse(request).success).toBe(true);
  expect(
    academyTimetableRequestSchema.safeParse({
      ...request,
      p_until: "2030-11-01",
    }).success,
  ).toBe(false);
  expect(
    academyTimetableRequestSchema.safeParse({
      ...request,
      p_after_id: session.session_id,
    }).success,
  ).toBe(false);
  expect(
    academyTimetableSchema.safeParse({
      rows: [{ ...session, staff_note: "Fictional private note" }],
      next: null,
    }).success,
  ).toBe(false);
});
