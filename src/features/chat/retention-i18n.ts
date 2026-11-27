import i18n from "../../lib/i18n";

const pairs = {
  globalTitle: ["Globale Löschfristen", "Global retention"],
  roomTitle: ["Löschfrist für diesen Chat", "Retention for this chat"],
  policy: ["Nachrichten automatisch löschen", "Automatically delete messages"],
  inherit: ["Globale Einstellung übernehmen", "Use the global setting"],
  disabled: ["Keine automatische Löschung", "No automatic deletion"],
  hours8: ["Nach 8 Stunden", "After 8 hours"],
  hours168: ["Nach 7 Tagen", "After 7 days"],
  hours336: ["Nach 14 Tagen", "After 14 days"],
  effective: ["Aktuell gilt {{period}}.", "Currently applied: {{period}}."],
  description: [
    "Die Frist gilt für den bisherigen und den neuen Nachrichtenverlauf. Eine Einstellung im Chat hat Vorrang vor der globalen Einstellung.",
    "Retention applies to existing and new message history. A chat override takes precedence over the global setting.",
  ],
  confirm: [
    "Ich bestätige, dass bereits ältere Nachrichten dadurch endgültig gelöscht werden können.",
    "I confirm that this can permanently delete existing older messages.",
  ],
  attachments: [
    "Verknüpfte Dateien werden über ihre eigene Dateiverwaltung gelöscht.",
    "Linked files are deleted through their own file controls.",
  ],
  failed: [
    "Die Einstellung konnte nicht gespeichert werden.",
    "The retention setting could not be saved.",
  ],
  conflict: [
    "Die Einstellung wurde inzwischen geändert. Lade sie neu und prüfe deine Auswahl.",
    "The setting has changed. Reload it and review your selection.",
  ],
  save: ["Löschfrist speichern", "Save retention setting"],
} as const;

for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "chatRetention",
    Object.fromEntries(
      Object.entries(pairs).map(([key, pair]) => [key, pair[index]]),
    ),
    true,
    true,
  );
