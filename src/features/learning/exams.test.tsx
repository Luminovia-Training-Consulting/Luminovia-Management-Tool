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
function show(value: CourseWorkspace) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <CourseExams course={value} actor="learner" />
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
