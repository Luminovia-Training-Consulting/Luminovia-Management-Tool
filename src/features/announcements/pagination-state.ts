/** Keep only the cursor history needed to revisit previously loaded announcement pages. */
import { useState } from "react";
import type { AnnouncementCursor } from "./api";

/** Navigate server-supplied cursors and reset history when the active filter changes. */
export function useAnnouncementPagination() {
  const [history, setHistory] = useState<AnnouncementCursor[]>([]);
  return {
    cursor: history.at(-1) ?? null,
    previous: () => setHistory(history.slice(0, -1)),
    next: (cursor: AnnouncementCursor) => setHistory([...history, cursor]),
    reset: () => setHistory([]),
  };
}
