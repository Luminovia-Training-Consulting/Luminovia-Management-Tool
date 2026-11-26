import type { JSONContent } from "@tiptap/react";
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
};

export type CourseModule = {
  id: string;
  title: string;
  description: string;
  lessons: CourseLesson[];
};

export type CourseCurriculum = { modules: CourseModule[] };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const emptyCurriculum: CourseCurriculum = { modules: [] };

export function newCourseContentId() {
  return globalThis.crypto.randomUUID();
}

export function normalizeCourseCurriculum(value: unknown): CourseCurriculum {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid course curriculum");
  const modules = (value as { modules?: unknown }).modules;
  if (!Array.isArray(modules) || modules.length > 40)
    throw new Error("Invalid course modules");

  const ids = new Set<string>();
  const normalizedModules = modules.map((candidate): CourseModule => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      throw new Error("Invalid course module");
    const module = candidate as Record<string, unknown>;
    if (
      typeof module.id !== "string" ||
      !uuid.test(module.id) ||
      ids.has(module.id) ||
      typeof module.title !== "string" ||
      module.title.trim().length < 1 ||
      module.title.trim().length > 150 ||
      typeof module.description !== "string" ||
      module.description.length > 1000 ||
      !Array.isArray(module.lessons) ||
      module.lessons.length > 100
    )
      throw new Error("Invalid course module");
    ids.add(module.id);

    const lessons = module.lessons.map((lessonCandidate): CourseLesson => {
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
        ids.has(lesson.id) ||
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
      ids.add(lesson.id);
      const body = normalizedDocument(lesson.body as JSONContent);
      if (!contentIsValid(body, true))
        throw new Error("Invalid lesson content");
      return {
        id: lesson.id,
        title: lesson.title.trim(),
        objectives: lesson.objectives,
        duration_minutes: lesson.duration_minutes,
        body,
      };
    });

    return {
      id: module.id,
      title: module.title.trim(),
      description: module.description,
      lessons,
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
