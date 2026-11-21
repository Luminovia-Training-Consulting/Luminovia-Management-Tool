import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { CourseClasses } from "./course-classes";
import type { courseClassOptions } from "./course-classes-schema";

const api = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => api }));
vi.mock("../../lib/online", () => ({
  useOnline: () => true,
  requireOnline: () => {},
}));

const course = "6b0b7d6b-47c6-4f36-9bb4-39a03aedb3d7";
const nextCourse = "88367f07-a9e3-4e76-9e34-5cbd1228cb98";
const schoolClass = {
  id: "7dd053ff-ad3e-4999-b4fb-6ebd69fa36f3",
  name: "Fictional Foundation",
};
const savedState = {
  version: 1,
  can_edit: true,
  current: schoolClass,
  classes: [schoolClass],
  courses: [
    { id: course, title: "First semester" },
    { id: nextCourse, title: "Second semester" },
  ],
};

function show(editor = true) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <CourseClasses
          courseId={course}
          actor="fictional-actor"
          editor={editor}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  api.rpc.mockReset();
});

it("creates a class for the current run and reveals the server-confirmed grouped courses", async () => {
  let current: ReturnType<typeof courseClassOptions.parse> = {
    ...savedState,
    version: 0,
    current: null,
    classes: [],
    courses: [],
  };
  api.rpc.mockImplementation((name) => {
    if (name === "course_class_options")
      return { abortSignal: async () => ({ data: current, error: null }) };
    current = savedState;
    return Promise.resolve({ data: current, error: null });
  });
  const user = show();
  await user.selectOptions(await screen.findByLabelText("Select class"), "new");
  await user.type(screen.getByLabelText("Class name"), schoolClass.name);
  await user.click(
    screen.getByRole("button", { name: "Save class assignment" }),
  );
  expect(api.rpc).toHaveBeenCalledWith("set_course_class", {
    p_course_id: course,
    p_class_id: null,
    p_new_name: schoolClass.name,
    p_expected_version: 0,
  });
  expect(await screen.findByText("Class assignment saved.")).toBeVisible();
  expect(screen.getByRole("link", { name: "Second semester" })).toHaveAttribute(
    "href",
    `/courses/${nextCourse}/workspace`,
  );
});

it("shows a rejected stale update without claiming a confirmed change", async () => {
  api.rpc.mockImplementation((name) =>
    name === "course_class_options"
      ? { abortSignal: async () => ({ data: savedState, error: null }) }
      : Promise.resolve({ data: null, error: { code: "PT409" } }),
  );
  const user = show();
  await user.selectOptions(await screen.findByLabelText("Select class"), "");
  await user.click(
    screen.getByRole("button", { name: "Save class assignment" }),
  );
  expect(
    await screen.findByText(/The class assignment could not be saved/),
  ).toBeVisible();
  expect(screen.queryByText("Class assignment saved.")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Second semester" })).toBeVisible();
  expect(api.rpc).toHaveBeenCalledWith("set_course_class", {
    p_course_id: course,
    p_class_id: null,
    p_new_name: null,
    p_expected_version: 1,
  });
});

it("renders the exact German class label without presenting a course editor to the learner", async () => {
  await i18n.changeLanguage("de");
  api.rpc.mockReturnValue({
    abortSignal: async () => ({
      data: { ...savedState, can_edit: false, classes: [], courses: [] },
      error: null,
    }),
  });
  show(false);
  const region = await screen.findByRole("region", { name: "Schulklasse" });
  expect(within(region).getByText(schoolClass.name)).toBeVisible();
  expect(within(region).queryByRole("combobox")).not.toBeInTheDocument();
  expect(within(region).queryByRole("link")).not.toBeInTheDocument();
});
