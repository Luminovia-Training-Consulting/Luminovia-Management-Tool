/** Register the bilingual labels and safe failure states for revision-scoped wiki template links. */
import i18n from "../../lib/i18n";

const words = {
  title: ["Kursvorlagen", "Course templates"],
  companyContext: [
    "Firmenkontext für Kursvorlagen",
    "Company context for course templates",
  ],
  globalContext: ["Globale Redaktion", "Global editorial context"],
  hint: [
    "Verknüpfte Vorlagen öffnen sich nur, wenn du sie aktuell lesen darfst.",
    "Linked templates open only when you currently have permission to read them.",
  ],
  choose: [
    "Lesbare Kursvorlage auswählen",
    "Choose a readable course template",
  ],
  add: ["Verknüpfung hinzufügen", "Add reference"],
  empty: ["Keine Kursvorlagen verknüpft.", "No course templates are linked."],
  none: [
    "Keine weiteren lesbaren Vorlagen verfügbar.",
    "No more readable templates are available.",
  ],
  limit: [
    "Pro Artikelfassung sind höchstens 20 Vorlagen möglich.",
    "A revision can link to at most 20 templates.",
  ],
  archived: ["Archiviert", "Archived"],
  remove: ["Verknüpfung zu {{name}} entfernen", "Remove reference to {{name}}"],
  draftFirst: [
    "Speichere zuerst einen neuen Entwurf, um Verknüpfungen zu ändern.",
    "Save a new draft before changing references.",
  ],
  loading: ["Kursvorlagen werden geladen …", "Loading course templates …"],
  error: [
    "Die Verknüpfung wurde nicht bestätigt. Der aktuelle Stand wird neu geladen.",
    "The reference was not confirmed. The current state is being reloaded.",
  ],
  stale: [
    "Der Artikel wurde zwischenzeitlich geändert. Prüfe die aktuelle Fassung, bevor du es erneut versuchst.",
    "The article changed in the meantime. Review the current revision before trying again.",
  ],
  full: [
    "Die Höchstzahl ist erreicht. Entferne zuerst eine Verknüpfung.",
    "The limit is reached. Remove a reference before adding another.",
  ],
} as const;

for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "wikiCourseTemplates",
    Object.fromEntries(
      Object.entries(words).map(([key, pair]) => [key, pair[index]]),
    ),
    true,
    true,
  );
