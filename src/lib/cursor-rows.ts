import { compareInstantPoints, parseInstantPoint } from "./dates";

/** Keep the first version of an overlapping row and preserve cursor tie order. */
export function orderedCursorRows<T extends { id: string; created_at: string }>(
  pages: T[][] | undefined,
  order: "ascending" | "descending",
) {
  const unique = new Map<string, T>();
  for (const page of pages ?? []) {
    for (const row of page) {
      if (!unique.has(row.id)) unique.set(row.id, row);
    }
  }
  const direction = order === "ascending" ? 1 : -1;
  return Array.from(unique.values(), (row) => ({
    row,
    instant: parseInstantPoint(row.created_at),
  }))
    .sort((a, b) => {
      if (a.instant && b.instant)
        return (
          direction *
          (compareInstantPoints(a.instant, b.instant) ||
            a.row.id.localeCompare(b.row.id))
        );

      // Place unparseable timestamps after dated rows in either view.
      if (a.instant) return -1;
      if (b.instant) return 1;
      return (
        direction *
        (a.row.created_at.localeCompare(b.row.created_at) ||
          a.row.id.localeCompare(b.row.id))
      );
    })
    .map(({ row }) => row);
}

/** Merge overlapping cursor pages in server order, preserving the first position of each key. */
export function mergeCursorItems<T extends { id: string }>(
  pages: readonly { items: readonly T[] }[] | undefined,
  {
    key = (row) => row.id,
    preferLast = false,
  }: { key?: (row: T) => string; preferLast?: boolean } = {},
) {
  const rows = new Map<string, T>();
  for (const page of pages ?? []) {
    for (const row of page.items) {
      const id = key(row);
      if (preferLast || !rows.has(id)) rows.set(id, row);
    }
  }
  return Array.from(rows.values());
}
