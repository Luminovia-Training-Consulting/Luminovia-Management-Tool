import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import type { CourseBulkArchiveItem } from "./course-bulk-archive-schema";

export function useCourseBulkArchive(
  items: CourseBulkArchiveItem[],
  onSaved?: () => void,
) {
  const client = useQueryClient();
  const [selected, setSelected] = useState<Map<string, CourseBulkArchiveItem>>(
    new Map(),
  );
  const [preview, setPreview] = useState<{
    archive: boolean;
    items: CourseBulkArchiveItem[];
  }>();
  const displayed = new Map(items.map((item) => [item.id, item]));
  const selection = [...selected.values()].map(
    (item) => displayed.get(item.id) ?? item,
  );
  const save = useMutation({
    mutationFn: async (review: NonNullable<typeof preview>) => {
      requireOnline();
      const { data, error } = await db().rpc("archive_course_runs", {
        p_items: review.items.map(
          ({ id, published, archived_at, organisation_id }) => ({
            id,
            published,
            archived_at,
            organisation_id,
          }),
        ),
        p_archive: review.archive,
      });
      if (error) throw error;
      if (data !== review.items.length)
        throw new Error("invalid_archive_receipt");
    },
    onSuccess: async () => {
      setPreview(undefined);
      setSelected(new Map());
      await Promise.all([
        client.invalidateQueries({ queryKey: ["operations"] }),
        client.invalidateQueries({ queryKey: ["course-workspaces"] }),
        client.invalidateQueries({ queryKey: ["course-workspace"] }),
        client.invalidateQueries({ queryKey: ["academy-course-archive"] }),
      ]);
      onSaved?.();
    },
  });
  return {
    selected,
    selection,
    preview,
    save,
    setSelected: (item: CourseBulkArchiveItem, checked: boolean) => {
      setSelected((current) => {
        const next = new Map(current);
        if (checked && next.size < 50) next.set(item.id, item);
        if (!checked) next.delete(item.id);
        return next;
      });
    },
    clear: () => setSelected(new Map()),
    review: (archive: boolean) => {
      save.reset();
      setPreview({ archive, items: selection });
    },
    close: () => setPreview(undefined),
  };
}
