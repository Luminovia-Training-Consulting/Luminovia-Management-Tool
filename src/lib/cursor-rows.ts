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
  return [...unique.values()].sort(
    (a, b) =>
      direction *
      (a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)),
  );
}
