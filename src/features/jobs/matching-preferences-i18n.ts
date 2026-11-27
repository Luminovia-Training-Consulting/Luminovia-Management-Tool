/** Shared labels for private teaching preferences and authorised job eligibility. */
import i18n from "../../lib/i18n";

const labels = {
  preferences: [
    "Unterricht und Einsatzzeiten",
    "Teaching and availability preferences",
  ],
  formats: ["Bevorzugte Unterrichtsformate", "Preferred delivery formats"],
  online: ["Online", "Online"],
  onsite: ["Vor Ort", "On-site"],
  hybrid: ["Hybrid", "Hybrid"],
  languages: ["Unterrichtssprachen", "Teaching languages"],
  languagesHint: [
    "Für Deutsch de und für Englisch en eingeben. Mehrere Sprachcodes durch Leerzeichen oder Kommas trennen.",
    "Enter de for German and en for English. Separate multiple language codes with spaces or commas.",
  ],
  days: ["Bevorzugte Unterrichtstage", "Preferred teaching days"],
  start: ["Frühester Unterrichtsbeginn", "Earliest teaching start"],
  end: ["Spätestes Unterrichtsende", "Latest teaching end"],
  urgent: ["Kurzfristige Vertretungen erwünscht", "Interested in urgent cover"],
  hoursHint: [
    "Unterrichtszeiten beziehen sich auf deine Profilzeitzone.",
    "Teaching hours use the time zone in your profile.",
  ],
  requirements: [
    "Verbindliche Zuweisungsvoraussetzungen",
    "Mandatory assignment requirements",
  ],
  requireEvidence: [
    "Geprüften Zertifikatsnachweis verlangen",
    "Require reviewed certificate evidence",
  ],
  qualifications: ["Verifizierte Qualifikationen", "Verified qualifications"],
  qualificationHint: [
    "Alle gewählten Qualifikationen müssen bis zum Ende des letzten Termins gültig sein.",
    "Every selected qualification must remain valid through the end of the final session.",
  ],
  filter: ["Qualifikationen suchen", "Find a qualification"],
  protected: [
    "Voraussetzungen lassen sich im Auftragsentwurf bearbeiten.",
    "Requirements are editable while the assignment is a draft.",
  ],
  invalid: [
    "Prüfe Sprachcodes, Auswahl und Zeitangaben.",
    "Check the language codes, selections and teaching hours.",
  ],
  conflict: [
    "Die gespeicherte Fassung hat sich geändert. Lade sie erneut.",
    "The saved revision has changed. Load the latest revision.",
  ],
  saved: ["Gespeichert.", "Saved."],
  save: ["Speichern", "Save"],
  reload: ["Neu laden", "Reload"],
  error: ["Speichern fehlgeschlagen.", "Could not save."],
  subjectMatch: ["Passendes Fachgebiet", "Matching subject"],
  formatMatch: ["Bevorzugtes Format", "Preferred delivery format"],
  weekdaysMatch: ["Bevorzugte Unterrichtstage", "Preferred weekdays"],
  hoursMatch: ["Bevorzugte Unterrichtszeit", "Preferred teaching hours"],
  urgentMatch: [
    "Kurzfristige Vertretung erwünscht",
    "Interested in urgent cover",
  ],
} as const;

for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "teachingMatching",
    Object.fromEntries(
      Object.entries(labels).map(([key, values]) => [key, values[index]]),
    ),
    true,
    true,
  );
