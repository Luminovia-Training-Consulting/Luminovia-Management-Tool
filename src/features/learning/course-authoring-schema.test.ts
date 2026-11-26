import { describe, expect, it } from "vitest";
import { normalizeCourseCurriculum } from "./course-authoring-schema";

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
