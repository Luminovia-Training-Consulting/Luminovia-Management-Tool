/**
 * DE/EN UI resources for the jobLifecycle namespace. Module import registers these strings with
 * i18next; authored business content is not translated.
 */
import i18n from "../../lib/i18n";
const en = {
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
    "Each quoted fee covers the entire teaching block for ONE lecturer position. The maximum budget is the number of positions × that fee. Existing client/course offers keep their original single-position meaning.",
  maxGrossBudget: "Maximum customer budget",
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
    "Jedes angegebene Honorar gilt für den gesamten Unterrichtsblock für EINEN Dozierendenplatz. Das maximale Budget ist die Zahl der Plätze × dieses Honorar. Bestehende Kunden-/Kursangebote behalten ihre ursprüngliche Bedeutung für einen Platz.",
  maxGrossBudget: "Maximales Auftraggeberbudget",
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
