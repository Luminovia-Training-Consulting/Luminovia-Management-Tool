import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CourseExams } from "./exams";
import type { CourseWorkspace } from "./api";
import i18n from "../../lib/i18n";

const fake = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  uploadExam: vi.fn(),
  uploadAnswer: vi.fn(),
  download: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
vi.mock("../../lib/online", () => ({ useOnline: () => true }));
vi.mock("../files/api", () => ({
  uploadDocument: fake.upload,
  uploadAcademyStudentExamPdf: fake.uploadExam,
  uploadAcademyAnswerKeyPdf: fake.uploadAnswer,
}));
vi.mock("./api", () => ({
  courseWorkspaceKey: (actor: string, run: string) => [
    "course-workspace",
    actor,
    run,
  ],
  downloadCourseDocument: fake.download,
}));

function course(
  required: boolean,
  canEdit: boolean,
  staff = canEdit,
): CourseWorkspace {
  return {
    id: "fictional-course",
    access: { staff },
    exams: {
      required,
      can_edit: canEdit,
      version: canEdit ? 0 : null,
      documents: required
        ? [
            {
              id: "paper-id",
              name: "Fictional exam.pdf",
              version_id: "version-id",
              version: 1,
              audience: "students",
            },
          ]
        : [],
    },
  } as CourseWorkspace;
}

const clients: QueryClient[] = [];
function show(
  value: CourseWorkspace,
  academy?: "active" | "grace",
  examTitle?: string,
) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <CourseExams
        course={value}
        actor="learner"
        academy={academy}
        examTitle={examTitle}
      />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  fake.rpc
    .mockReset()
    .mockResolvedValue({ data: { required: true, version: 1 }, error: null });
  fake.upload.mockReset().mockResolvedValue({
    status: "clean",
    current_version_id: "clean-version",
  });
  fake.uploadExam.mockReset();
  fake.uploadAnswer.mockReset();
  fake.download.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

it("hides the exam area from a participant while the course exam is optional", () => {
  show(course(false, false));
  expect(screen.queryByRole("region", { name: "Course exam" })).toBeNull();
});

it("shows only the learner paper and no editor controls", () => {
  show(course(true, false));
  expect(screen.getByText("Fictional exam.pdf")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Download PDF" })).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Upload and share PDF" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Save exam setting" }),
  ).toBeNull();
});

it("lets a company editor share student papers without offering staff answer keys", () => {
  show(course(true, true, false));
  expect(
    screen.getByRole("button", { name: "Upload and share PDF" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("option", { name: "Course team answer key" }),
  ).toBeNull();
});

it("requires a saved schedule for a new student exam paper", async () => {
  const user = userEvent.setup();
  show(course(false, true));
  expect(
    screen.getByText("Save the exam schedule before publishing the paper."),
  ).toBeVisible();
  await user.upload(
    screen.getByLabelText("Exam file (PDF)"),
    new File(["%PDF-1.7 fictional"], "Fictional exam.pdf", {
      type: "application/pdf",
    }),
  );
  expect(
    screen.getByRole("button", { name: "Upload and share PDF" }),
  ).toBeDisabled();
  expect(fake.upload).not.toHaveBeenCalled();
});

it("publishes only the scanner-confirmed exact version through the editor RPC", async () => {
  const user = userEvent.setup();
  fake.rpc.mockResolvedValue({ data: "published-exam", error: null });
  show(
    {
      ...course(true, true),
      exams: { ...course(true, true).exams, documents: [] },
    },
    undefined,
    "Scheduled exam",
  );
  await user.upload(
    screen.getByLabelText("Exam file (PDF)"),
    new File(["%PDF-1.7 fictional"], "Fictional exam.pdf", {
      type: "application/pdf",
    }),
  );
  await user.click(
    screen.getByRole("button", { name: "Upload and share PDF" }),
  );
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith("share_course_exam_pdf", {
      p_run_id: "fictional-course",
      p_version_id: "clean-version",
      p_audience: "students",
    }),
  );
  expect(await screen.findByText("Change confirmed.")).toBeVisible();
});

it("retries internal publication without uploading the PDF a second time", async () => {
  const user = userEvent.setup();
  fake.rpc
    .mockResolvedValueOnce({ data: null, error: { code: "network_error" } })
    .mockResolvedValueOnce({ data: "published-exam", error: null });
  show(course(true, true, false));
  expect(screen.getByText(/as soon as its scan succeeds/i)).toBeVisible();
  const paper = new File(["%PDF-1.7 fictional"], "Retry exam.pdf", {
    type: "application/pdf",
  });
  await user.upload(screen.getByLabelText("Exam file (PDF)"), paper);
  await user.click(
    screen.getByRole("button", { name: "Upload and share PDF" }),
  );
  expect(
    await screen.findByText(/retry publishing the same version/i),
  ).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "Retry publishing scanned exam paper" }),
  );
  expect(await screen.findByText("Change confirmed.")).toBeVisible();
  expect(fake.upload).toHaveBeenCalledExactlyOnceWith(paper, {
    scope: "personal",
    kind: "material",
    clientId: expect.any(String),
  });
  expect(fake.rpc.mock.calls).toEqual([
    [
      "share_course_exam_pdf",
      {
        p_run_id: "fictional-course",
        p_version_id: "clean-version",
        p_audience: "students",
      },
    ],
    [
      "share_course_exam_pdf",
      {
        p_run_id: "fictional-course",
        p_version_id: "clean-version",
        p_audience: "students",
      },
    ],
  ]);
  expect(
    screen.getByRole("button", { name: "Upload and share PDF" }),
  ).toBeDisabled();
});

it("requires replacing the internal attachment when changing its publication audience", async () => {
  const user = userEvent.setup();
  fake.rpc.mockResolvedValue({ data: null, error: { code: "network_error" } });
  show(course(true, true));
  await user.selectOptions(
    screen.getByLabelText("Document type"),
    "exam_staff",
  );
  await user.upload(
    screen.getByLabelText("Exam file (PDF)"),
    new File(["%PDF-1.7 staff"], "Staff only.pdf", { type: "application/pdf" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Upload and share PDF" }),
  );
  expect(
    await screen.findByText(/retry publishing the same version/i),
  ).toBeVisible();
  await user.selectOptions(screen.getByLabelText("Document type"), "students");
  expect(
    screen.getByRole("button", { name: "Upload and share PDF" }),
  ).toBeDisabled();
  expect(fake.rpc).toHaveBeenCalledExactlyOnceWith("share_course_exam_pdf", {
    p_run_id: "fictional-course",
    p_version_id: "clean-version",
    p_audience: "exam_staff",
  });
});

it("keeps the internal reservation on a scan retry and rejects a quarantined scan", async () => {
  const user = userEvent.setup();
  fake.upload
    .mockRejectedValueOnce(new Error("scan response lost"))
    .mockResolvedValueOnce({
      status: "quarantined",
      current_version_id: "quarantine-version",
    });
  show(course(true, true));
  await user.upload(
    screen.getByLabelText("Exam file (PDF)"),
    new File(["%PDF-1.7 fictional"], "Unconfirmed exam.pdf", {
      type: "application/pdf",
    }),
  );
  await user.click(
    screen.getByRole("button", { name: "Upload and share PDF" }),
  );
  expect(await screen.findByText(/scan could not be confirmed/i)).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "Upload and share PDF" }),
  );
  await waitFor(() => expect(fake.upload).toHaveBeenCalledTimes(2));
  expect(fake.upload.mock.calls[1]).toEqual(fake.upload.mock.calls[0]);
  expect(await screen.findByText(/scan could not be confirmed/i)).toBeVisible();
  expect(fake.rpc).not.toHaveBeenCalled();
});

it("submits only the exact academy setting and never offers PDF actions", async () => {
  const user = userEvent.setup();
  show(course(false, true, false), "active");
  expect(screen.queryByLabelText("Exam file (PDF)")).toBeNull();
  expect(screen.queryByLabelText("New student exam paper (PDF)")).toBeNull();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Course exam" }),
    "yes",
  );
  await user.click(screen.getByRole("button", { name: "Save exam setting" }));
  expect(await screen.findByText("Change confirmed.")).toBeVisible();
  expect(fake.rpc).toHaveBeenCalledExactlyOnceWith("set_course_exam_required", {
    p_run_id: "fictional-course",
    p_required: true,
    p_expected_version: 0,
  });
  expect(fake.upload).not.toHaveBeenCalled();
});

it("hides staff answer keys and editing from a company contact in grace", () => {
  const model = course(true, true, false);
  model.exams.documents[0].audience = "exam_staff";
  show(model, "grace");
  expect(screen.getByText("Exam required")).toBeVisible();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Save exam setting" }),
  ).toBeNull();
  expect(screen.queryByText("Fictional exam.pdf")).toBeNull();
  expect(screen.queryByLabelText("New student exam paper (PDF)")).toBeNull();
});

it("publishes only the selected previously scanned student PDF, without an upload or answer-key control", async () => {
  const user = userEvent.setup();
  fake.rpc.mockImplementation((name) =>
    name === "academy_student_exam_pdf_options"
      ? {
          abortSignal: async () => ({
            data: [
              {
                id: "exact-approved-version",
                name: "Retained paper.pdf",
                version: 2,
              },
            ],
            error: null,
          }),
        }
      : Promise.resolve({ data: "published-paper", error: null }),
  );
  show(course(true, true, false), "active");
  const choice = await screen.findByRole("option", {
    name: "Retained paper.pdf · Version 2",
  });
  await user.selectOptions(
    screen.getByLabelText("Previously scanned exam paper"),
    choice,
  );
  await user.click(screen.getByRole("button", { name: "Publish exam paper" }));
  expect(await screen.findByText("Change confirmed.")).toBeVisible();
  expect(fake.rpc).toHaveBeenCalledWith("share_course_exam_pdf", {
    p_run_id: "fictional-course",
    p_version_id: "exact-approved-version",
    p_audience: "students",
  });
  expect(
    screen.queryByRole("option", { name: "Course team answer key" }),
  ).toBeNull();
  expect(screen.queryByLabelText("Exam file (PDF)")).toBeNull();
  expect(fake.upload).not.toHaveBeenCalled();
});

it("retries publishing the exact scanned exam PDF for a company editor without uploading it again", async () => {
  const user = userEvent.setup();
  const publish = vi
    .fn()
    .mockResolvedValueOnce({ data: null, error: { code: "unavailable" } })
    .mockResolvedValueOnce({ data: "published-paper", error: null });
  fake.rpc.mockImplementation((method, input) =>
    method === "academy_student_exam_pdf_options"
      ? { abortSignal: async () => ({ data: [], error: null }) }
      : publish(method, input),
  );
  fake.uploadExam.mockResolvedValue({
    status: "clean",
    current_version_id: "exact-new-version",
  });
  show(course(true, true, false), "active");
  const paper = new File(["%PDF-1.7 fictional"], "New exam.pdf", {
    type: "application/pdf",
  });
  await user.upload(
    screen.getByLabelText("New student exam paper (PDF)"),
    paper,
  );
  await user.click(
    screen.getByRole("button", { name: "Scan and publish exam paper" }),
  );
  expect(
    await screen.findByText(
      "The PDF was scanned. Retry publishing the same version.",
    ),
  ).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "Retry publishing scanned exam paper" }),
  );
  expect(await screen.findByText("Change confirmed.")).toBeVisible();
  expect(fake.uploadExam).toHaveBeenCalledExactlyOnceWith(
    paper,
    "fictional-course",
    expect.any(String),
  );
  expect(fake.upload).not.toHaveBeenCalled();
  expect(publish.mock.calls).toEqual(
    Array.from({ length: 2 }, () => [
      "share_course_exam_pdf",
      {
        p_run_id: "fictional-course",
        p_version_id: "exact-new-version",
        p_audience: "students",
      },
    ]),
  );
});

it("keeps the staff answer key separate and publishes the exact scanned version to staff", async () => {
  const user = userEvent.setup();
  fake.rpc.mockImplementation((method) =>
    method === "academy_student_exam_pdf_options"
      ? { abortSignal: async () => ({ data: [], error: null }) }
      : Promise.resolve({ data: "published-staff-key", error: null }),
  );
  fake.uploadAnswer.mockResolvedValue({
    status: "clean",
    current_version_id: "exact-answer-version",
  });
  show(course(true, true), "active");
  const paper = new File(["%PDF-1.7 fictional"], "Student paper.pdf", {
    type: "application/pdf",
  });
  await user.upload(
    screen.getByLabelText("New student exam paper (PDF)"),
    paper,
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Document type" }),
    "exam_staff",
  );
  expect(
    screen.getByRole("button", { name: "Scan and publish for course staff" }),
  ).toBeDisabled();
  const answer = new File(["%PDF-1.7 fictional answers"], "Answer key.pdf", {
    type: "application/pdf",
  });
  await user.upload(screen.getByLabelText("New answer key (PDF)"), answer);
  await user.click(
    screen.getByRole("button", { name: "Scan and publish for course staff" }),
  );
  expect(await screen.findByText("Change confirmed.")).toBeVisible();
  expect(fake.uploadAnswer).toHaveBeenCalledExactlyOnceWith(
    answer,
    "fictional-course",
    expect.any(String),
  );
  expect(fake.uploadExam).not.toHaveBeenCalled();
  expect(fake.rpc).toHaveBeenCalledWith("share_course_exam_pdf", {
    p_run_id: "fictional-course",
    p_version_id: "exact-answer-version",
    p_audience: "exam_staff",
  });
});

it("lets only current staff read a published solution in grace while the exam is off", async () => {
  const user = userEvent.setup();
  const model = course(false, false, true);
  model.exams.documents.push({
    id: "key-id",
    name: "Staff-only key.pdf",
    version: 1,
    version_id: "version",
    audience: "exam_staff",
    can_remove: false,
  });
  show(model, "grace");
  expect(screen.getByText("Staff-only key.pdf")).toBeVisible();
  expect(screen.queryByLabelText("New answer key (PDF)")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Withdraw Staff-only key.pdf" }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Download PDF" }));
  expect(fake.download).toHaveBeenCalledExactlyOnceWith(
    "exam",
    "key-id",
    "Staff-only key.pdf",
  );
});

it("withdraws only the exact publication confirmed as removable by the server", async () => {
  const user = userEvent.setup();
  const model = course(false, true);
  model.exams.documents.push(
    {
      id: "owned-key",
      name: "Owned key.pdf",
      version: 1,
      version_id: "owned-version",
      audience: "exam_staff",
      can_remove: true,
    },
    {
      id: "other-key",
      name: "Other key.pdf",
      version: 1,
      version_id: "other-version",
      audience: "exam_staff",
      can_remove: false,
    },
  );
  show(model, "active");
  expect(
    screen.queryByRole("button", { name: "Withdraw Other key.pdf" }),
  ).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Withdraw Owned key.pdf" }),
  );
  expect(await screen.findByText("Change confirmed.")).toBeVisible();
  expect(fake.rpc).toHaveBeenCalledExactlyOnceWith("remove_course_exam_pdf", {
    p_run_id: "fictional-course",
    p_exam_id: "owned-key",
  });
});

it("lets a grace-period learner download only a published student paper", async () => {
  const user = userEvent.setup();
  const model = course(true, false);
  model.exams.documents.push({
    ...model.exams.documents[0],
    id: "answer-key",
    name: "Staff-only key.pdf",
    audience: "exam_staff",
  });
  show(model, "grace");
  await user.click(screen.getByRole("button", { name: "Download PDF" }));
  expect(fake.download).toHaveBeenCalledExactlyOnceWith(
    "exam",
    "paper-id",
    "Fictional exam.pdf",
  );
  expect(screen.queryByText("Staff-only key.pdf")).toBeNull();
  expect(fake.rpc).not.toHaveBeenCalled();
});

it("requires a fresh read after the academy exam version changes", async () => {
  const user = userEvent.setup();
  fake.rpc.mockResolvedValue({ data: null, error: { code: "PT409" } });
  show(course(false, true), "active");
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Course exam" }),
    "yes",
  );
  await user.click(screen.getByRole("button", { name: "Save exam setting" }));
  expect(await screen.findByText(/exam setting has changed/i)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Save exam setting" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Refresh course" })).toBeVisible();
});
