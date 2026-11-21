import i18n from "../../lib/i18n";

const pairs: Record<string, [string, string]> = {
  title: ["Kurs-Chat", "Course chat"],
  emptyRooms: [
    "Für diesen Kurs ist noch kein Chat freigegeben.",
    "No chat is available for this course yet.",
  ],
  emptyMessages: ["Noch keine Nachrichten.", "No messages yet."],
  latest: ["Die neuesten 50 Nachrichten", "Latest 50 messages"],
  readOnly: [
    "Du kannst die Nachrichten dieses Kurses lesen.",
    "You can read messages for this course.",
  ],
  message: ["Nachricht", "Message"],
  send: ["Nachricht senden", "Send message"],
  unavailable: [
    "Der Kurs-Chat ist derzeit nicht verfügbar. Deine Berechtigung könnte sich geändert haben.",
    "The course chat is unavailable. Your access may have changed.",
  ],
  failed: [
    "Die Nachricht wurde nicht bestätigt. Bitte erneut versuchen.",
    "The message was not confirmed. Please retry.",
  ],
  attach: ["Datei anhängen", "Attach file"],
  singleAttachment: [
    "Bitte nur eine Datei anhängen.",
    "Attach one file at a time.",
  ],
  removeAttachment: ["Anhang entfernen", "Remove attachment"],
  scanProgress: [
    "Datei wird übertragen und geprüft ({{progress}} %).",
    "Uploading and scanning file ({{progress}}%).",
  ],
  uploadFailed: [
    "Der Anhang wurde nicht freigegeben.",
    "The attachment was not cleared.",
  ],
  retryUpload: ["Datei erneut versuchen", "Retry file upload"],
  downloadAttachment: ["{{name}} herunterladen", "Download {{name}}"],
  downloadFailed: [
    "Der Anhang ist nicht verfügbar.",
    "The attachment is unavailable.",
  ],
  deleted: ["Nachricht gelöscht", "Message deleted"],
};

for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "courseChat",
    Object.fromEntries(
      Object.entries(pairs).map(([key, value]) => [key, value[index]]),
    ),
    true,
    true,
  );
