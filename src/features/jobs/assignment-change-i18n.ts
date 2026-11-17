/** Bilingual labels for the formal assignment schedule/location change workflow. */
import i18n from "../../lib/i18n";

const en = {
  heading: "Assignment change requests",
  reason: "Reason",
  location: "Location or meeting link",
  schedule: "Session schedule",
  start: "Session {{number}} starts",
  none: "Not specified",
  propose: "Request change",
  sending: "Submitting…",
  submitted:
    "Request submitted. The confirmed assignment remains unchanged until approval and application.",
  offline: "Reconnect to review or change an assignment.",
  failed: "The change was not confirmed. Reload the current state and retry.",
  proposalRefused:
    "The server did not accept this proposal. Only a future standalone assignment with one confirmed lecturer and no started or invoiced session is eligible; refresh to review the current assignment.",
  eligibilityHelp:
    "For a future standalone assignment with one confirmed lecturer. Started or invoiced work is not eligible. The server rechecks eligibility when you submit.",
  invalidTime:
    "Choose a valid local time. Times skipped or repeated during daylight saving changes cannot be submitted.",
  accept: "Accept proposed change",
  reject: "Reject proposed change",
  apply: "Apply accepted change",
  close: "Close request",
  status: {
    awaiting_response: "Awaiting lecturer response",
    accepted: "Accepted, awaiting management application",
    rejected: "Rejected",
    applied: "Applied",
    superseded: "Closed (withdrawn from the workflow)",
  },
};
const de = {
  heading: "Änderungsanträge zum Auftrag",
  reason: "Begründung",
  location: "Ort oder Besprechungslink",
  schedule: "Termine der Einheiten",
  start: "Beginn Einheit {{number}}",
  none: "Nicht angegeben",
  propose: "Änderung beantragen",
  sending: "Wird gesendet…",
  submitted:
    "Antrag gesendet. Der bestätigte Auftrag bleibt bis zur Annahme und Umsetzung unverändert.",
  offline:
    "Stelle eine Verbindung her, um einen Auftrag zu prüfen oder zu ändern.",
  failed:
    "Die Änderung wurde nicht bestätigt. Lade den aktuellen Stand und versuche es erneut.",
  proposalRefused:
    "Der Server hat den Antrag nicht angenommen. Änderbar ist nur ein zukünftiger eigenständiger Auftrag mit einer bestätigten Lehrkraft und ohne begonnene oder abgerechnete Einheit. Lade den aktuellen Auftragsstand.",
  eligibilityHelp:
    "Für einen zukünftigen eigenständigen Auftrag mit einer bestätigten Lehrkraft. Begonnene oder abgerechnete Arbeit ist ausgeschlossen. Der Server prüft die Voraussetzungen beim Senden erneut.",
  invalidTime:
    "Wähle eine gültige Ortszeit. Zeiten, die bei der Zeitumstellung entfallen oder doppelt vorkommen, können nicht gesendet werden.",
  accept: "Vorgeschlagene Änderung annehmen",
  reject: "Vorgeschlagene Änderung ablehnen",
  apply: "Angenommene Änderung umsetzen",
  close: "Antrag schließen",
  status: {
    awaiting_response: "Wartet auf Rückmeldung der Lehrkraft",
    accepted: "Angenommen, wartet auf Umsetzung durch die Verwaltung",
    rejected: "Abgelehnt",
    applied: "Umgesetzt",
    superseded: "Geschlossen (aus dem Verfahren zurückgezogen)",
  },
};
i18n.addResourceBundle("en", "assignmentChange", en);
i18n.addResourceBundle("de", "assignmentChange", de);
