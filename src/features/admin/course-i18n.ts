/**
 * DE/EN UI resources for the courseOffer namespace. Module import registers these strings with
 * i18next; authored business content is not translated.
 */
import i18n from "../../lib/i18n";

const en = {
  fromCourse: "Teaching offer from this course",
  sourceHelp:
    "Content, company and sessions come from the selected course. Set the fee and assignment terms here. Adjust delivery and scheduling in course planning.",
  plan: "Open course planning",
  openJob: "Open created teaching offer",
  sourceChanged:
    "The course changed since this preview. Review the current course and reopen its teaching-offer form.",
  exists:
    "This course already has an active teaching offer. Open its existing offer instead of creating another one.",
  customerRequired:
    "Assign an active company to the course before creating its teaching offer.",
};
const de: typeof en = {
  fromCourse: "Auftrag aus diesem Kurs",
  sourceHelp:
    "Inhalte, Unternehmen und Termine stammen aus dem gewählten Kurs. Ergänze hier das Honorar und die Auftragsbedingungen. Durchführung und Zeitplan passen sich in der Kursplanung an.",
  plan: "Kursplanung öffnen",
  openJob: "Erstellten Auftrag öffnen",
  sourceChanged:
    "Der Kurs wurde seit dieser Vorschau geändert. Prüfe den aktuellen Kurs und öffne sein Auftragsformular erneut.",
  exists:
    "Für diesen Kurs gibt es bereits einen aktiven Auftrag. Öffne den vorhandenen Auftrag, statt einen weiteren anzulegen.",
  customerRequired:
    "Ordne dem Kurs vor der Auftragserstellung ein aktives Unternehmen zu.",
};
i18n.addResourceBundle("de", "courseOffer", de, true, true);
i18n.addResourceBundle("en", "courseOffer", en, true, true);
