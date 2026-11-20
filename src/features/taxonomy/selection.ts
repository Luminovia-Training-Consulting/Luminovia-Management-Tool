/**
 * Select active catalogue entries while retaining already referenced archived IDs. Opening an
 * editor must not erase historical qualification/template links.
 */
/** Retain historical choices for explicit removal; never offer a new archived ID. */
export function selectableTopics<
    T extends { id: string; archived_at?: string | null },
>(topics: readonly T[], selected: readonly string[] = []): T[] {
    // Archival prevents new selections; it must not silently delete existing
    // evidence or template references the next time a form opens.
    const retained = new Set(selected);
    return topics.filter((topic) => !topic.archived_at || retained.has(topic.id));
}