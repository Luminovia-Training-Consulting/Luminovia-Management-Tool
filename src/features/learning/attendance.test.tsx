import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AttendancePanel } from "./attendance";
import type { AttendanceStatus } from "./attendance-api";
import type { CourseWorkspace } from "./api";

const fake = vi.hoisted(() => ({
  save: vi.fn(),
  attach: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  export: vi.fn(),
  register: {
    session_id: "session",
    starts_at: "2026-11-20T09:00:00Z",
    ends_at: "2026-11-20T10:00:00Z",
    time_zone: "Europe/Berlin",
    rows: [
      {
        user_id: "learner",
        name: "Fictional Learner",
        status: null as AttendanceStatus | null,
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
vi.mock("./api", () => ({
  downloadCourseDocument: fake.download,
  downloadPortalDocument: fake.export,
}));
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
const view = (value = course, academy?: "active" | "grace") =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AttendancePanel course={value} actor="teacher" academy={academy} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  fake.register.starts_at = new Date(Date.now() - 3_600_000).toISOString();
  fake.register.rows[0].name = "Fictional Learner";
  fake.register.rows[0].status = null;
  fake.register.rows[0].note = "";
  fake.register.rows[0].version = 0;
  fake.save
    .mockReset()
    .mockResolvedValue({ status: "present", version: 1, minutes: 60 });
  fake.attach.mockReset().mockResolvedValue({
    id: "evidence",
    resource_id: "resource",
    version_id: "version",
  });
  fake.upload
    .mockReset()
    .mockResolvedValue({ status: "clean", current_version_id: "version" });
  fake.download.mockReset().mockResolvedValue(undefined);
  fake.export.mockReset().mockResolvedValue(undefined);
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

it("announces the confirmed status and keeps keyboard focus on the participant's register row", async () => {
  fake.save.mockImplementation(async () => {
    fake.register = {
      ...fake.register,
      rows: [{ ...fake.register.rows[0], status: "present", version: 1 }],
    };
    return { status: "present", version: 1, minutes: 60 };
  });
  view(course, "active");
  const heading = await screen.findByRole("heading", {
    name: "Fictional Learner",
  });
  const actions = within(
    screen.getByRole("group", { name: "Fictional Learner" }),
  );
  actions.getByRole("button", { name: "attendancepresent" }).focus();
  await userEvent.keyboard("{Enter}");

  await waitFor(() => expect(heading).toHaveFocus());
  expect(screen.getByRole("status")).toHaveTextContent(
    "attendanceCurrent: attendancepresent",
  );
  expect(screen.getByLabelText("attendanceCorrectionReason")).toHaveValue("");
});

it("labels an enrolled participant whose displayed name is unavailable", async () => {
  fake.register.rows[0].name = " ";
  view(course, "active");
  expect(
    await screen.findByRole("heading", {
      name: "attendanceUnnamedParticipant",
    }),
  ).toBeVisible();
  expect(
    screen.getByRole("group", { name: "attendanceUnnamedParticipant" }),
  ).toBeVisible();
});

it("allows only confirmed manual academy edits and blocks repeat submissions after a version conflict", async () => {
  fake.save.mockRejectedValue({ code: "PT409", message: "Attendance changed" });
  view(course, "active");
  expect(await screen.findByText("Fictional Learner")).toBeVisible();
  expect(screen.queryByLabelText("attendancePdfLabel")).toBeNull();
  expect(screen.getByText("attendanceImport")).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "attendancepresent" }),
  );
  expect(await screen.findByText("attendanceChanged")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "attendancepresent" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "refresh" })).toBeVisible();
  expect(fake.save).toHaveBeenCalledExactlyOnceWith(
    "run",
    "session",
    expect.objectContaining({ user_id: "learner", version: 0 }),
    "present",
    null,
    null,
    "",
    "",
  );
});

it("renders the register and its notes without academy writes during grace", async () => {
  fake.register.rows[0].status = "excused";
  fake.register.rows[0].note = "Fictional retained note";
  view(course, "grace");
  expect(await screen.findByText("Fictional Learner")).toBeVisible();
  expect(screen.getByText(/Fictional retained note/)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "attendancepresent" }),
  ).toBeNull();
  expect(screen.queryByText("attendanceImport")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(document.querySelector('input[type="file"]')).toBeNull();
  expect(fake.save).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "attendanceExportCsv" }),
  );
  await waitFor(() =>
    expect(fake.export).toHaveBeenCalledWith(
      { kind: "attendance", id: "session", format: "csv" },
      expect.stringMatching(/^attendance-\d{4}-\d{2}-\d{2}-session\.csv$/),
    ),
  );
});

it("requests a protected PDF for the selected register and reports a denied download", async () => {
  fake.export.mockRejectedValue(new Error("course_document_unavailable"));
  view(course, "active");
  await userEvent.click(
    await screen.findByRole("button", { name: "attendanceExportPdf" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "attendanceExportFailed",
  );
  expect(fake.export).toHaveBeenCalledWith(
    { kind: "attendance", id: "session", format: "pdf" },
    expect.stringMatching(/^attendance-\d{4}-\d{2}-\d{2}-session\.pdf$/),
  );
});

it("does not offer dedicated register changes before the session starts", async () => {
  fake.register.starts_at = new Date(Date.now() + 3_600_000).toISOString();
  view(course, "active");
  expect(await screen.findByText("Fictional Learner")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "attendancepresent" }),
  ).toBeNull();
  expect(screen.queryByText("attendanceImport")).toBeNull();
});

it("excludes participant-only viewers from the register", () => {
  view({
    ...course,
    access: { ...course.access, teacher: false, staff: false, learner: true },
  });
  expect(screen.queryByLabelText("sessionRegister")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "attendanceExportPdf" }),
  ).toBeNull();
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
