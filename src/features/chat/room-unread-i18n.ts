import i18n from "../../lib/i18n";
const pairs: Record<string, [string, string]> = {
  mark: ["{{title}} als ungelesen markieren", "Mark {{title}} unread"],
  clear: ["{{title}} als gelesen markieren", "Mark {{title}} read"],
  marked: ["Als ungelesen markiert", "Marked unread"],
  closeFirst: [
    "Schließe zuerst die offene Unterhaltung.",
    "Close the open conversation first.",
  ],
  failed: [
    "Der Lesestatus konnte nicht bestätigt werden.",
    "The read status could not be confirmed.",
  ],
};
for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "chatRoomUnread",
    Object.fromEntries(
      Object.entries(pairs).map(([key, pair]) => [key, pair[index]]),
    ),
    true,
    true,
  );
