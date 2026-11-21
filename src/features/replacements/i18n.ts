/** German/English interface vocabulary for replacements. User-authored notes, reasons, documents and messages retain their authored language. */
import i18n from "../../lib/i18n";

const pairs: Record<string, [string, string]> = {
  title: ["Ersatzbörse", "Replacement marketplace"],
  description: [
    "Übernimm einen vollständigen Einsatz. Die bisherige Zusage bleibt bis zur bestätigten Übernahme bestehen.",
    "Take over a complete assignment. The original commitment remains until the handover is confirmed.",
  ],
  boundary: [
    "Bei weniger als sieben Tagen bis zum ersten Termin beantragst du den Rücktritt im zugewiesenen Auftrag; Administration oder Management muss zustimmen oder selbst eine Vertretung einleiten. Begonnene oder bereits abgerechnete Einsätze benötigen eine gesonderte vertragliche Klärung. Warteliste und geordnete Benachrichtigungen sind noch nicht verfügbar.",
    "With less than seven days before the first session, request withdrawal in the assigned job; Administration or Management must approve or initiate a replacement themselves. Started or invoiced assignments require a separate contractual amendment. Waitlists and ordered notifications are not available yet.",
  ],
  request: ["Ersatz suchen", "Find a replacement"],
  assignment: ["Bestätigter Einsatz", "Confirmed assignment"],
  reason: [
    "Begründung (nur bisherige Lehrperson und berechtigtes Management)",
    "Reason (original lecturer and authorised management only)",
  ],
  mode: ["Angebotsart", "Offer mode"],
  open: ["Offene Ersatzbörse", "Open marketplace"],
  selected: [
    "Ausgewählte qualifizierte Lehrpersonen",
    "Selected qualified lecturers",
  ],
  invite: ["Lehrpersonen auswählen", "Select lecturers"],
  emergency: ["Dringender Ersatz", "Emergency replacement"],
  save: ["Ersatzangebot veröffentlichen", "Publish replacement offer"],
  cancel: ["Ersatzsuche beenden", "Cancel replacement search"],
  cancelHint: [
    "Der ursprüngliche Einsatz bleibt bestätigt.",
    "The original assignment remains confirmed.",
  ],
  claim: ["Gesamten Block übernehmen", "Claim the complete block"],
  consent: [
    "Ich habe sämtliche Termine, die Vergütung und die Bedingungen geprüft und nehme diesen vollständigen Block an.",
    "I have reviewed every session, the compensation and the terms and accept this complete block.",
  ],
  total: ["Gesamtvergütung", "Total compensation"],
  unit: ["Vergütungseinheit", "Compensation unit"],
  terms: ["Bedingungen", "Terms"],
  per_day: ["pro Tag", "per day"],
  per_hour: ["pro Stunde", "per hour"],
  per_teaching_unit: ["pro Unterrichtseinheit", "per teaching unit"],
  fixed_total: ["Gesamtbetrag", "fixed total"],
  empty: [
    "Keine Ersatzangebote verfügbar.",
    "No replacement offers available.",
  ],
  none: [
    "Keine geeigneten bestätigten Einsätze verfügbar.",
    "No eligible confirmed assignments available.",
  ],
  opened: [
    "Ersatzsuche veröffentlicht. Die bisherige Zusage bleibt bestehen.",
    "Replacement search published. The original commitment remains.",
  ],
  confirmed: [
    "Übernahme online bestätigt. Alle Termine sind zugeordnet.",
    "Handover confirmed online. All sessions have been allocated.",
  ],
  cancelled: [
    "Ersatzsuche beendet; die bisherige Zusage bleibt bestehen.",
    "Replacement search cancelled; the original commitment remains.",
  ],
  completed: ["Übernommen", "Handed over"],
  offerCancelled: ["Suche beendet", "Search cancelled"],
  unavailable: [
    "Das Angebot ist nicht mehr verfügbar. Lade den aktuellen Stand.",
    "This offer is no longer available. Reload the current state.",
  ],
  not_eligible: [
    "Eine Voraussetzung ist nicht mehr erfüllt oder ein Termin ist belegt. Es wurde nichts übernommen.",
    "A prerequisite is no longer met or a session conflicts. Nothing was transferred.",
  ],
  conflict: [
    "Ein Termin überschneidet sich. Die Übernahme wurde nicht durchgeführt.",
    "A session conflicts. The handover was not completed.",
  ],
  terms_changed: [
    "Die Bedingungen haben sich geändert. Bitte neu prüfen und zustimmen.",
    "The terms changed. Review and accept them again.",
  ],
  error: [
    "Die Aktion wurde nicht bestätigt. Prüfe Berechtigung, Auswahl und aktuellen Stand. Bei unklarem Netzwerkergebnis denselben Versuch erneut senden.",
    "The action was not confirmed. Check permissions, selection and the current state. Retry the same request after an uncertain network result.",
  ],
  refresh: ["Aktuellen Stand laden", "Reload current state"],
};
for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "replacements",
    Object.fromEntries(
      Object.entries(pairs).map(([key, value]) => [key, value[index]]),
    ),
    true,
    true,
  );
