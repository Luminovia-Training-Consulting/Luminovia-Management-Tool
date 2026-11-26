import { expect, it } from "vitest";
import {
  copyCourseLesson,
  createCourseLesson,
  createCourseModule,
  normalizeCourseCurriculum,
} from "./course-authoring-schema";
import { mergeCourseCurriculum } from "./curriculum-merge";

function example() {
  const module = createCourseModule();
  module.lessons.push(createCourseLesson(), createCourseLesson());
  return normalizeCourseCurriculum({ modules: [module, createCourseModule()] });
}

it("merges separate lesson and module edits without changing either source", () => {
  const base = example();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.modules[0].lessons[0].title = "Independent title";
  remote.modules[0].lessons[0].duration_minutes = 45;
  remote.modules[0].lessons[1].objectives = "Independent objectives";
  remote.modules[1].title = "Another module";

  const merged = mergeCourseCurriculum(base, local, remote);
  expect(merged).toMatchObject({
    modules: [
      {
        lessons: [
          { title: "Independent title", duration_minutes: 45 },
          { objectives: "Independent objectives" },
        ],
      },
      { title: "Another module" },
    ],
  });
  expect(local.modules[0].lessons[0].duration_minutes).toBe(0);
  expect(remote.modules[0].lessons[0].title).toBe(
    base.modules[0].lessons[0].title,
  );
});

it("keeps separate edits when a lesson is added on one side", () => {
  const base = example();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  const added = createCourseLesson();
  remote.modules[0].lessons.unshift(added);
  local.modules[0].lessons[1].title = "Keep this title";
  expect(
    mergeCourseCurriculum(base, local, remote)?.modules[0].lessons,
  ).toMatchObject([
    { id: added.id },
    { id: base.modules[0].lessons[0].id },
    { title: "Keep this title" },
  ]);
});

it("preserves both drafts on overlapping edits and deletion of edited content", () => {
  const base = example();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.modules[0].lessons[0].title = "Local";
  remote.modules[0].lessons[0].title = "Remote";
  expect(mergeCourseCurriculum(base, local, remote)).toBeNull();
  remote.modules[0].lessons.shift();
  expect(mergeCourseCurriculum(base, local, remote)).toBeNull();
});

it("copies practice blocks independently and rejects invalid answer-bearing notes", () => {
  const base = example();
  const lesson = base.modules[0].lessons[0];
  lesson.blocks = [
    {
      id: crypto.randomUUID(),
      title: "Proof exercise",
      kind: "practice",
      text: "Find the smallest counterexample.",
      answer: "Consider the empty set.",
    },
  ];
  const copied = copyCourseLesson(lesson);
  expect(copied.blocks?.[0]).toMatchObject({
    kind: "practice",
    answer: "Consider the empty set.",
  });
  expect(copied.blocks?.[0].id).not.toBe(lesson.blocks[0].id);
  lesson.blocks[0].kind = "note";
  expect(() => normalizeCourseCurriculum(base)).toThrow();
});
