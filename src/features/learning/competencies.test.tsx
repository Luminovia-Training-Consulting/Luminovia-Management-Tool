/** Learners see just their published evidence and managers work through explicit course mappings. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CourseWorkspace } from "./api";
import { CourseCompetencies } from "./competencies";
import { competencyFrameworkDefinition } from "./competency-schema";
import i18n from "../../lib/i18n";

const fake = vi.hoisted(() => ({ query: vi.fn(), rpc: vi.fn() }));
vi.mock("../../lib/online", () => ({
  useOnline: () => true,
  requireOnline: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));

const [id, beginner, experienced, competency] = [
  "e164001a-5851-4b9a-946e-65c699734f90",
  "0438826f-3921-4b82-a4af-d0303f1b8102",
  "0b132c26-414a-4eca-8411-7ad084476a3d",
  "56432106-f011-4921-9e07-03dd6ced963a",
];
const content = {
  title: "Fictional framework",
  levels: [
    { id: beginner, title: "Guided" },
    { id: experienced, title: "Independent" },
  ],
  competencies: [
    { id: competency, code: "CMD", title: "Navigate directories" },
  ],
};
const view = {
  can_manage: false,
  can_assess: false,
  pin_revision: 1,
  pinned_framework: { id, revision: 1, content },
  frameworks: [],
  current_revisions: { [competency]: 1 },
  has_more: false,
  decisions: [
    {
      pin_revision: 1,
      revision: 1,
      competency_id: competency,
      level_id: beginner,
      code: "CMD",
      competency_title: content.competencies[0].title,
      level_title: content.levels[0].title,
      framework_title: content.title,
      evidence_note: "Used the directory browser with support",
      created_at: "2026-11-26T08:00:00Z",
      quiz_evidence: { id, quiz_version: 3, score: 80 },
    },
  ],
};
const course = {
  id,
  time_zone: "Australia/Brisbane",
  access: { staff: false },
  roster: [],
} as unknown as CourseWorkspace;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  fake.query.mockImplementation(async () => ({ data: view, error: null }));
  fake.rpc.mockImplementation(() => ({ abortSignal: fake.query }));
});
afterEach(cleanup);

it("loads the learner projection only on disclosure and renders immutable evidence", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CourseCompetencies actor="learner" course={course} editable={false} />
    </QueryClientProvider>,
  );
  expect(fake.rpc).not.toHaveBeenCalled();
  const summary = screen.getByText("Competencies");
  const details = summary.closest("details");
  if (!details) throw Error("Competency disclosure unavailable");
  details.open = true;
  fireEvent(details, new Event("toggle"));
  expect(
    await screen.findByText("Used the directory browser with support"),
  ).toBeVisible();
  expect(screen.getByText("Quiz revision 3 · 80%")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Release assessment" }),
  ).not.toBeInTheDocument();
  expect(fake.rpc).toHaveBeenCalledWith("course_competencies", {
    p_run_id: id,
    p_user_id: null,
    p_offset: 0,
  });
});

it("requires a bounded level scale for a publishable framework", () => {
  expect(competencyFrameworkDefinition.safeParse(content).success).toBe(true);
  expect(
    competencyFrameworkDefinition.safeParse({
      ...content,
      levels: [content.levels[0]],
    }).success,
  ).toBe(false);
});
