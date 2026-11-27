/** Bilingual workflow labels for internal course and offer drafts. */
import i18n from "../../lib/i18n";

const labels = {
  offerLibrary: ["Gespeicherte Angebotsentwürfe", "Saved offer drafts"],
  offerLibraryDescription: [
    "Setze einen eigenen Entwurf fort oder öffne den bereits angelegten Auftrag.",
    "Resume your own draft or open the confirmed assignment.",
  ],
  offerCopy: ["Kopieren", "Duplicate"],
  offerDelete: ["Löschen", "Delete"],
  newOfferDraft: ["Neuen Entwurf beginnen", "Start a new draft"],
  untitledOffer: ["Angebotsentwurf ohne Titel", "Untitled offer draft"],
  openAssignment: ["Auftrag ansehen", "View assignment"],
  acceptCourseRevision: [
    "Aktuellen Kursstand übernehmen",
    "Use the current course revision",
  ],
  library: ["Kurs- und Auftragsentwürfe", "Course and assignment drafts"],
  start: [
    "Kurs- und Auftragsassistent starten",
    "Start the course and assignment creator",
  ],
  empty: ["Keine gespeicherten Entwürfe.", "No saved drafts."],
  untitled: ["Kursentwurf ohne Titel", "Untitled course draft"],
  resume: ["Weiterbearbeiten", "Resume"],
  duplicate: ["Entwurf kopieren", "Duplicate draft"],
  discard: ["Entwurf löschen", "Delete draft"],
  discardDescription: [
    "Der gespeicherte Entwurf wird gelöscht.",
    "The saved draft will be deleted.",
  ],
  cancel: ["Abbrechen", "Cancel"],
  openCourse: ["Kurs ansehen", "View course"],
  continueOffer: [
    "Lehrauftrag weiter vorbereiten",
    "Continue preparing the teaching offer",
  ],
  reloadDraft: ["Gespeicherten Stand laden", "Load saved revision"],
  saveDraft: ["Zwischenstand speichern", "Save progress"],
  unchanged: [
    "Entwurf noch ohne Zwischenstand.",
    "Draft has no saved progress yet.",
  ],
  unsaved: ["Änderungen noch offen.", "Changes are unsaved."],
  saving: ["Entwurf wird gespeichert …", "Saving draft…"],
  saved: ["Entwurf auf dem Server gespeichert.", "Draft saved on the server."],
  conflict: [
    "Dieser Entwurf wurde in einem anderen Fenster geändert. Lade die gespeicherte Fassung, um weiterzuarbeiten.",
    "This draft changed in another window. Load the saved revision to continue.",
  ],
  error: [
    "Der Vorgang konnte nicht bestätigt werden. Prüfe den Entwurf und versuche es erneut.",
    "The operation could not be confirmed. Check the draft and try again.",
  ],
  offline: [
    "Offline. Änderungen können derzeit nicht auf dem Server gespeichert werden.",
    "Offline. Changes cannot currently be saved on the server.",
  ],
  information: ["Kursinformationen", "Course information"],
  enquirySourceConflict: [
    "Die Kundenanfrage wurde geändert. Öffne den aktuellen Stand im Anfragepostfach.",
    "The customer enquiry changed. Open the current revision from the enquiry inbox.",
  ],
  backToEnquiries: ["Anfragepostfach öffnen", "Open enquiry inbox"],
  enquirySourceReview: [
    "Prüfe die übernommenen Texte auf private Angaben, bevor du den Kurs anlegst.",
    "Review the imported text for private details before creating the course.",
  ],
  schedule: ["Termine und Durchführung", "Schedule and delivery"],
  review: [
    "Kurs anlegen und nächsten Schritt wählen",
    "Create the course and choose the next step",
  ],
  offerHint: [
    "Die Vergütung und Freigabe folgen im Lehrauftrag. Teilnehmendenzugriff wird separat eingerichtet.",
    "Configure remuneration and publication in the teaching offer. Participant access is configured separately.",
  ],
  backToDrafts: ["Zur Kursübersicht", "Back to courses"],
} as const;

for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "courseCreator",
    Object.fromEntries(
      Object.entries(labels).map(([key, values]) => [key, values[index]]),
    ),
    true,
    true,
  );
