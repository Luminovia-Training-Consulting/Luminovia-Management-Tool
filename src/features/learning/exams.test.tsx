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
  download: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
vi.mock("../../lib/online", () => ({ useOnline: () => true }));
vi.mock("../files/api", () => ({ uploadDocument: fake.upload }));
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
function show(value: CourseWorkspace, academy?: "active" | "grace") {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <CourseExams course={value} actor="learner" academy={academy} />
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

it("publishes only the scanner-confirmed exact version through the editor RPC", async () => {
  const user = userEvent.setup();
  show(course(false, true));
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
});

it("submits only the exact academy setting and never offers PDF actions", async () => {
  const user = userEvent.setup();
  show(course(false, true, false), "active");
  expect(screen.queryByLabelText("Exam file (PDF)")).toBeNull();
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

it("shows the last exam decision without controls or PDF metadata in grace", () => {
  const model = course(true, true);
  model.exams.documents[0].audience = "exam_staff";
  show(model, "grace");
  expect(screen.getByText("Exam required")).toBeVisible();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Save exam setting" }),
  ).toBeNull();
  expect(screen.queryByText("Fictional exam.pdf")).toBeNull();
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
