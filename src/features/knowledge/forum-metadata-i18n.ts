import i18n from "../../lib/i18n";

const pairs = {
  editThread: ["Thema bearbeiten", "Edit thread"],
  description: [
    "Ändere Titel oder Kategorie. Beiträge und Antworten bleiben erhalten.",
    "Change the title or category. Posts and replies are preserved.",
  ],
  changed: [
    "Das Thema wurde inzwischen geändert. Dein Entwurf bleibt erhalten; schließe den Dialog und öffne ihn erneut, um die aktuelle Version zu laden.",
    "The thread changed. Your draft is preserved; close and reopen the dialog to load the current version.",
  ],
  invalid: [
    "Bitte einen Titel und eine aktive Kategorie auswählen.",
    "Enter a title and choose an active category.",
  ],
  failed: [
    "Die Änderung wurde nicht bestätigt. Dein Entwurf bleibt erhalten.",
    "The change was not confirmed. Your draft is preserved.",
  ],
} as const;
for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "forumMetadata",
    Object.fromEntries(
      Object.entries(pairs).map(([key, pair]) => [key, pair[index]]),
    ),
    true,
    true,
  );
