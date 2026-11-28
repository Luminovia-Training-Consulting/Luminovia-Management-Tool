/** Keep editor-only drafts in the current actor and course route, outside its connection boundary. */
import { createContext, type Dispatch, type SetStateAction } from "react";
import type { CourseCurriculum } from "./course-authoring-schema";

export type LocalCourseDraft = {
  content: CourseCurriculum;
  base: CourseCurriculum;
  published_version: number;
  draft_version: number;
};

export const CourseDraftContext = createContext<
  | [LocalCourseDraft | null, Dispatch<SetStateAction<LocalCourseDraft | null>>]
  | null
>(null);

export const ClearCourseDraftContext = createContext<(() => void) | null>(null);
