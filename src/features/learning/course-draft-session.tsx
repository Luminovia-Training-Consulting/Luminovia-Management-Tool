/** Preserve an unsaved curriculum only during the current actor and course route. */
import {
  useCallback,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  ClearCourseDraftContext,
  CourseDraftContext,
  type LocalCourseDraft,
} from "./course-draft-context";

function emptyDraftScope(scope: string) {
  return { scope, visit: Symbol(), draft: null as LocalCourseDraft | null };
}

export function CourseDraftSession({
  scope,
  children,
}: {
  scope: string;
  children: ReactNode;
}) {
  const [entry, setEntry] = useState(() => emptyDraftScope(scope));
  if (entry.scope !== scope) setEntry(emptyDraftScope(scope));
  const { draft, visit } = entry;
  const setDraft = useCallback(
    (update: SetStateAction<LocalCourseDraft | null>) => {
      setEntry((current) => {
        // An earlier editor's pending reply cannot mutate a different visit.
        if (current.visit !== visit) return current;
        const next =
          typeof update === "function" ? update(current.draft) : update;
        return next === current.draft ? current : { ...current, draft: next };
      });
    },
    [visit],
  );
  const clearDraft = useCallback(() => setDraft(null), [setDraft]);
  return (
    <ClearCourseDraftContext.Provider value={clearDraft}>
      <CourseDraftContext.Provider value={[draft, setDraft]}>
        {children}
      </CourseDraftContext.Provider>
    </ClearCourseDraftContext.Provider>
  );
}
