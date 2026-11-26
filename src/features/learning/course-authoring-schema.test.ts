import { describe, expect, it } from "vitest";
import {
  copyCourseLesson,
  copyCourseModule,
  createCourseModule,
  maxModuleLessons,
  moveCourseLesson,
  normalizeCourseCurriculum,
} from "./course-authoring-schema";

const moduleId = "8f9d9d23-59d7-4cb4-a996-53eb828f92c1";
const lessonId = "6d1bb289-55c2-4e19-8b2a-3b0a573df4a6";

const curriculum = {
  modules: [
    {
      id: moduleId,
      title: "  Fictional module  ",
      description: "Module overview",
      lessons: [
        {
          id: lessonId,
          title: "Fictional lesson",
          objectives: "Explain the topic",
          duration_minutes: 30,
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Safe learning text",
                    marks: [
                      {
                        type: "link",
                        attrs: { href: "javascript:alert(1)", target: "_self" },
                      },
                    ],
                  },
                ],
              },
              { type: "html", attrs: { html: "<script>alert(1)</script>" } },
            ],
          },
        },
      ],
    },
  ],
};

describe("course authoring content contract", () => {
  it("duplicates a module and all nested lessons as independently editable content", () => {
    const original = normalizeCourseCurriculum(curriculum).modules[0];
    const copy = copyCourseModule(original);
    const copiedLesson = copyCourseLesson(original.lessons[0]);
    expect(
      new Set([
        original.id,
        copy.id,
        original.lessons[0].id,
        copy.lessons[0].id,
        copiedLesson.id,
      ]).size,
    ).toBe(5);
    expect(copy.lessons[0].body).toEqual(original.lessons[0].body);
    expect(copy.lessons[0].body.content).not.toBe(
      original.lessons[0].body.content,
    );
    copy.lessons[0].body.content!.push({ type: "paragraph" });
    expect(original.lessons[0].body.content).toHaveLength(2);
    expect(
      normalizeCourseCurriculum({ modules: [original, copy] }).modules,
    ).toHaveLength(2);
  });

  it("moves the exact lesson without changing the source snapshot or exceeding the destination limit", () => {
    const initial = normalizeCourseCurriculum(curriculum);
    const source = initial.modules[0];
    const target = {
      ...createCourseModule(),
      title: "Destination",
      lessons: [copyCourseLesson(source.lessons[0])],
    };
    const withTarget = { modules: [source, target] };
    const moved = moveCourseLesson(withTarget, source.id, lessonId, target.id);
    expect(moved.modules[0].lessons).toEqual([]);
    expect(moved.modules[1].lessons).toEqual([
      ...target.lessons,
      source.lessons[0],
    ]);
    expect(source.lessons).toHaveLength(1);
    expect(target.lessons).toHaveLength(1);
    expect(moveCourseLesson(withTarget, source.id, lessonId, source.id)).toBe(
      withTarget,
    );
    expect(moveCourseLesson(withTarget, source.id, "missing", target.id)).toBe(
      withTarget,
    );
    expect(moveCourseLesson(withTarget, source.id, lessonId, "missing")).toBe(
      withTarget,
    );

    const full = {
      modules: [
        source,
        {
          ...target,
          lessons: Array.from({ length: maxModuleLessons }, () =>
            copyCourseLesson(source.lessons[0]),
          ),
        },
      ],
    };
    expect(moveCourseLesson(full, source.id, lessonId, target.id)).toBe(full);
  });
  it("normalizes IDs, text and supported editor nodes before saving", () => {
    const normalized = normalizeCourseCurriculum(curriculum);
    expect(normalized.modules[0].title).toBe("Fictional module");
    expect(normalized.modules[0].lessons[0].body).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Safe learning text", marks: [] }],
        },
        { type: "paragraph" },
      ],
    });
  });

  it("rejects malformed IDs, duplicate hierarchy IDs, oversized values and invalid durations", () => {
    expect(() =>
      normalizeCourseCurriculum({
        modules: [{ ...curriculum.modules[0], id: "not-a-uuid" }],
      }),
    ).toThrow("Invalid course module");
    expect(() =>
      normalizeCourseCurriculum({
        modules: [
          {
            ...curriculum.modules[0],
            lessons: [{ ...curriculum.modules[0].lessons[0], id: moduleId }],
          },
        ],
      }),
    ).toThrow("Invalid course lesson");
    expect(() =>
      normalizeCourseCurriculum({
        modules: [
          {
            ...curriculum.modules[0],
            lessons: [
              { ...curriculum.modules[0].lessons[0], duration_minutes: 1441 },
            ],
          },
        ],
      }),
    ).toThrow("Invalid course lesson");
    expect(() =>
      normalizeCourseCurriculum({
        modules: Array(41).fill(curriculum.modules[0]),
      }),
    ).toThrow("Invalid course modules");
  });
});
