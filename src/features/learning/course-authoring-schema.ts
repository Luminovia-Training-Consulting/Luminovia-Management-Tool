/** Shared curriculum codec for immutable saved revisions and the authoring editor. */
import type { JSONContent } from "@tiptap/react";
import { z } from "zod";
import {
  contentIsValid,
  emptyDocument,
  normalizedDocument,
} from "../knowledge/content";

export type CourseLesson = {
  id: string;
  title: string;
  objectives: string;
  duration_minutes: number;
  body: JSONContent;
  archived?: boolean;
  material_ids?: string[];
  blocks?: CourseLessonBlock[];
};

export type CourseModule = {
  id: string;
  title: string;
  description: string;
  lessons: CourseLesson[];
  archived?: boolean;
};

export type CourseCurriculum = { modules: CourseModule[] };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const maxCourseModules = 40;
export const maxModuleLessons = 100;
export const maxLessonMaterials = 12;

export const maxLessonBlocks = 12;
export const lessonBlockKinds = ["note", "practice", "checklist"] as const;
export const lessonBlock = z
  .strictObject({
    id: z
      .string()
      .regex(uuid)
      .refine((id) => id === id.toLowerCase()),
    kind: z.enum(lessonBlockKinds),
    title: z.string().max(120),
    text: z.string().max(4000),
    answer: z.string().max(4000).optional(),
  })
  .refine(({ kind, answer }) => kind === "practice" || answer === undefined);
export type CourseLessonBlock = z.infer<typeof lessonBlock>;
const lessonBlocks = z
  .array(lessonBlock)
  .max(maxLessonBlocks)
  .refine(
    (blocks) => new Set(blocks.map(({ id }) => id)).size === blocks.length,
  );

export const emptyCurriculum: CourseCurriculum = { modules: [] };

export function newCourseContentId() {
  return globalThis.crypto.randomUUID();
}

/** Apply the authoring safety and size rules to one lesson before it is inserted in a draft. */
export function normalizeCourseLesson(lessonCandidate: unknown): CourseLesson {
  if (
    !lessonCandidate ||
    typeof lessonCandidate !== "object" ||
    Array.isArray(lessonCandidate)
  )
    throw new Error("Invalid course lesson");
  const lesson = lessonCandidate as Record<string, unknown>;
  if (
    typeof lesson.id !== "string" ||
    !uuid.test(lesson.id) ||
    (lesson.archived !== undefined && typeof lesson.archived !== "boolean") ||
    typeof lesson.title !== "string" ||
    lesson.title.trim().length < 1 ||
    lesson.title.trim().length > 150 ||
    typeof lesson.objectives !== "string" ||
    lesson.objectives.length > 1000 ||
    typeof lesson.duration_minutes !== "number" ||
    !Number.isInteger(lesson.duration_minutes) ||
    lesson.duration_minutes < 0 ||
    lesson.duration_minutes > 1440
  )
    throw new Error("Invalid course lesson");
  const materials = lesson.material_ids;
  if (
    materials !== undefined &&
    (!Array.isArray(materials) ||
      materials.length > maxLessonMaterials ||
      materials.some(
        (id: unknown) =>
          typeof id !== "string" || !uuid.test(id) || id !== id.toLowerCase(),
      ) ||
      new Set(materials).size !== materials.length)
  )
    throw new Error("Invalid lesson material references");
  const blocks = lessonBlocks.optional().parse(lesson.blocks);
  const body = normalizedDocument(lesson.body as JSONContent);
  if (!contentIsValid(body, true)) throw new Error("Invalid lesson content");
  return {
    id: lesson.id,
    title: lesson.title.trim(),
    objectives: lesson.objectives,
    duration_minutes: lesson.duration_minutes,
    body,
    ...(lesson.archived && { archived: true }),
    ...(materials?.length && { material_ids: [...materials] }),
    ...(blocks?.length && { blocks }),
  };
}

export function normalizeCourseCurriculum(value: unknown): CourseCurriculum {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid course curriculum");
  const modules = (value as { modules?: unknown }).modules;
  if (!Array.isArray(modules) || modules.length > maxCourseModules)
    throw new Error("Invalid course modules");

  const ids = new Set<string>();
  const normalizedModules = modules.map((candidate): CourseModule => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      throw new Error("Invalid course module");
    const module = candidate as Record<string, unknown>;
    if (
      typeof module.id !== "string" ||
      !uuid.test(module.id) ||
      ids.has(module.id.toLowerCase()) ||
      (module.archived !== undefined && typeof module.archived !== "boolean") ||
      typeof module.title !== "string" ||
      module.title.trim().length < 1 ||
      module.title.trim().length > 150 ||
      typeof module.description !== "string" ||
      module.description.length > 1000 ||
      !Array.isArray(module.lessons) ||
      module.lessons.length > maxModuleLessons
    )
      throw new Error("Invalid course module");
    ids.add(module.id.toLowerCase());

    const lessons = module.lessons.map((candidate) => {
      const lesson = normalizeCourseLesson(candidate);
      const id = lesson.id.toLowerCase();
      if (ids.has(id)) throw new Error("Invalid course lesson");
      ids.add(id);
      return lesson;
    });

    return {
      id: module.id,
      title: module.title.trim(),
      description: module.description,
      lessons,
      ...(module.archived && { archived: true }),
    };
  });

  const normalized = { modules: normalizedModules };
  if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > 500000)
    throw new Error("Course curriculum is too large");
  return normalized;
}

export function createCourseLesson(): CourseLesson {
  return {
    id: newCourseContentId(),
    title: "",
    objectives: "",
    duration_minutes: 0,
    body: structuredClone(emptyDocument),
  };
}

export function createCourseModule(): CourseModule {
  return {
    id: newCourseContentId(),
    title: "",
    description: "",
    lessons: [],
  };
}

export function copyCourseLesson(lesson: CourseLesson): CourseLesson {
  return {
    ...lesson,
    id: newCourseContentId(),
    body: structuredClone(lesson.body),
    ...(lesson.material_ids && { material_ids: [...lesson.material_ids] }),
    ...(lesson.blocks && {
      blocks: lesson.blocks.map((block) => ({
        ...block,
        id: newCourseContentId(),
      })),
    }),
  };
}

export function copyCourseModule(module: CourseModule): CourseModule {
  return {
    ...module,
    id: newCourseContentId(),
    lessons: module.lessons.map(copyCourseLesson),
  };
}

export function moveCourseLesson(
  curriculum: CourseCurriculum,
  sourceId: string,
  lessonId: string,
  targetId: string,
): CourseCurriculum {
  if (sourceId === targetId) return curriculum;
  const source = curriculum.modules.find((module) => module.id === sourceId);
  const target = curriculum.modules.find((module) => module.id === targetId);
  const lesson = source?.lessons.find((item) => item.id === lessonId);
  if (!lesson || !target || target.lessons.length >= maxModuleLessons)
    return curriculum;

  return {
    modules: curriculum.modules.map((module) => {
      if (module.id === sourceId)
        return {
          ...module,
          lessons: module.lessons.filter((item) => item.id !== lessonId),
        };
      if (module.id === targetId)
        return { ...module, lessons: [...module.lessons, lesson] };
      return module;
    }),
  };
}

type CurriculumItem = {
  kind: "curriculumModuleItem" | "curriculumLessonItem";
  title: string;
  archived: boolean;
  position: string;
  content: string;
};

/** Index by stable ID so moving a lesson across modules retains its identity. */
function indexCurriculum(curriculum: CourseCurriculum) {
  const index = new Map<string, CurriculumItem>();
  curriculum.modules.forEach((module, position) => {
    index.set(module.id, {
      kind: "curriculumModuleItem",
      title: module.title,
      archived: Boolean(module.archived),
      position: String(position),
      content: module.description,
    });
    module.lessons.forEach((lesson, lessonPosition) => {
      index.set(lesson.id, {
        kind: "curriculumLessonItem",
        title: lesson.title,
        archived: Boolean(lesson.archived),
        position: `${module.id}:${lessonPosition}`,
        content: JSON.stringify([
          lesson.objectives,
          lesson.duration_minutes,
          lesson.body,
          lesson.material_ids ?? [],
          lesson.blocks ?? [],
        ]),
      });
    });
  });
  return index;
}

/** Describe additions, removals and edited fields without copying private draft text. */
export function compareCourseCurricula(
  published: CourseCurriculum,
  draft: CourseCurriculum,
) {
  const before = indexCurriculum(published);
  const after = indexCurriculum(draft);
  return [...new Set([...after.keys(), ...before.keys()])].flatMap((id) => {
    const oldItem = before.get(id);
    const newItem = after.get(id);
    const item = newItem ?? oldItem!;
    const previousTitle =
      oldItem && newItem && oldItem.title !== newItem.title
        ? oldItem.title
        : null;
    const fieldChanges: string[] = [];
    if (!oldItem) fieldChanges.push("curriculumChangeAdded");
    else if (!newItem) fieldChanges.push("curriculumChangeRemoved");
    else {
      if (previousTitle !== null) fieldChanges.push("curriculumChangeTitle");
      if (oldItem.position !== newItem.position)
        fieldChanges.push("curriculumChangeMoved");
      if (oldItem.content !== newItem.content)
        fieldChanges.push("curriculumChangeContent");
      if (oldItem.archived !== newItem.archived)
        fieldChanges.push(
          newItem.archived
            ? "curriculumChangeArchived"
            : "curriculumChangeRestored",
        );
    }
    return fieldChanges.length
      ? [
          {
            id,
            kind: item.kind,
            title: item.title,
            previousTitle,
            fieldChanges,
          },
        ]
      : [];
  });
}
