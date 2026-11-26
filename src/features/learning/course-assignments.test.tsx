/** Exercise the learner/staff workspace controls without replacing server integration tests. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import {
  rubricIsOrdered,
  type CourseAssignment,
} from "./course-assignment-schema";
import { CourseAssignments } from "./course-assignments";
import "./i18n";

const { rpc, upload, online } = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  online: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../../lib/online", () => ({
  requireOnline: vi.fn(),
  useOnline: online,
}));
vi.mock("../files/api", () => ({
  acceptedFiles: ".pdf",
  uploadCourseAssignmentSubmission: upload,
}));

const course = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const student = "33333333-3333-4333-8333-333333333333";
const assignment = "44444444-4444-4444-8444-444444444444";
const fileVersion = "55555555-5555-4555-8555-555555555555";
const attempt = "66666666-6666-4666-8666-666666666666";
const dueAt = "2026-11-27T04:00:00+00:00";
let data: CourseAssignment;

function mount(staff = false, readOnly = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CourseAssignments
        actor={staff ? actor : student}
        course={course}
        zone="Australia/Brisbane"
        participants={[
          { user_id: student, name: "Fictional learner", status: "enrolled" },
        ]}
        staff={staff}
        readOnly={readOnly}
      />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  online.mockReturnValue(true);
  data = {
    assignment_id: assignment,
    title: "Fictional practical assignment",
    instructions: "Attach your course exercise.",
    due_at: dueAt,
    effective_due_at: dueAt,
    max_attempts: 2,
    rubric: [
      {
        label: "Evidence",
        levels: [
          { label: "Missing", points: 0 },
          { label: "Complete", points: 8 },
        ],
      },
    ],
    version: 1,
    published_version: 1,
    can_submit: true,
    extensions: [],
    attempts: [],
  };
  rpc.mockImplementation(async (name, args) =>
    name === "course_assignments"
      ? {
          data: {
            can_manage: false,
            assignments: [
              {
                id: assignment,
                title: data.title,
                due_at: dueAt,
                published_version: 1,
              },
            ],
            detail: args.p_assignment_id ? data : null,
          },
          error: null,
        }
      : { error: null },
  );
  upload.mockResolvedValue({ current_version_id: fileVersion });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function selectAssignment() {
  fireEvent.change(
    await screen.findByRole("combobox", { name: "Choose assignment" }),
    { target: { value: assignment } },
  );
  await screen.findByText("Attach your course exercise.");
}

it("keeps the submitted exact scanned version on retry after a failed acknowledgement", async () => {
  mount();
  await selectAssignment();
  const pdf = new File(["synthetic PDF"], "fixture.pdf", {
    type: "application/pdf",
  });
  fireEvent.change(screen.getByLabelText("Choose file"), {
    target: { files: [pdf] },
  });
  const reads = rpc.getMockImplementation()!;
  let first = true;
  rpc.mockImplementation(async (name, args) => {
    if (name === "course_assignment_action" && first) {
      first = false;
      return { error: new Error("Response lost") };
    }
    return reads(name, args);
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit file" }));
  await screen.findByText("Could not submit the file.");
  fireEvent.click(screen.getByRole("button", { name: "Submit file" }));
  const command = [
    "course_assignment_action",
    {
      p_run_id: course,
      p_assignment_id: assignment,
      p_action: "submit",
      p_payload: { file_version_id: fileVersion },
      p_expected_version: 1,
    },
  ];
  await waitFor(() =>
    expect(
      rpc.mock.calls.filter(([name]) => name === "course_assignment_action"),
    ).toEqual([command, command]),
  );
  expect(upload).toHaveBeenCalledTimes(1);
  expect(upload).toHaveBeenCalledWith(
    pdf,
    course,
    assignment,
    expect.any(String),
  );
});

it("shows released feedback in grace with no mutation controls or private notes", async () => {
  data.attempts = [
    {
      id: attempt,
      user_id: student,
      display_name: "Fictional learner",
      attempt_no: 1,
      file_version_id: fileVersion,
      file_name: "fixture.pdf",
      submitted_at: dueAt,
      rubric: data.rubric,
      review: {
        version: 1,
        state: "released",
        scores: [8],
        feedback: "Clear evidence",
        private_note: null,
      },
    },
  ];
  mount(false, true);
  await selectAssignment();
  expect(screen.getByText("Clear evidence")).toBeVisible();
  expect(screen.getByText("8 / 8 points")).toBeVisible();
  expect(screen.queryByText("Private course-staff note")).toBeNull();
  expect(screen.queryByRole("button", { name: "Submit file" })).toBeNull();
});

it("requires unique rubric names, a zero floor and ascending levels", () => {
  expect(rubricIsOrdered(data.rubric)).toBe(true);
  expect(
    rubricIsOrdered([
      ...data.rubric,
      { ...data.rubric[0], label: " evidence " },
    ]),
  ).toBe(false);
  expect(
    rubricIsOrdered([
      { ...data.rubric[0], levels: [...data.rubric[0].levels].reverse() },
    ]),
  ).toBe(false);
});
