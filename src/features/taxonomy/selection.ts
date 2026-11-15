/** Retain historical choices for explicit removal; never offer a new archived ID. */
export function selectableTopics<
  T extends { id: string; archived_at?: string | null },
>(topics: readonly T[], selected: readonly string[] = []): T[] {
  const retained = new Set(selected);
  return topics.filter((topic) => !topic.archived_at || retained.has(topic.id));
}
