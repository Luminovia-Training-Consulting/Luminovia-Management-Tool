/**
 * DE/EN UI resources for the courseOffer namespace. Module import registers these strings with
 * i18next; authored business content is not translated.
 */
import i18n from "../../lib/i18n";

const en = {
  fromCourse: "Teaching offer from this course",
  sourceHelp:
    "Content, company and sessions come from the selected course. Set the fee here. For a separate group with its own schedule, duplicate the course run in course planning.",
  plan: "Open course planning",
  openJob: "Open created teaching offer",
  publishOffer: "Publish in the marketplace",
  saveOfferDraft: "Save as draft",
  publishedOffer: "Offer published in the marketplace.",
  savedOfferDraft: "Saved as a draft. Open the saved offer or publish it now.",
  openOfferDraft: "Open draft",
  sourceChanged:
    "The course changed since this preview. Review the current course and reopen its teaching-offer form.",
  schedule: "Scheduled course sessions",
  optionalTerms: "Terms (optional)",
  addAnother: "Create another offer for this course",
  customerRequired:
    "Assign an active company to the course before creating its teaching offer.",
};
const de: typeof en = {
  fromCourse: "Auftrag aus diesem Kurs",
  sourceHelp:
    "Inhalte, Unternehmen und Termine stammen aus dem gewählten Kurs. Trage hier das Honorar ein. Für eine separate Gruppe mit eigenem Zeitplan kannst du die Durchführung in der Kursplanung duplizieren.",
  plan: "Kursplanung öffnen",
  openJob: "Erstellten Auftrag öffnen",
  publishOffer: "In der Stellenbörse veröffentlichen",
  saveOfferDraft: "Als Entwurf speichern",
  publishedOffer: "Auftrag in der Stellenbörse veröffentlicht.",
  savedOfferDraft:
    "Als Entwurf gespeichert. Du kannst den gespeicherten Auftrag jetzt öffnen oder direkt veröffentlichen.",
  openOfferDraft: "Entwurf öffnen",
  sourceChanged:
    "Der Kurs wurde seit dieser Vorschau geändert. Prüfe den aktuellen Kurs und öffne sein Auftragsformular erneut.",
  schedule: "Geplante Kurstermine",
  optionalTerms: "Konditionen (optional)",
  addAnother: "Weiteren Auftrag für diesen Kurs erstellen",
  customerRequired:
    "Ordne dem Kurs vor der Auftragserstellung ein aktives Unternehmen zu.",
};
i18n.addResourceBundle("de", "courseOffer", de, true, true);
i18n.addResourceBundle("en", "courseOffer", en, true, true);
