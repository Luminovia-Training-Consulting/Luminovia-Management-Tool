import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
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
  saveBatch: vi.fn(),
  attach: vi.fn(),
  upload: vi.fn(),
  uploadAcademy: vi.fn(),
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
    evidence: [] as {
      id: string;
      resource_id: string | null;
      version_id: string;
      name: string;
      attached_at: string;
    }[],
    history: [],
  },
}));
vi.mock("./attendance-api", () => ({
  attendanceRegisterKey: (...parts: string[]) => [
    "attendance-register",
    ...parts,
  ],
  attendanceRegisterQuery: (actor: string, run: string, session: string) => ({
    queryKey: ["attendance-register", actor, run, session],
    queryFn: async () => fake.register,
  }),
  saveAttendance: fake.save,
  saveAttendanceBatch: fake.saveBatch,
  attachAttendancePdf: fake.attach,
}));
vi.mock("../files/api", () => ({
  uploadDocument: fake.upload,
  uploadAcademyAttendancePdf: fake.uploadAcademy,
}));
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
  fake.register.rows.splice(1);
  fake.register.rows[0].name = "Fictional Learner";
  fake.register.rows[0].status = null;
  fake.register.rows[0].note = "";
  fake.register.rows[0].version = 0;
  fake.register.evidence = [];
  fake.save
    .mockReset()
    .mockResolvedValue({ status: "present", version: 1, minutes: 60 });
  fake.saveBatch.mockReset().mockResolvedValue(1);
  fake.attach.mockReset().mockResolvedValue({
    id: "evidence",
    resource_id: "resource",
    version_id: "version",
  });
  fake.upload
    .mockReset()
    .mockResolvedValue({ status: "clean", current_version_id: "version" });
  fake.uploadAcademy
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

it("filters the visible session roster without changing the status totals or discarding a draft", async () => {
  fake.register.rows.push({
    ...fake.register.rows[0],
    user_id: "marked",
    name: "Fictional Marked",
    status: "excused",
    version: 1,
  });
  view();
  const user = userEvent.setup();
  const totals = await screen.findByRole("list", { name: "attendanceCounts" });
  expect(within(totals).getByText("attendanceunmarked: 1")).toBeVisible();
  expect(within(totals).getByText("attendanceexcused: 1")).toBeVisible();
  const note = within(
    screen.getByRole("heading", { name: "Fictional Learner" }).closest("li")!,
  ).getByLabelText("attendanceNote");
  await user.type(note, "Unsaved note");
  const filter = screen.getByLabelText("attendanceFilterStatus");
  await user.selectOptions(filter, "excused");
  expect(
    screen.queryByRole("heading", { name: "Fictional Learner" }),
  ).toBeNull();
  expect(
    screen.getByRole("heading", { name: "Fictional Marked" }),
  ).toBeVisible();
  expect(within(totals).getByText("attendanceunmarked: 1")).toBeVisible();
  await user.selectOptions(filter, "all");
  expect(note).toBeVisible();
  expect(note).toHaveValue("Unsaved note");
  await user.type(screen.getByLabelText("attendanceFilterName"), "MARKED");
  expect(
    screen.queryByRole("heading", { name: "Fictional Learner" }),
  ).toBeNull();
  expect(
    screen.getByRole("heading", { name: "Fictional Marked" }),
  ).toBeVisible();
  expect(fake.save).not.toHaveBeenCalled();
});

it("reviews and commits only the visible unmarked rows which have no existing attendance entry", async () => {
  fake.register.rows.push(
    {
      ...fake.register.rows[0],
      user_id: "reported",
      name: "Fictional Learner reported",
      version: 2,
    },
    {
      ...fake.register.rows[0],
      user_id: "already-marked",
      name: "Fictional Learner present",
      status: "present",
      version: 1,
    },
    {
      ...fake.register.rows[0],
      user_id: "filtered-out",
      name: "Another participant",
    },
  );
  fake.saveBatch.mockImplementation(async () => {
    fake.register = {
      ...fake.register,
      rows: [
        { ...fake.register.rows[0], status: "excused", version: 1 },
        ...fake.register.rows.slice(1),
      ],
    };
    return 1;
  });
  view();
  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText("attendanceFilterName"),
    "learner",
  );
  const filter = screen.getByLabelText("attendanceFilterStatus");
  await user.selectOptions(filter, "unmarked");
  await user.selectOptions(
    screen.getByLabelText("attendanceBulkStatus"),
    "excused",
  );
  const review = () =>
    user.click(screen.getByRole("button", { name: "attendanceBulkReview" }));
  await review();
  let dialog = within(
    screen.getByRole("dialog", { name: "attendanceBulkReview" }),
  );
  expect(dialog.getByText("Fictional Learner", { exact: true })).toBeVisible();
  expect(dialog.queryByText("Fictional Learner reported")).toBeNull();
  expect(dialog.queryByText("Fictional Learner present")).toBeNull();
  expect(dialog.queryByText("Another participant")).toBeNull();
  await user.click(dialog.getByRole("button", { name: "enrolmentCancel" }));
  expect(fake.saveBatch).not.toHaveBeenCalled();
  await review();
  dialog = within(screen.getByRole("dialog", { name: "attendanceBulkReview" }));
  await user.click(
    dialog.getByRole("button", { name: "attendanceImportConfirm" }),
  );
  expect(await screen.findByText("attendanceImportSaved")).toBeVisible();
  expect(fake.saveBatch).toHaveBeenCalledExactlyOnceWith("run", "session", [
    {
      user_id: "learner",
      status: "excused",
      arrival_at: null,
      departure_at: null,
      note: "",
      reason: "",
      expected_version: 0,
    },
  ]);
  expect(
    within(screen.getByRole("list", { name: "attendanceCounts" })).getByText(
      "attendanceexcused: 1",
    ),
  ).toBeVisible();
  expect(filter).toHaveFocus();
});

it("refreshes the register after a bulk version conflict without claiming success", async () => {
  fake.saveBatch.mockRejectedValue({ code: "PT409" });
  view();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "attendanceBulkReview" }),
  );
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "attendanceImportConfirm",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "attendanceBulkChanged",
  );
  expect(screen.queryByText("attendanceImportSaved")).toBeNull();
  expect(fake.saveBatch).toHaveBeenCalledTimes(1);
});

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
  expect(screen.getByLabelText("attendancePdfLabel")).toBeVisible();
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
  expect(
    screen.queryByRole("button", { name: "attendanceBulkReview" }),
  ).toBeNull();
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

it.each([undefined, "active"] as const)(
  "does not offer %s register changes before the session starts",
  async (academy) => {
    fake.register.starts_at = new Date(Date.now() + 3_600_000).toISOString();
    view(course, academy);
    expect(await screen.findByText("Fictional Learner")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "attendancepresent" }),
    ).toBeNull();
    expect(screen.queryByText("attendanceImport")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "attendanceBulkReview" }),
    ).toBeNull();
  },
);

it("refreshes an open internal register when the session starts", async () => {
  vi.useFakeTimers();
  try {
    fake.register.starts_at = new Date(Date.now() + 30_000).toISOString();
    view();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByText("Fictional Learner")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "attendancepresent" }),
    ).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_010);
    });
    expect(
      screen.getByRole("button", { name: "attendancepresent" }),
    ).toBeVisible();
  } finally {
    cleanup();
    vi.useRealTimers();
  }
});

it.each(["csv", "pdf"] as const)(
  "exports the exact internal register as %s",
  async (format) => {
    view();
    await userEvent.click(
      await screen.findByRole("button", {
        name: format === "csv" ? "attendanceExportCsv" : "attendanceExportPdf",
      }),
    );
    expect(fake.export).toHaveBeenCalledWith(
      { kind: "attendance_session", id: "session", format },
      expect.stringMatching(
        `^attendance-\\d{4}-\\d{2}-\\d{2}-session\\.${format}$`,
      ),
    );
  },
);

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

it("retries attaching the scanner-confirmed academy PDF to its exact session without reupload", async () => {
  const user = userEvent.setup();
  fake.attach
    .mockRejectedValueOnce(new Error("temporary"))
    .mockResolvedValueOnce({
      id: "attendance-evidence",
      resource_id: null,
      version_id: "version",
    });
  view(course, "active");
  const pdf = new File(["%PDF-1.7 fictional"], "Fictional roll call.pdf", {
    type: "application/pdf",
  });
  await user.upload(await screen.findByLabelText("attendancePdfLabel"), pdf);
  await user.click(screen.getByRole("button", { name: "attendanceAttachPdf" }));
  expect(await screen.findByText("attendancePdfFailed")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "attendanceAttachPdf" }));
  await waitFor(() =>
    expect(fake.attach.mock.calls).toEqual([
      ["run", "session", "version"],
      ["run", "session", "version"],
    ]),
  );
  expect(fake.uploadAcademy).toHaveBeenCalledExactlyOnceWith(
    pdf,
    "session",
    expect.any(String),
  );
  expect(fake.upload).not.toHaveBeenCalled();
});

it("reads exact academy evidence in grace without offering file writes", async () => {
  const user = userEvent.setup();
  fake.register.evidence = [
    {
      id: "attendance-evidence",
      resource_id: null,
      version_id: "version",
      name: "Scanned roll call.pdf",
      attached_at: "2026-11-20T09:00:00Z",
    },
  ];
  view(course, "grace");
  expect(await screen.findByText(/Scanned roll call.pdf/)).toBeVisible();
  expect(screen.queryByLabelText("attendancePdfLabel")).toBeNull();
  await user.click(screen.getByRole("button", { name: "download" }));
  expect(fake.export).toHaveBeenCalledExactlyOnceWith(
    { kind: "attendance_evidence", id: "attendance-evidence" },
    "Scanned roll call.pdf",
  );
  expect(fake.download).not.toHaveBeenCalled();
});
