import i18n from "../../lib/i18n";

const pairs: Record<string, [string, string]> = {
  title: ["Gruppeninformationen", "Group information"],
  hint: [
    "Name und Beschreibung sind für aktuelle Gruppenmitglieder sichtbar.",
    "The name and description are visible to current group members.",
  ],
  name: ["Gruppenname", "Group name"],
  description: ["Beschreibung", "Description"],
  empty: ["Keine Beschreibung vorhanden.", "No description provided."],
  edit: ["Gruppeninformationen bearbeiten", "Edit group information"],
  saved: ["Gruppeninformationen gespeichert.", "Group information saved."],
  invalid: ["Bitte gib einen Gruppennamen ein.", "Enter a group name."],
  conflict: [
    "Die Gruppeninformationen wurden inzwischen geändert. Schließe das Fenster und öffne es erneut, um den aktuellen Stand zu laden.",
    "The group information changed. Close and reopen this dialog to load the current version.",
  ],
  discard: ["Ungespeicherte Änderungen verwerfen?", "Discard unsaved changes?"],
  failed: [
    "Die Änderung konnte nicht bestätigt werden. Deine Eingaben bleiben erhalten.",
    "The change could not be confirmed. Your input is preserved.",
  ],
};
for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "chatGroupSettings",
    Object.fromEntries(
      Object.entries(pairs).map(([key, value]) => [key, value[index]]),
    ),
    true,
    true,
  );
