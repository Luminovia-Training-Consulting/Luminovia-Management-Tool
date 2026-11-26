/** German and English controls for the course question bank and quiz builder. */
import i18n from "../../lib/i18n";

const pairs = {
  questionBank: ["Fragenbank", "Question bank"],
  questionBankSearch: [
    "Fragen und Themen suchen",
    "Search questions and topics",
  ],
  questionBankIncludeArchived: [
    "Archivierte Fragen anzeigen",
    "Show archived questions",
  ],
  questionBankEmpty: [
    "Keine Fragen für diese Auswahl.",
    "No questions match this selection.",
  ],
  questionBankAdd: ["Bankfrage erstellen", "Create bank question"],
  questionBankEdit: ["Neue Fassung bearbeiten", "Edit as new revision"],
  questionBankSave: ["Fragenfassung speichern", "Save question revision"],
  questionBankCancel: ["Bearbeiten abbrechen", "Cancel editing"],
  questionBankUse: ["Ins Quiz übernehmen", "Add to quiz"],
  questionBankArchive: ["Archivieren", "Archive"],
  questionBankRestore: ["Wiederherstellen", "Restore"],
  questionBankArchived: ["Archiviert", "Archived"],
  questionBankTopic: ["Thema", "Topic"],
  questionBankDifficulty: ["Schwierigkeitsgrad", "Difficulty"],
  questionBankIntroductory: ["Grundlagen", "Introductory"],
  questionBankIntermediate: ["Fortgeschritten", "Intermediate"],
  questionBankAdvanced: ["Vertiefung", "Advanced"],
  questionBankRevision: ["Fassung {{revision}}", "Revision {{revision}}"],
  questionBankSource: [
    "Fragenbank · Fassung {{revision}}",
    "Question bank · revision {{revision}}",
  ],
  questionBankShuffle: [
    "Fragen für die neue Quizfassung mischen",
    "Shuffle questions for the new quiz revision",
  ],
  questionBankPrevious: ["Vorherige Seite", "Previous page"],
  questionBankNext: ["Nächste Seite", "Next page"],
  questionBankInvalid: [
    "Gib ein Thema, eine Frage und zwei bis sechs kurze Antworten an. Wähle die richtige Antwort.",
    "Enter a topic, a prompt and two to six short answers. Select the correct answer.",
  ],
  questionBankUnavailable: [
    "Die Fragenbank ist nur online verfügbar.",
    "The question bank is available online.",
  ],
  questionBankConflict: [
    "Die Fassung wurde inzwischen geändert. Lade den aktuellen Stand und wähle die Frage erneut.",
    "The revision has changed. Reload current data and select the question again.",
  ],
  questionBankReload: ["Aktuellen Stand laden", "Reload current data"],
} as const;

for (const [index, locale] of ["de", "en"].entries()) {
  i18n.addResourceBundle(
    locale,
    "learning",
    Object.fromEntries(
      Object.entries(pairs).map(([key, values]) => [key, values[index]]),
    ),
    true,
    true,
  );
}
