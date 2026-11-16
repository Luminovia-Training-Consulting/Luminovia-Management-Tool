/**
 * Auswahllogik für aktive Katalogeinträge unter Erhalt bereits referenzierter archivierter IDs. Historische Qualifikationen und Vorlagen verlieren dadurch beim bloßen Öffnen eines Editors keine bestehende Referenz.
 */
/** Retain historical choices for explicit removal; never offer a new archived ID. */
/** Bietet aktive Themen sowie ausdrücklich bereits ausgewählte archivierte IDs an. */
export function selectableTopics<
  T extends { id: string; archived_at?: string | null },
>(topics: readonly T[], selected: readonly string[] = []): T[] {
  // Archivierung verhindert neue Auswahl, löscht aber nicht still bestehende
  // Nachweise oder Vorlagenreferenzen beim nächsten Öffnen des Formulars.
  const retained = new Set(selected);
  return topics.filter((topic) => !topic.archived_at || retained.has(topic.id));
}
