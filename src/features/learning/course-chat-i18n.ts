import i18n from "../../lib/i18n";

const pairs: Record<string, [string, string]> = {
  title: ["Kurs-Chat", "Course chat"],
  emptyRooms: [
    "Für diesen Kurs ist noch kein Chat freigegeben.",
    "No chat is available for this course yet.",
  ],
  create: ["Kurs-Chat öffnen", "Open course chat"],
  createFailed: [
    "Der Kurs-Chat konnte nicht geöffnet werden. Prüfe deine Berechtigung und den Status der Akademie.",
    "The course chat could not be opened. Check your access and academy status.",
  ],
  emptyMessages: ["Noch keine Nachrichten.", "No messages yet."],
  latest: ["Neueste Nachrichten", "Latest messages"],
  earlier: ["Frühere Nachrichten", "Earlier messages"],
  olderMessages: ["Ältere Nachrichten laden", "Load older messages"],
  latestMessages: ["Zu den neuesten Nachrichten", "Back to latest messages"],
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
  protectionTitle: [
    "Spam-Schutz für Kurs-Chats",
    "Course chat spam protection",
  ],
  protectionHint: [
    "Mit Spam-Schutz kann jede Person in den Kurs-Chats eines Unternehmens acht Nachrichten pro Minute senden.",
    "With spam protection, each person can send eight messages per minute across a company's course chats.",
  ],
  protectionGlobal: ["Für alle Unternehmen", "For all companies"],
  protectionCompany: ["Für dieses Unternehmen", "For this company"],
  protectionOn: ["An", "On"],
  protectionOff: ["Aus", "Off"],
  protectionGlobalEnforced: [
    "Der Spam-Schutz gilt für alle Unternehmen.",
    "Spam protection applies to all companies.",
  ],
  protectionSaved: ["Spam-Schutz gespeichert.", "Spam protection saved."],
  protectionFailed: [
    "Die Einstellung konnte nicht gespeichert werden. Prüfe den aktuellen Wert und versuche es erneut.",
    "The setting could not be saved. Check its current value and try again.",
  ],
  protectionRateLimit: [
    "Zu viele Kurs-Chat-Nachrichten. Dein Entwurf bleibt erhalten. Versuche es in einer Minute erneut.",
    "Too many course chat messages. Your draft is still here. Try again in a minute.",
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
