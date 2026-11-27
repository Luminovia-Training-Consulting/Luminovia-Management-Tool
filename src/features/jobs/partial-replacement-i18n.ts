/** Bilingual actions for the selected-session cover workflow. */
import i18n from "../../lib/i18n";
const copy = {
  action: ["Einzelne Termine vertreten", "Replace selected sessions"],
  title: ["Teilvertretung bestätigen", "Confirm partial cover"],
  description: [
    "Eine Teilvertretung betrifft nur die ausgewählten zukünftigen Termine. Der bestehende Auftrag bleibt erhalten. Sein Honorar wird im Rechnungsablauf separat geprüft.",
    "Partial cover applies to the selected future sessions. The original assignment stays in place. Its compensation is reviewed separately in the invoicing workflow.",
  ],
  sessions: ["Zukünftige Termine", "Future sessions"],
  search: ["Dozent:innen suchen", "Find lecturers"],
  lecturer: ["Vertretung", "Cover lecturer"],
  fee: [
    "Vereinbartes Gesamthonorar ({{currency}})",
    "Agreed total cover fee ({{currency}})",
  ],
  terms: ["Vereinbarte Konditionen der Vertretung", "Agreed cover terms"],
  reason: ["Grund der Teilvertretung", "Reason for partial cover"],
  confirm: ["Teilvertretung verbindlich zuweisen", "Assign partial cover"],
  confirmed: ["Teilvertretung bestätigt.", "Partial cover confirmed."],
  openCover: ["Vertretungsauftrag öffnen", "Open cover assignment"],
  unavailable: [
    "Für diesen Auftrag sind keine Termine zur Teilvertretung verfügbar.",
    "This assignment has no dates available for partial cover.",
  ],
  failed: [
    "Die Vertretung konnte nicht bestätigt werden. Prüfe Termine, Vertrag, Voraussetzungen und Rechnungsstatus.",
    "Cover could not be confirmed. Check the sessions, contract, requirements and invoice status.",
  ],
  changed: [
    "Der Auftrag wurde geändert. Öffne das Formular erneut.",
    "The assignment changed. Reopen the form.",
  ],
  conflict: [
    "Mindestens ein Termin überschneidet sich mit einer Belegung. Die bisherigen Buchungen sind erhalten.",
    "At least one session overlaps an existing booking. The existing allocations were retained.",
  ],
} as const;
for (const [locale, index] of [
  ["de", 0],
  ["en", 1],
] as const) {
  i18n.addResourceBundle(
    locale,
    "partialReplacement",
    Object.fromEntries(
      Object.entries(copy).map(([key, pair]) => [key, pair[index]]),
    ),
    true,
    true,
  );
}
