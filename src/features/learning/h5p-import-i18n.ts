/** Labels for the text-only H5P bank import and its published attribution. */
import i18n from "../../lib/i18n";

const labels = {
  h5pImportTitle: ["H5P importieren", "Import H5P"],
  h5pImportFile: ["H5P-Datei auswählen", "Choose H5P file"],
  h5pImportHelp: [
    "Importiere textbasierte Einzelwahl- und Wahr/Falsch-Fragen oder eine Sammlung mit maximal 20 Fragen. Prüfe die Lösungen und die Lizenz vor dem Speichern.",
    "Import text-only single-choice and true/false questions or a collection of up to 20 questions. Review the answers and licence before saving.",
  ],
  h5pImportSave: [
    "H5P-Frage in Fragenbank speichern",
    "Save H5P question to bank",
  ],
  h5pImportSaved: [
    "H5P-Frage in der Fragenbank gespeichert.",
    "H5P question saved to the bank.",
  ],
  h5pImportCollectionSave: [
    "Fragensammlung in Fragenbank speichern",
    "Save question collection to bank",
  ],
  h5pImportCollectionSaved_one: [
    "{{count}} H5P-Frage gespeichert.",
    "{{count}} H5P question saved.",
  ],
  h5pImportCollectionSaved_other: [
    "{{count}} H5P-Fragen gespeichert.",
    "{{count}} H5P questions saved.",
  ],
  h5pQuestionAttribution: [
    "Quelle der Teilfrage",
    "Individual question source",
  ],
  h5pCollectionConversion: [
    "Die Sammlung wird als einzelne Quizfragen importiert. Kursquiz, Punkte und Versuche folgen den Einstellungen des Portals.",
    "The collection imports as individual quiz questions. The course quiz uses the portal's scoring and attempt settings.",
  ],
  h5pImportArchived: [
    "Der zugehörige Fragenbankeintrag ist archiviert. Stelle ihn in der Fragenbank wieder her, um ihn zu verwenden.",
    "The associated bank entry is archived. Restore it in the question bank before using it.",
  ],
  h5pImportReading: ["H5P-Datei wird gelesen …", "Reading H5P file…"],
  h5pImportInvalidArchive: [
    "Die Datei ist kein lesbares H5P-Paket mit maximal 8 MiB.",
    "The file is not a readable H5P package within the 8 MiB limit.",
  ],
  h5pImportUnsupportedQuestion: [
    "Der Fragetyp oder die Inhalte werden für den Textimport nicht unterstützt.",
    "The question type or content is unsupported by the text importer.",
  ],
  h5pImportUnknownLicence: [
    "Die Datei braucht eine unterstützte, vollständige Lizenzangabe. Für CC BY 4.0 ist die Namensnennung erforderlich.",
    "The file needs supported, complete licence metadata. CC BY 4.0 requires an author credit.",
  ],
  h5pAttribution: ["Quelle und Lizenz", "Source and licence"],
  h5pAttributionSource: ["Originalquelle", "Original source"],
  h5pAttributionConversion: [
    "Für das LMS in eine Textfrage umgewandelt.",
    "Converted to a text question for the LMS.",
  ],
} as const;

for (const [index, locale] of ["de", "en"].entries()) {
  i18n.addResourceBundle(
    locale,
    "learning",
    Object.fromEntries(
      Object.entries(labels).map(([key, values]) => [key, values[index]]),
    ),
    true,
    true,
  );
}
