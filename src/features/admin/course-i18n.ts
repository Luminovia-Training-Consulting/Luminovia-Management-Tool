/**
 * DE/EN UI resources for the courseOffer namespace. Module import registers these strings with
 * i18next; authored business content is not translated.
 */
import i18n from "../../lib/i18n";

const en = {
  fromCourse: "Teaching offer from this course",
  sourceHelp:
    "The course supplies the company and sessions. Choose the audience and edit the listing details below. Once published, the offer appears in the marketplace for eligible lecturers.",
  listingHeading: "Marketplace listing",
  listingTitle: "Listing title",
  listingDescription: "Listing description",
  plan: "Open course planning",
  openJob: "Open created teaching offer",
  publishOffer: "Publish in the marketplace",
  saveOfferDraft: "Save as draft",
  publishedOffer: "Offer published in the marketplace.",
  savedOfferDraft:
    "Saved as a draft. Open the saved offer or review it for publication.",
  openOfferDraft: "Open draft",
  draftExists:
    "A draft already exists for this course. Open it to edit or publish it.",
  sourceChanged:
    "The course changed since this preview. Review the current course and reopen its teaching-offer form.",
  schedule: "Scheduled course sessions",
  optionalTerms: "Terms (optional)",
  addAnother: "Create another offer for this course",
  companyOnly: "List for company lecturers only",
  companyRosterNeeded:
    "Add an active lecturer to the company roster to use internal staffing.",
  publishedCompanyOffer: "Internal teaching offer published.",
  saveAndReview: "Save and review offer",
  reviewOffer: "Review teaching offer",
  reviewOfferHint:
    "Check the audience, billing and current availability for the entire schedule.",
  reviewAudience: "Audience",
  reviewCompany: "Company lecturers",
  reviewMarketplace: "Eligible marketplace lecturers",
  reviewBilling: "Billing",
  reviewPaid: "Billable teaching assignment",
  reviewNoBilling: "No fee or invoice in the portal",
  reviewEligible:
    "At least one eligible lecturer is available for the full schedule.",
  reviewNoEligible:
    "No lecturer currently meets all conditions for the full schedule. You can publish the offer and fill it later.",
  reviewBlocked:
    "This draft cannot be published. Check the roster, course dates and claim deadline.",
  reviewRefreshRequired:
    "Publication could not be confirmed. Retry the same submission or reload the preview.",
  publishCompanyOffer: "Publish internal teaching offer",
  customerRequired:
    "Assign an active company to the course before creating its teaching offer.",
};
const de: typeof en = {
  fromCourse: "Auftrag aus diesem Kurs",
  sourceHelp:
    "Unternehmen und Termine stammen aus dem gewählten Kurs. Wähle hier die Zielgruppe und bearbeite den Anzeigentext. Nach der Veröffentlichung sehen berechtigte Dozierende den Auftrag in der Stellenbörse.",
  listingHeading: "Stellenanzeige",
  listingTitle: "Titel der Stellenanzeige",
  listingDescription: "Beschreibung der Stellenanzeige",
  plan: "Kursplanung öffnen",
  openJob: "Erstellten Auftrag öffnen",
  publishOffer: "In der Stellenbörse veröffentlichen",
  saveOfferDraft: "Als Entwurf speichern",
  publishedOffer: "Auftrag in der Stellenbörse veröffentlicht.",
  savedOfferDraft:
    "Als Entwurf gespeichert. Du kannst den gespeicherten Auftrag jetzt öffnen oder zur Veröffentlichung prüfen.",
  openOfferDraft: "Entwurf öffnen",
  draftExists:
    "Für diesen Kurs gibt es bereits einen Entwurf. Öffne ihn zum Bearbeiten oder Veröffentlichen.",
  sourceChanged:
    "Der Kurs wurde seit dieser Vorschau geändert. Prüfe den aktuellen Kurs und öffne sein Auftragsformular erneut.",
  schedule: "Geplante Kurstermine",
  optionalTerms: "Konditionen (optional)",
  addAnother: "Weiteren Auftrag für diesen Kurs erstellen",
  companyOnly: "Nur für eigene Dozierende ausschreiben",
  companyRosterNeeded:
    "Ordne dem Unternehmen mindestens eine aktive Lehrkraft zu, um intern auszuschreiben.",
  publishedCompanyOffer: "Interne Ausschreibung veröffentlicht.",
  saveAndReview: "Speichern und Ausschreibung prüfen",
  reviewOffer: "Ausschreibung prüfen",
  reviewOfferHint:
    "Prüfe Zielgruppe, Abrechnung und aktuelle Verfügbarkeit für den gesamten Terminblock.",
  reviewAudience: "Zielgruppe",
  reviewCompany: "Eigene Dozierende des Unternehmens",
  reviewMarketplace: "Berechtigte Dozierende der Stellenbörse",
  reviewBilling: "Abrechnung",
  reviewPaid: "Lehrauftrag mit Abrechnung",
  reviewNoBilling: "Kein Honorar und keine Rechnung im Portal",
  reviewEligible:
    "Mindestens eine geeignete Lehrkraft ist für den gesamten Terminblock verfügbar.",
  reviewNoEligible:
    "Aktuell erfüllt keine Lehrkraft alle Bedingungen für den gesamten Terminblock. Du kannst veröffentlichen und den Auftrag später besetzen.",
  reviewBlocked:
    "Dieser Entwurf kann noch nicht veröffentlicht werden. Prüfe Lehrteam, Kurstermine und Annahmefrist.",
  reviewRefreshRequired:
    "Die Veröffentlichung wurde nicht bestätigt. Wiederhole denselben Versuch oder lade die Vorschau neu.",
  publishCompanyOffer: "Interne Ausschreibung veröffentlichen",
  customerRequired:
    "Ordne dem Kurs vor der Auftragserstellung ein aktives Unternehmen zu.",
};
i18n.addResourceBundle("de", "courseOffer", de, true, true);
i18n.addResourceBundle("en", "courseOffer", en, true, true);
