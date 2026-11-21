import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AttendancePanel } from "./attendance";
import type { CourseWorkspace } from "./api";

const fake = vi.hoisted(() => ({
  save: vi.fn(),
  attach: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  register: {
    session_id: "session",
    starts_at: "2026-11-20T09:00:00Z",
    ends_at: "2026-11-20T10:00:00Z",
    time_zone: "Europe/Berlin",
    rows: [
      {
        user_id: "learner",
        name: "Fictional Learner",
        status: null,
        arrival_at: null,
        departure_at: null,
        note: "",
        version: 0,
      },
    ],
    evidence: [],
    history: [],
  },
}));
vi.mock("./attendance-api", () => ({
  attendanceRegisterKey: (...parts: string[]) => [
    "attendance-register",
    ...parts,
  ],
  attendanceRegisterQuery: (...parts: string[]) => ({
    queryKey: ["attendance-register", ...parts],
    queryFn: async () => fake.register,
  }),
  saveAttendance: fake.save,
  attachAttendancePdf: fake.attach,
}));
vi.mock("../files/api", () => ({ uploadDocument: fake.upload }));
vi.mock("./api", () => ({ downloadCourseDocument: fake.download }));
vi.mock("../../lib/online", () => ({ useOnline: () => true }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

const course = {
  id: "run",
  time_zone: "Europe/Berlin",
  lms_enabled: true,
  access: {
    manager: false,
    teacher: true,
    client: false,
    learner: false,
    staff: true,
    lms_enabled: true,
  },
  sessions: [
    {
      id: "session",
      starts_at: "2026-11-20T09:00:00Z",
      ends_at: "2026-11-20T10:00:00Z",
    },
  ],
} as CourseWorkspace;
const view = (value = course) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AttendancePanel course={value} actor="teacher" />
    </QueryClientProvider>,
  );

beforeEach(() => {
  fake.register.rows[0].version = 0;
  fake.save
    .mockReset()
    .mockResolvedValue({ status: "present", version: 1, minutes: 60 });
  fake.attach
    .mockReset()
    .mockResolvedValue({
      id: "evidence",
      resource_id: "resource",
      version_id: "version",
    });
  fake.upload
    .mockReset()
    .mockResolvedValue({ status: "clean", current_version_id: "version" });
  fake.download.mockReset().mockResolvedValue(undefined);
});
it("requires a correction reason and interprets arrival in the course time zone", async () => {
  fake.register.rows[0].version = 2;
  view();
  expect(await screen.findByText("Fictional Learner")).toBeInTheDocument();
  const button = screen.getByRole("button", { name: "attendancepresent" });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText("arrivalTime"), {
    target: { value: "2026-11-20T10:15" },
  });
  await userEvent.type(
    screen.getByLabelText("attendanceCorrectionReason"),
    "Late arrival",
  );
  await userEvent.click(button);
  await waitFor(() =>
    expect(fake.save).toHaveBeenCalledWith(
      "run",
      "session",
      expect.objectContaining({ version: 2 }),
      "present",
      "2026-11-20T09:15:00.000Z",
      null,
      "",
      "Late arrival",
    ),
  );
});
afterEach(cleanup);

it("excludes participant-only viewers from the register", () => {
  view({
    ...course,
    access: { ...course.access, teacher: false, staff: false, learner: true },
  });
  expect(screen.queryByLabelText("sessionRegister")).not.toBeInTheDocument();
});
it("marks an enrolled learner in one click and confirms the API response", async () => {
  view();
  expect(await screen.findByText("Fictional Learner")).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "attendancepresent" }),
  );
  await waitFor(() =>
    expect(fake.save).toHaveBeenCalledWith(
      "run",
      "session",
      expect.objectContaining({ user_id: "learner", version: 0 }),
      "present",
      null,
      null,
      "",
      "",
    ),
  );
});
it("uploads a PDF through the checked file path before attaching its exact version", async () => {
  view();
  await screen.findByText("Fictional Learner");
  const file = new File(["%PDF-1.7 fictional"], "roster.pdf", {
    type: "application/pdf",
  });
  await userEvent.upload(screen.getByLabelText("attendancePdfLabel"), file);
  await userEvent.click(
    screen.getByRole("button", { name: "attendanceAttachPdf" }),
  );
  await waitFor(() =>
    expect(fake.upload).toHaveBeenCalledWith(file, {
      scope: "personal",
      kind: "material",
    }),
  );
  expect(fake.attach).toHaveBeenCalledWith("run", "session", "version");
});

it("requires an unambiguous local attendance time on a daylight saving transition", async () => {
  view();
  await screen.findByText("Fictional Learner");
  const input = screen.getByLabelText("arrivalTime");
  const button = screen.getByRole("button", { name: "attendancepresent" });
  for (const value of ["2026-03-29T02:25", "2026-10-25T02:25"]) {
    fireEvent.change(input, { target: { value } });
    await userEvent.click(button);
    expect(await screen.findByText("attendanceInvalidTime")).toBeVisible();
  }
  expect(fake.save).not.toHaveBeenCalled();
});
