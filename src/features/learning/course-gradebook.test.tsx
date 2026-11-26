/** Verify grade release, conflict handling and the learner and grace projections. */
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
import { CourseGradebook } from "./course-gradebook";
import {
  courseGradePolicySchema,
  type CourseGradebook as Projection,
} from "./course-gradebook-schema";
import "./i18n";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../../lib/online", () => ({
  requireOnline: vi.fn(),
  useOnline: () => true,
}));

const time = "2026-11-26T07:00:00Z";
const attempt = {
  id: "fictional-attempt",
  quiz_version: 2,
  passed: true,
  score: 82,
  created_at: time,
};
const preview = { grade_percent: 82, grade_label: null };
const grade = {
  ...preview,
  attempt_id: attempt.id,
  quiz_version: 2,
  revision: 1,
  score: 82,
  passed: true,
  corrected: false,
  policy_version: 1,
  published_at: time,
};
let data: Projection;

function mount(staff: boolean, academy = false, readOnly = false) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CourseGradebook
        actor="fictional-actor"
        courseId="fictional-course"
        active
        academy={academy}
        staff={staff}
        readOnly={readOnly}
      />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  data = {
    can_manage: true,
    policy: { version: 1, scheme: "percentage", bands: [], created_at: time },
    learners: [
      {
        user_id: "fictional-learner",
        name: "Fictional Learner",
        status: "enrolled",
        best_attempt: attempt,
        preview,
        grade: null,
      },
    ],
    own_grade: null,
    total: 1,
    offset: 0,
    limit: 20,
  };
  rpc.mockImplementation((name) => {
    if (name === "course_gradebook")
      return { abortSignal: async () => ({ data, error: null }) };
    data = { ...data, learners: [{ ...data.learners[0], grade }] };
    return Promise.resolve({ data: { revision: 1 }, error: null });
  });
});
afterEach(() => {
  cleanup();
  rpc.mockReset();
});

it("requires distinct bands and a zero threshold", () => {
  const parse = (bands: { minimum: number; label: string }[]) =>
    courseGradePolicySchema.safeParse({ scheme: "bands", bands }).success;
  expect(
    parse([
      { minimum: 0, label: "Not yet" },
      { minimum: 70, label: "Competent" },
    ]),
  ).toBe(true);
  expect(
    parse([
      { minimum: 1, label: "Not yet" },
      { minimum: 70, label: "Competent" },
    ]),
  ).toBe(false);
  expect(
    parse([
      { minimum: 0, label: "Not yet" },
      { minimum: 0, label: "Competent" },
    ]),
  ).toBe(false);
  expect(
    parse([
      { minimum: 0, label: " Competent " },
      { minimum: 70, label: "competent" },
    ]),
  ).toBe(false);
});

it("publishes the reviewed attempt and policy version without supplying a score", async () => {
  mount(true);
  expect(await screen.findByText("Preview: 82%")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Publish grade" }));
  expect(
    await screen.findByText("Published grade: 82% (revision 1)"),
  ).toBeTruthy();
  expect(rpc).toHaveBeenCalledWith("course_workspace_action", {
    p_run_id: "fictional-course",
    p_action: "gradebook_publish",
    p_expected_version: 1,
    p_payload: {
      user_id: "fictional-learner",
      attempt_id: attempt.id,
      expected_revision: 0,
      reason: "",
    },
  });
});

it("keeps a rejected correction visible and requires refresh on a version conflict", async () => {
  data.learners[0].grade = grade;
  rpc.mockImplementation((name) =>
    name === "course_gradebook"
      ? { abortSignal: async () => ({ data, error: null }) }
      : Promise.resolve({ data: null, error: { code: "PT409" } }),
  );
  mount(true, true);
  fireEvent.click(await screen.findByRole("button", { name: "Correct grade" }));
  fireEvent.change(screen.getByLabelText("New grade"), {
    target: { value: "90" },
  });
  fireEvent.change(screen.getByLabelText("Internal reason"), {
    target: { value: "Fictional review" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Publish correction" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "The preview has changed",
  );
  expect(
    (screen.getByLabelText("Internal reason") as HTMLTextAreaElement).value,
  ).toBe("Fictional review");
  expect(rpc).toHaveBeenCalledWith(
    "academy_learning_action",
    expect.objectContaining({
      p_action: "gradebook_correct",
      p_expected_version: 1,
      p_payload: {
        user_id: "fictional-learner",
        grade_value: "90",
        expected_revision: 1,
        reason: "Fictional review",
      },
    }),
  );
});

it("renders only the published personal mark for a participant in German", async () => {
  await i18n.changeLanguage("de");
  data = {
    ...data,
    can_manage: false,
    policy: null,
    learners: [],
    own_grade: grade,
    total: 0,
  };
  mount(false);
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain(
      "Freigegebene Note: 82%",
    ),
  );
  expect(screen.queryByText("Fictional Learner")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Notenskala speichern" }),
  ).toBeNull();
});

it("turns off all grading controls in Academy grace", async () => {
  mount(true, true, true);
  expect(await screen.findByText("Preview: 82%")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: /save grading scale|publish grade/i }),
  ).toBeNull();
});
