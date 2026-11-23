import i18n from "../../lib/i18n";

const words = {
  title: ["Dateianhänge", "Attachments"],
  hint: [
    "Anhänge gelten für diese Artikelfassung. Eine Veröffentlichung gibt die geprüfte Dateiversion für berechtigte Leser:innen frei.",
    "Attachments belong to this article revision. Publishing shares the scanned file version with authorized readers.",
  ],
  draftFirst: [
    "Speichere zunächst einen neuen Entwurf, um Anhänge zu ändern.",
    "Save a new draft before changing attachments.",
  ],
  file: [
    "Datei für den Artikelentwurf auswählen",
    "Choose a file for the article draft",
  ],
  upload: ["Datei prüfen und anhängen", "Scan and attach file"],
  remove: ["Anhang {{name}} entfernen", "Remove attachment {{name}}"],
  download: ["Anhang {{name}} herunterladen", "Download attachment {{name}}"],
  empty: [
    "Keine Anhänge in dieser Fassung.",
    "No attachments in this revision.",
  ],
  error: [
    "Der Vorgang wurde nicht bestätigt. Bitte prüfe den Entwurf und versuche es erneut.",
    "The operation was not confirmed. Check the draft and try again.",
  ],
  working: ["Datei wird geprüft …", "Checking file …"],
};
for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "wikiAttachments",
    Object.fromEntries(
      Object.entries(words).map(([key, pair]) => [key, pair[index]]),
    ),
    true,
    true,
  );
