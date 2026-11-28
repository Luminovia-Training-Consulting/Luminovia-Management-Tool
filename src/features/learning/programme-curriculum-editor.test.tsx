import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import i18n from "../../lib/i18n";
import { ProgrammeCurriculumEditor } from "./programme-curriculum-editor";
import type { LearningProgramDetail } from "./learning-program-schema";
import "./learning-program-i18n";

const mocks = vi.hoisted(() => ({ configure: vi.fn() }));
vi.mock("./learning-program-api", () => ({
  configureLearningProgramCurriculum: mocks.configure,
}));

const programId = "82ab2348-4504-42a4-bf7a-e310eda55ac9";
const firstCourse = "af28e51e-6bbc-4460-b87f-553058ee0a45";
const secondCourse = "265fe4a6-0b0b-433f-8bbb-383e42c69c4f";
const program: LearningProgramDetail = {
  id: programId,
  organisation_id: "f75fd521-3dbb-478e-b39b-252b82857c9c",
  title: "Fictional programme",
  organisation_name: "Fictional company",
  description: "",
  archived: false,
  sequential: false,
  version: 3,
  manage: true,
  can_write: true,
  can_edit: true,
  steps: [
    { course_id: firstCourse, title: "Starting course" },
    { course_id: secondCourse, title: "Second course" },
  ],
  curriculum: {
    revision: 2,
    overview: "",
    elective_count: 1,
    steps: {
      [firstCourse]: { required: true, objectives: "", remediation: "" },
      [secondCourse]: { required: false, objectives: "", remediation: "" },
    },
  },
  progress: null,
  learner_name: null,
  roster: null,
};

async function setup() {
  await i18n.changeLanguage("en");
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProgrammeCurriculumEditor
        program={program}
        onSaved={onSaved}
        onCancel={onCancel}
      />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onSaved, onCancel };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("publishes an all-required curriculum after the empty elective field is removed", async () => {
  const { user } = await setup();
  const electiveCount = screen.getByLabelText(
    "Electives required for programme completion",
  );
  await user.clear(electiveCount);
  await user.click(screen.getByRole("checkbox", { name: "Required course" }));
  expect(electiveCount).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Publish curriculum" }));
  expect(mocks.configure).toHaveBeenCalledWith({
    p_program_id: program.id,
    p_expected_version: program.version,
    p_curriculum: {
      overview: "",
      elective_count: 0,
      steps: {
        [firstCourse]: { required: true, objectives: "", remediation: "" },
        [secondCourse]: { required: true, objectives: "", remediation: "" },
      },
    },
  });
});

test("only resets the curriculum after confirmation inside the keyboard-dismissable dialog", async () => {
  const { user, onSaved, onCancel } = await setup();
  const reset = screen.getByRole("button", { name: "Reset curriculum" });
  await user.click(reset);
  const dialog = screen.getByRole("dialog", { name: "Reset curriculum" });
  expect(
    within(dialog).getByRole("button", { name: "Confirm reset" }),
  ).toBeVisible();
  await user.keyboard("{Escape}");
  expect(dialog).not.toBeInTheDocument();
  expect(reset).toHaveFocus();
  expect(onCancel).not.toHaveBeenCalled();
  expect(mocks.configure).not.toHaveBeenCalled();

  await user.keyboard("{Enter}");
  await user.click(
    within(screen.getByRole("dialog", { name: "Reset curriculum" })).getByRole(
      "button",
      { name: "Confirm reset" },
    ),
  );
  expect(mocks.configure).toHaveBeenCalledWith({
    p_program_id: program.id,
    p_expected_version: program.version,
    p_curriculum: null,
  });
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
});
