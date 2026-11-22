/** Interface-only German/English resources for contractual amendments. Authored
 * reasons, scope and terms remain in their original language. */
import i18n from "../../lib/i18n";
const de = {
  linkedSessions:
    "Die Termine dieses Kurses sind an weitere Vorgänge gebunden. Du kannst Ort und Leistungsumfang ändern.",
  linkedSessionCount:
    "Beim Verschieben bleiben die vorhandenen Kurstermine und ihre Anzahl erhalten.",
  title: "Änderungsanträge",
  deliveryEvidence: "Leistungsnachweise und Korrekturen",
  intro:
    "Bestätigte Aufträge gemeinsam ändern: Original und Änderung bleiben nachvollziehbar erhalten.",
  scopeHint:
    "Einzelaufträge sind vor Beginn änderbar. Bei gemeinsamen Kursen können berechtigte Personen noch ausstehende Termine ändern, sofern alle bestätigten Lehrkräfte zustimmen und keine Rechnung vorliegt.",
  sharedScheduleHelp:
    "Beim Einreichen erhält jede betroffene Lehrkraft einen eigenen Antrag mit denselben Terminen.",
  customerSharedScheduleHelp:
    "Schlage neue Termine für den gemeinsamen Kurs vor. Das Management prüft den Vorschlag und holt bei jeder betroffenen Lehrkraft die Zustimmung ein.",
  sharedCommercialHelp:
    "Bedingungen und Vergütung gelten nur für den ausgewählten Auftrag. Die übrigen Aufträge erhalten ausschließlich die neuen Termine.",
  awaitingCoordination: "Das Management prüft die vorgeschlagenen Termine.",
  coordinationStatus: "In Prüfung",
  coordinateConsent:
    "Ich habe den Kundenantrag geprüft und möchte die betroffenen Lehrkräfte um ihre Zustimmung bitten.",
  submitForCoordination: "Zur Prüfung einreichen",
  coordinate: "Zustimmungen einholen",
  sharedSessionCount:
    "Du kannst Termine hinzufügen oder entfernen. Wenn sich die Anzahl ändert, bleiben Einträge mit Terminen verbunden, deren Datum und Uhrzeit gleich bleiben.",
  sharedStartedSessions:
    "Begonnene Termine und ihre Nachweise bleiben erhalten. Bearbeite die noch ausstehenden Termine.",
  sharedUnavailable:
    "Für diesen Kurs ist derzeit keine gemeinsame Terminänderung möglich. Prüfe den Kurs und seine Aufträge, bevor du einen neuen Antrag erstellst.",
  sharedQuantity:
    "Die vereinbarte Unterrichtsdauer oder Anzahl abrechenbarer Tage muss erhalten bleiben. Prüfe die Termine und die vereinbarte Vergütung.",
  sharedClaimDeadline:
    "Der erste neue Termin darf frühestens mit Ablauf der Annahmefrist für freie Plätze beginnen.",
  sharedLecturer: "Lehrkraft für diese Zustimmung: {{name}}",
  sharedProgress:
    "Gemeinsame Termine: {{accepted}} von {{required}} Aufträgen bestätigt.",
  "sharedState.awaiting_consent": "Weitere Zustimmungen stehen aus.",
  "sharedState.ready": "Das Management kann alle Termine gemeinsam anwenden.",
  "sharedState.blocked":
    "Die gemeinsame Änderung kann nicht angewendet werden. Prüfe das Antragsprotokoll und die aktuelle Besetzung.",
  "sharedState.applied": "Die Termine wurden gemeinsam angewendet.",
  sharedConflict:
    "Prüfe die Zustimmungen, die betroffenen Aufträge, vorhandene Nachweise und die Abmeldefrist.",
  new: "Änderungsantrag erstellen",
  edit: "Entwurf bearbeiten",
  overview: "Alle Änderungsanträge",
  refresh: "Aktualisieren",
  empty: "Keine Änderungsanträge vorhanden.",
  noAssignments: "Keine bestätigten Aufträge für eine Änderung verfügbar.",
  assignment: "Bestätigter Auftrag",
  selectAssignment: "Auftrag auswählen",
  assignmentUnavailable:
    "Der ursprünglich ausgewählte Auftrag ist für Änderungen nicht verfügbar. Wähle einen verfügbaren Auftrag aus.",
  reason: "Begründung",
  location: "Ort oder Meeting-Link",
  scope: "Leistungsumfang",
  terms: "Auftragsbedingungen",
  amount: "Vergütung pro Einheit",
  total_amount: "Gesamte Vergütung",
  rate_unit: "Vergütungseinheit",
  currency: "Originalwährung",
  sessions: "Vorgeschlagene Unterrichtstermine",
  start: "Beginn",
  end: "Ende",
  addSession: "Termin hinzufügen",
  removeSession: "Termin entfernen",
  cancelCourse: "Vollständigen Auftrag stornieren",
  cancelHint:
    "Eine Stornierung braucht ebenfalls die Zustimmung von Management und Dozent:in. Sie setzt Vergütungen weder auf null noch erlässt sie Zahlungen; eine finanzielle Einigung wird gesondert dokumentiert.",
  commissioned:
    "Die persönliche Nettovergütung kann mit einem ausdrücklichen Nachtrag geändert werden. Der vereinbarte Kundenpreis bleibt unverändert; die Finanzverantwortlichen prüfen und bestätigen die neue Aufteilung gemeinsam mit der Lehrkraft.",
  customerScope:
    "Du schlägst nur Termine, Ort oder Leistungsumfang für deinen eigenen Kundenauftrag vor. Vertrauliche Vergütung und Vertragsbedingungen bleiben verborgen. Management und Lehrkraft müssen unabhängig zustimmen; du kannst die Änderung nicht selbst anwenden.",
  dateHint:
    "Alle Eingaben gelten in {{zone}}. Mehrdeutige Sommerzeitangaben werden abgelehnt.",
  save: "Entwurf online speichern",
  cancel: "Abbrechen",
  draft: "Entwurf",
  submitted: "Eingereicht",
  awaiting_response: "Antwort ausstehend",
  accepted: "Angenommen",
  rejected: "Abgelehnt",
  withdrawn: "Zurückgezogen",
  applied: "Angewendet",
  submit: "Zur Zustimmung einreichen",
  accept: "Dieser Änderung zustimmen",
  reject: "Änderung ablehnen",
  withdraw: "Antrag zurückziehen",
  apply: "Angenommene Änderung anwenden",
  consent:
    "Ich habe Original und vorgeschlagene Änderung dieser Version geprüft und stimme zu.",
  note: "Begründung für Ablehnung oder Rücknahme",
  managerApproval: "Zustimmung Management",
  lecturerApproval: "Zustimmung Dozent:in",
  yes: "Erteilt",
  no: "Ausstehend",
  original: "Bisheriger Stand",
  proposed: "Vorgeschlagener Stand",
  comparison: "Versionsvergleich",
  field: "Angabe",
  history: "Vollständiger Verlauf",
  saved: "Der Server hat die Änderung bestätigt.",
  error:
    "Die Änderung wurde nicht bestätigt. Prüfe den aktuellen Stand und versuche es erneut.",
  conflict:
    "Die Termine kollidieren mit einer aktuellen Verpflichtung. Es wurde nichts angewendet.",
  stale:
    "Antrag oder Originalauftrag wurden geändert. Lade den aktuellen Stand; eine veraltete Zustimmung wird nicht angewendet.",
  unsupported:
    "Dieser Antrag erfüllt die Voraussetzungen nicht. Prüfe Termine und Angaben sowie bei Vergütungsentscheidungen den Kundenpreis und die ursprüngliche Einheit. Bereits geleistete oder abgerechnete Aufträge benötigen eine gesonderte Prüfung.",
  offline: "Offline: Änderungen erfordern eine bestätigte Serverantwort.",
  notVisible: "Vertraulich",
  open: "Antrag öffnen",
  source: "Verknüpfter Auftrag",
  amendmentHint:
    "Zustimmungen sind Portal-Nachweise für diesen Nachtrag. Sie ersetzen keine rechtlich erforderliche Vertragsunterzeichnung.",
  per_day: "Pro Tag",
  per_hour: "Pro Stunde",
  per_teaching_unit: "Pro Unterrichtseinheit",
  fixed_total: "Pauschal",
  action_saved: "Entwurf gespeichert",
  action_submit: "Eingereicht",
  action_coordinate: "Zustimmungen angefragt",
  action_accept: "Zugestimmt",
  action_reject: "Abgelehnt",
  action_withdraw: "Zurückgezogen",
  action_apply: "Angewendet",
};
const en = {
  linkedSessions:
    "This course schedule has dependent records. You can change its location and scope here.",
  linkedSessionCount:
    "Rescheduling keeps the existing course sessions and their count.",
  title: "Change requests",
  deliveryEvidence: "Delivery evidence and corrections",
  intro:
    "Agree changes to confirmed assignments while retaining the original and its amendment history.",
  scopeHint:
    "Individual assignments can change before work starts. For shared courses, authorised staff can amend future sessions before invoicing with consent from every confirmed lecturer.",
  sharedScheduleHelp:
    "Submitting sends each affected lecturer a separate request with the same dates.",
  customerSharedScheduleHelp:
    "Propose new dates for the shared course. Management reviews the request and asks each affected lecturer to consent.",
  sharedCommercialHelp:
    "Terms and compensation apply to the selected assignment. The other assignments receive only the new dates.",
  awaitingCoordination: "Management is reviewing the proposed dates.",
  coordinationStatus: "Under review",
  coordinateConsent:
    "I have reviewed the customer request and want to ask the affected lecturers to consent.",
  submitForCoordination: "Submit for review",
  coordinate: "Request consent",
  sharedSessionCount:
    "You can add or remove sessions. When the session count changes, existing records stay linked to sessions with the exact same dates and times.",
  sharedStartedSessions:
    "Sessions already started and their evidence stay in place. Edit the remaining sessions.",
  sharedUnavailable:
    "A shared schedule change is currently unavailable for this course. Check the course and its assignments before creating another request.",
  sharedQuantity:
    "The agreed teaching duration or number of billable days must be preserved. Check the dates and the agreed compensation.",
  sharedClaimDeadline:
    "The first new session cannot start before the claim deadline for open positions.",
  sharedLecturer: "Lecturer for this approval: {{name}}",
  sharedProgress:
    "Shared dates: {{accepted}} of {{required}} assignments approved.",
  "sharedState.awaiting_consent": "More approvals are pending.",
  "sharedState.ready": "Management can apply all dates together.",
  "sharedState.blocked":
    "The shared change cannot be applied. Check the request history and current staffing.",
  "sharedState.applied": "The dates were applied together.",
  sharedConflict:
    "Check the approvals, affected assignments, existing evidence and the enrolment withdrawal deadline.",
  new: "Create change request",
  edit: "Edit draft",
  overview: "All change requests",
  refresh: "Refresh",
  empty: "No change requests yet.",
  noAssignments: "No confirmed assignments are available for changes.",
  assignment: "Confirmed assignment",
  selectAssignment: "Select an assignment",
  assignmentUnavailable:
    "The originally selected assignment is unavailable for changes. Select an available assignment.",
  reason: "Reason",
  location: "Location or meeting link",
  scope: "Scope of work",
  terms: "Assignment terms",
  amount: "Compensation per unit",
  total_amount: "Total compensation",
  rate_unit: "Compensation unit",
  currency: "Original currency",
  sessions: "Proposed teaching sessions",
  start: "Start",
  end: "Finish",
  addSession: "Add session",
  removeSession: "Remove session",
  cancelCourse: "Cancel the complete assignment",
  cancelHint:
    "Cancellation also requires management and lecturer consent. It does not set compensation to zero or waive payment; any financial settlement is documented separately.",
  commissioned:
    "Personal net compensation can change through an explicit amendment. The agreed customer charge stays unchanged; authorised finance staff review and confirm the revised allocation together with the lecturer.",
  customerScope:
    "Propose dates, location or scope for your own customer assignment. Private compensation and contract terms remain hidden. Management and the lecturer must consent independently; you cannot apply the change yourself.",
  dateHint:
    "All entries use {{zone}}. Ambiguous daylight-saving times are rejected.",
  save: "Save draft online",
  cancel: "Cancel",
  draft: "Draft",
  submitted: "Submitted",
  awaiting_response: "Awaiting response",
  accepted: "Accepted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  applied: "Applied",
  submit: "Submit for consent",
  accept: "Accept this amendment",
  reject: "Reject amendment",
  withdraw: "Withdraw request",
  apply: "Apply accepted amendment",
  consent:
    "I have reviewed the original and proposed changes in this version and accept them.",
  note: "Reason for rejection or withdrawal",
  managerApproval: "Management approval",
  lecturerApproval: "Lecturer approval",
  yes: "Granted",
  no: "Pending",
  original: "Original version",
  proposed: "Proposed version",
  comparison: "Version comparison",
  field: "Field",
  history: "Complete history",
  saved: "The server confirmed the change.",
  error: "The change was not confirmed. Check current records and try again.",
  conflict:
    "The proposed sessions conflict with a current commitment. Nothing was applied.",
  stale:
    "The request or original assignment has changed. Load current records; stale consent cannot be applied.",
  unsupported:
    "This request does not meet the prerequisites. Check dates and values and, for compensation decisions, the customer charge and original unit. Delivered or invoiced assignments require separate review.",
  offline: "Offline: changes require a confirmed server response.",
  notVisible: "Confidential",
  open: "Open request",
  source: "Linked assignment",
  amendmentHint:
    "Portal consents record agreement to this amendment. They do not replace any legally required contract signature.",
  per_day: "Per day",
  per_hour: "Per hour",
  per_teaching_unit: "Per teaching unit",
  fixed_total: "Fixed total",
  action_saved: "Draft saved",
  action_submit: "Submitted",
  action_coordinate: "Consent requested",
  action_accept: "Accepted",
  action_reject: "Rejected",
  action_withdraw: "Withdrawn",
  action_apply: "Applied",
};
i18n.addResourceBundle("de", "changes", de, true, true);
i18n.addResourceBundle("en", "changes", en, true, true);
