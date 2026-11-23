/**
 * DE/EN UI resources for the jobLifecycle namespace. Module import registers these strings with
 * i18next; authored business content is not translated.
 */
import i18n from "../../lib/i18n";

const en = {
  rangeFrom: "First day",
  rangeThrough: "Last day",
  rangeHelp:
    "Applying the period keeps existing times within these dates and replaces sessions outside them. Adjust the times for each day below.",
  applyRange: "Apply date range",
  invalidRange: "Choose a period with 1 to 60 sessions.",
  deliveryPeriod: "Delivery period",
  manageAttachments: "Manage job attachments",
  scheduleLocked:
    "These dates belong to a shared course plan or existing course activity. Use the course or assignment change workflow.",
  invalidSchedule:
    "Check that all sessions are in the future and their times are valid and do not overlap.",
  board: "Offer board",
  boardRefresh: "Refresh board",
  boardHelp:
    "Move unaccepted offers between draft, published and archived. Use the status control or drag handle with pointer or keyboard. Accepted assignments are changed in their detail view.",
  boardLimit:
    "The board shows the latest 500 offers. Open older offers through the offer list.",
  boardEmpty: "No offers in this column.",
  drag: "Move {{title}}",
  dragStart:
    "Moving {{title}}. Use the arrow keys to choose a column. Press Space to drop or Escape to cancel.",
  dragOver: "Target: {{status}}. No server change has been made yet.",
  dragEnd: "Drop complete. The server is checking the requested status change.",
  dragCancelled: "Move cancelled. No server change was requested.",
  dragInstructions:
    "Press Space to pick up an offer, Right or Down for the next editable column, Left or Up for the previous one, Space to drop and Escape to cancel. You can also use the status control on the card.",
  readOnly: "Accepted history: manage this offer in its detail view.",

  positions: "Lecturer positions",
  perPosition: "per lecturer position",
  perPositionHint:
    "Each quoted fee covers the entire teaching block for one lecturer position. The maximum budget is the number of positions × that fee.",
  maxGrossBudget: "Maximum company budget",
  maxNetBudget: "Maximum lecturer compensation",
  filledPositions_one: "{{count}} position confirmed",
  filledPositions_other: "{{count}} positions confirmed",
  openPositions_one: "{{count}} position open for claims",
  openPositions_other: "{{count}} positions open for claims",
  saveCapacity: "Save position count",
  positionFeeHint:
    "The fee covers the entire teaching block for one lecturer position.",
  alreadyAssigned:
    "You already hold a confirmed position in this teaching block.",
  vacancyStatusHint:
    "The vacancy status controls the remaining positions. Existing confirmed assignments remain confirmed.",
  heading: "Assignment and offer history",
  help: "Cancellation releases future availability and course-chat access. Accepted terms, fees and history remain stored. Invoiced or started work needs a separate financial review.",
  cancel: "Cancel assignment",
  cancelConfirm: "Confirm cancellation",
  reason: "Reason (5–1000 characters)",
  cancelDescription:
    "This is a real cancellation of the complete teaching block. It does not record a payment or refund. The offer returns to draft until management explicitly reopens it.",
  reopen: "Reopen teaching offer",
  reopenDescription:
    "Publish the same future dates and unchanged accepted offer terms again. A new eligible lecturer must claim the complete block online.",
  empty: "No assignment has been accepted yet.",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  edit: "Edit unaccepted offer",
  title: "Offer title",
  company: "Company assigned to this job",
  companyFixed:
    "This offer's company is fixed by its source or linked course activity.",
  noCompany: "No company assigned",
  dispatch: "Company and class",
  editDispatch: "Edit class",
  class: "Class assigned to this job",
  noClass: "No class",
  changeCompany: "Change company",
  noDefaultContact: "No default contact",
  noDefaultMeeting: "No room set for this class",
  pickClassForMeeting: "Select a class to see its meeting room",
  defaultContact: "Default company contact",
  companyContact: "Company contact for this job",
  defaultMeeting: "Default class meeting room",
  meetingRoom: "Open meeting room",
  refreshDispatchDefaults: "Apply current company contact and meeting room",
  description: "Offer description",
  location: "Location or meeting link",
  terms: "Assignment terms",
  deadline: "Claim deadline",
  deadlineZone:
    "Deadline uses the offer's displayed time zone. Leave blank for no deadline. New or changed times must be unambiguous; an unchanged existing deadline keeps its exact instant.",
  duplicate: "Duplicate as draft",
  duplicateHelp:
    "Creates an unpublished copy with its own course run and dates. Assignments, invoices, documents and chat membership are not copied.",
  copyTitle: "Title of the copy",
  saved: "The confirmed server change was saved.",
  failed:
    "The change was refused or the response failed. Refresh and review the latest state before changing the request.",
  stale:
    "This offer changed while you were editing. Close the form, refresh and review it again.",
  draft: "Unpublish",
  published: "Publish",
  archived: "Archive",
  save: "Save offer",
  released: "Availability released",
  frozen:
    "Accepted history is preserved. Create a new course plan to change dates or accepted terms.",
  restricted:
    "A cancelled assignment can only be reopened explicitly with a reason in its detail view.",
};
const de: typeof en = {
  rangeFrom: "Erster Tag",
  rangeThrough: "Letzter Tag",
  rangeHelp:
    "Beim Übernehmen bleiben die Uhrzeiten innerhalb des Zeitraums erhalten. Termine außerhalb entfallen. Die Uhrzeiten kannst du unten für jeden Tag ändern.",
  applyRange: "Zeitraum übernehmen",
  invalidRange: "Wähle einen Zeitraum mit 1 bis 60 Terminen.",
  deliveryPeriod: "Durchführungszeitraum",
  manageAttachments: "Auftragsdateien verwalten",
  scheduleLocked:
    "Diese Termine gehören zu einem gemeinsamen Kursplan oder zu bestehenden Kursaktivitäten. Nutze die Kursplanung oder die Terminänderung zum Lehrauftrag.",
  invalidSchedule:
    "Prüfe, ob alle Termine in der Zukunft liegen, die Uhrzeiten gültig sind und sich die Termine nicht überschneiden.",
  board: "Auftragsboard",
  boardRefresh: "Board aktualisieren",
  boardHelp:
    "Verschiebe unangenommene Aufträge zwischen Entwurf, veröffentlicht und archiviert. Nutze Statusauswahl oder Ziehgriff mit Maus oder Tastatur. Angenommene Zuweisungen verwaltest du in der Detailansicht.",
  boardLimit:
    "Das Board zeigt die neuesten 500 Aufträge. Ältere Aufträge erreichst du über die Auftragsliste.",
  boardEmpty: "Keine Aufträge in dieser Spalte.",
  drag: "{{title}} verschieben",
  dragStart:
    "{{title}} wird verschoben. Wähle mit den Pfeiltasten eine Spalte. Leertaste legt ab, Escape bricht ab.",
  dragOver: "Ziel: {{status}}. Auf dem Server wurde noch nichts geändert.",
  dragEnd: "Abgelegt. Der Server prüft die angeforderte Statusänderung.",
  dragCancelled:
    "Verschieben abgebrochen. Es wurde keine Serveränderung angefordert.",
  dragInstructions:
    "Leertaste nimmt einen Auftrag auf, Rechts oder Unten wählt die nächste bearbeitbare Spalte, Links oder Oben die vorherige, Leertaste legt ab und Escape bricht ab. Alternativ nutze die Statusauswahl auf der Karte.",
  readOnly: "Angenommene Historie: Verwaltung in der Detailansicht.",

  positions: "Dozierendenplätze",
  perPosition: "je Dozierendenplatz",
  perPositionHint:
    "Das angegebene Honorar gilt je Dozierendenplatz für den gesamten Unterrichtsblock. Das maximale Budget ergibt sich aus der Anzahl der Plätze × Honorar.",
  maxGrossBudget: "Maximales Unternehmensbudget",
  maxNetBudget: "Maximale Dozierendenvergütung",
  filledPositions_one: "{{count}} Platz bestätigt",
  filledPositions_other: "{{count}} Plätze bestätigt",
  openPositions_one: "{{count}} Platz zur Übernahme offen",
  openPositions_other: "{{count}} Plätze zur Übernahme offen",
  saveCapacity: "Platzzahl speichern",
  positionFeeHint:
    "Das Honorar gilt für den gesamten Unterrichtsblock für einen Dozierendenplatz.",
  alreadyAssigned:
    "Du hast bereits einen bestätigten Platz in diesem Unterrichtsblock.",
  vacancyStatusHint:
    "Der Veröffentlichungsstatus betrifft die verbleibenden Plätze. Bestehende Zuweisungen bleiben bestätigt.",
  heading: "Zuweisung und Auftragsverlauf",
  help: "Eine Stornierung gibt zukünftige Termine und den Kurschat frei. Angenommene Bedingungen, Honorare und Verlauf bleiben gespeichert. Bereits begonnene oder abgerechnete Arbeit benötigt eine gesonderte fachliche Prüfung.",
  cancel: "Zuweisung stornieren",
  cancelConfirm: "Stornierung bestätigen",
  reason: "Begründung (5–1000 Zeichen)",
  cancelDescription:
    "Dies storniert den gesamten Unterrichtsblock verbindlich im Portal. Es wird keine Zahlung oder Erstattung erfasst. Der Auftrag wird zum Entwurf, bis das Management ihn ausdrücklich wieder öffnet.",
  reopen: "Auftrag wieder öffnen",
  reopenDescription:
    "Veröffentlicht dieselben zukünftigen Termine mit den unveränderten Bedingungen erneut. Eine berechtigte Lehrkraft muss den gesamten Block online übernehmen.",
  empty: "Bisher wurde keine Zuweisung angenommen.",
  confirmed: "Bestätigt",
  cancelled: "Storniert",
  edit: "Unangenommenen Auftrag bearbeiten",
  title: "Auftragstitel",
  company: "Unternehmen für diesen Auftrag",
  companyFixed:
    "Die Firma ist durch die Herkunft des Auftrags oder die verknüpfte Kursaktivität festgelegt.",
  noCompany: "Kein Unternehmen zugeordnet",
  dispatch: "Unternehmen und Klasse",
  editDispatch: "Klasse bearbeiten",
  class: "Klasse für diesen Auftrag",
  noClass: "Keine Klasse",
  changeCompany: "Unternehmen wechseln",
  noDefaultContact: "Kein Standardkontakt hinterlegt",
  noDefaultMeeting: "Für diese Klasse ist kein Raum hinterlegt",
  pickClassForMeeting: "Wähle eine Klasse, um ihren Besprechungsraum zu sehen",
  defaultContact: "Standardkontakt des Unternehmens",
  companyContact: "Unternehmenskontakt für diesen Auftrag",
  defaultMeeting: "Standard-Besprechungsraum der Klasse",
  meetingRoom: "Besprechungsraum öffnen",
  refreshDispatchDefaults:
    "Aktuellen Firmenkontakt und Besprechungsraum übernehmen",
  description: "Auftragsbeschreibung",
  location: "Ort oder Besprechungslink",
  terms: "Auftragsbedingungen",
  deadline: "Übernahmefrist",
  deadlineZone:
    "Die Frist verwendet die angezeigte Zeitzone des Auftrags. Leer bedeutet keine Frist. Neue oder geänderte Zeiten müssen eindeutig sein; eine unveränderte bestehende Frist behält ihren exakten Zeitpunkt.",
  duplicate: "Als Entwurf kopieren",
  duplicateHelp:
    "Erstellt eine unveröffentlichte Kopie mit eigenem Kursdurchlauf und eigenen Terminen. Zuweisungen, Rechnungen, Dokumente und Chatmitglieder werden nicht kopiert.",
  copyTitle: "Titel der Kopie",
  saved: "Die bestätigte Serveränderung wurde gespeichert.",
  failed:
    "Die Änderung wurde abgelehnt oder die Antwort ist fehlgeschlagen. Aktualisiere den Stand und prüfe ihn, bevor du die Anfrage änderst.",
  stale:
    "Der Auftrag wurde während der Bearbeitung geändert. Schließe das Formular, aktualisiere und prüfe ihn erneut.",
  draft: "Veröffentlichung zurücknehmen",
  published: "Veröffentlichen",
  archived: "Archivieren",
  save: "Auftrag speichern",
  released: "Termine freigegeben",
  frozen:
    "Angenommene Historie bleibt erhalten. Lege für andere Termine oder angenommene Bedingungen eine neue Kursplanung an.",
  restricted:
    "Eine stornierte Zuweisung lässt sich nur mit Begründung in der Detailansicht wieder öffnen.",
};
i18n.addResourceBundle("de", "jobLifecycle", de, true, true);
i18n.addResourceBundle("en", "jobLifecycle", en, true, true);
