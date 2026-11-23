/**
 * DE/EN UI resources for the courseOffer namespace. Module import registers these strings with
 * i18next; authored business content is not translated.
 */
import i18n from "../../lib/i18n";

const en = {
  fromCourse: "Teaching offer from this course",
  sourceHelp:
    "The course supplies the company and sessions. Edit the listing text and fee below. Once published, the offer appears in the marketplace for eligible lecturers.",
  listingHeading: "Marketplace listing",
  listingTitle: "Listing title",
  listingDescription: "Listing description",
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
    "Unternehmen und Termine stammen aus dem gewählten Kurs. Bearbeite hier Anzeigentext und Honorar. Nach der Veröffentlichung sehen berechtigte Dozierende den Auftrag in der Stellenbörse.",
  listingHeading: "Stellenanzeige",
  listingTitle: "Titel der Stellenanzeige",
  listingDescription: "Beschreibung der Stellenanzeige",
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
