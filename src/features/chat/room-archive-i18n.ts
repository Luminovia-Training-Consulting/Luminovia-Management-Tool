import i18n from "../../lib/i18n";
const pairs = {
  filter: ["Unterhaltungen filtern", "Filter conversations"],
  active: ["Aktiv", "Active"],
  archived: ["Archiviert", "Archived"],
  archive: ["{{title}} persönlich archivieren", "Archive {{title}} for me"],
  restore: [
    "{{title}} persönlich wiederherstellen",
    "Restore {{title}} for me",
  ],
  closeFirst: [
    "Schließe diese Unterhaltung vor dem Archivieren.",
    "Close this conversation before archiving it.",
  ],
  empty: ["Keine archivierten Unterhaltungen", "No archived conversations"],
  emptyHint: [
    "Persönlich archivierte Unterhaltungen erscheinen hier.",
    "Conversations you archive appear here.",
  ],
  failed: [
    "Die Archivierung konnte nicht bestätigt werden. Bitte versuche es erneut.",
    "The archive change could not be confirmed. Please try again.",
  ],
} as const;
for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "chatRoomArchive",
    Object.fromEntries(
      Object.entries(pairs).map(([key, pair]) => [key, pair[index]]),
    ),
    true,
    true,
  );
