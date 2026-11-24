/**
 * DE/EN UI resources for the commercial namespace. Module import registers these strings with
 * i18next; authored business content is not translated.
 */
import i18n from "../../lib/i18n";

const pairs: Record<string, [string, string]> = {
  noDocument: [
    "Für diesen älteren Eintrag ist noch keine geprüfte PDF-Fassung hinterlegt.",
    "This older record has no checked PDF version yet.",
  ],
  invoiceBasis: [
    "Vergütung aus angenommenen Aufträgen; keine Steuerberechnung.",
    "Compensation from accepted assignments; no tax calculation.",
  ],
  voidPayment: ["Zahlungseintrag stornieren", "Void payment record"],
  voidReason: ["Grund der Stornierung", "Reason for voiding"],
  voidHint: [
    "Korrigiere einen irrtümlichen Zahlungseintrag. Der Verlauf bleibt erhalten. Es wird keine Bankbewegung ausgelöst.",
    "Correct an erroneous payment record. Its history is retained. This does not initiate a bank transaction.",
  ],
  voided: ["Storniert", "Voided"],
  dates: ["Zeitraum", "Dates"],
  details: ["Rechnungsdetails", "Invoice details"],
  maxClaims: [
    "Bis zu 50 Aufträge pro Rechnung.",
    "Up to 50 assignments per invoice.",
  ],

  contracts: ["Verträge", "Contracts"],
  contractsIntro: [
    "Deine ausgeführten Verträge und Ergänzungen – nachvollziehbar nach Version und Dokument.",
    "Your executed contracts and addenda, with a clear version and document history.",
  ],
  allPeople: ["Alle Dozierenden anzeigen", "Show all lecturers"],
  ownOnly: ["Meine Unterlagen", "My documents"],
  register: ["Ausgeführten Vertrag hinterlegen", "Register executed contract"],
  registerHint: [
    "Lade den ausgeführten Vertrag für die ausgewählte Person hoch oder wähle eine bereits geprüfte Datei aus. Eine Empfangsbestätigung ersetzt keine rechtsverbindliche Unterzeichnung.",
    "Upload the executed contract for the selected lecturer or choose an existing checked file. A portal receipt acknowledgement does not replace a legally binding signature.",
  ],
  ownContractUploadHint: [
    "Lade deinen ausgeführten Vertrag selbst hoch. Die Verwaltung kann ihn für den Vertragseintrag auswählen, aber nicht herunterladen.",
    "Upload your executed contract yourself. Management can select it for the contract record but cannot download it.",
  ],
  contractCandidate: ["Hochgeladene Vertragsdatei", "Uploaded contract file"],
  contractCandidateHint: [
    "Die Datei ist für die dozierende Person und die Person zugänglich, die sie berechtigt für sie hochgeladen hat.",
    "The lecturer and the staff member who uploaded the file on their behalf can access it.",
  ],
  selectContractCandidate: ["Datei auswählen", "Select a file"],
  person: ["Dozent:in", "Lecturer"],
  selectPerson: ["Person auswählen", "Choose a person"],
  title: ["Titel", "Title"],
  kind: ["Art", "Type"],
  master: ["Rahmenvertrag", "Master contract"],
  addendum: ["Ergänzung", "Addendum"],
  parent: ["Zugehöriger Vertrag", "Parent contract"],
  selectParent: ["Vertrag auswählen", "Choose a contract"],
  effective: ["Gültig ab", "Effective from"],
  expires: ["Gültig bis", "Expires at"],
  noExpiry: ["Kein Ablaufdatum", "No expiry date"],
  zone: ["Zeitzone", "Time zone"],
  contractPdf: ["Ausgeführter Vertrag als PDF", "Executed contract PDF"],
  pdfHint: [
    "PDF · maximal 100 MiB · Freigabe nach Sicherheitsprüfung",
    "PDF · up to 100 MiB · available after security scanning",
  ],
  dropPdf: [
    "Oder eine unterschriebene PDF hier ablegen.",
    "Or drop an executed PDF here.",
  ],
  uploading: [
    "PDF wird hochgeladen und geprüft … {{progress}} %",
    "Uploading and checking PDF … {{progress}}%",
  ],
  uploadFailed: [
    "Das PDF wurde nicht hochgeladen oder freigegeben. Prüfe Dateityp, Größe und Verbindung und versuche es erneut; bei wiederholtem Fehler kann die Sicherheitsprüfung nicht verfügbar sein.",
    "The PDF was not uploaded or approved. Check its type, size and connection and retry; repeated failures may mean scanning is unavailable.",
  ],
  fileReady: ["PDF geprüft und bereit.", "PDF checked and ready."],
  registerSave: ["Vertrag speichern", "Save contract"],
  saved: ["Gespeichert.", "Saved."],
  failed: [
    "Die Änderung wurde nicht bestätigt. Bitte prüfe die Eingaben und versuche es erneut.",
    "The change was not confirmed. Check your input and try again.",
  ],
  active: ["Aktiv", "Active"],
  expired: ["Abgelaufen", "Expired"],
  setActive: ["Vertrag aktivieren", "Activate contract"],
  setExpired: ["Vertrag als abgelaufen markieren", "Mark contract expired"],
  statusConfirm: ["Vertragsstatus ändern?", "Change contract status?"],
  statusHint: [
    "Der Status von „{{title}}“ wird geändert. Bereits bestätigte Auftragskonditionen bleiben erhalten.",
    "The status of “{{title}}” will change. Previously confirmed assignment terms are retained.",
  ],
  download: ["Dokument herunterladen", "Download document"],
  version: ["Version {{version}}", "Version {{version}}"],
  checksum: ["SHA-256-Prüfsumme", "SHA-256 checksum"],
  acknowledge: ["Empfang bestätigen", "Acknowledge receipt"],
  acknowledgeLabel: [
    "Ich habe diese Vertragsfassung erhalten und zur Kenntnis genommen.",
    "I have received and read this contract version.",
  ],
  acknowledgeHint: [
    "Diese Bestätigung dokumentiert den Empfang dieser Fassung. Sie ist keine elektronische Unterschrift.",
    "This acknowledgement records receipt of this version. It is not an electronic signature.",
  ],
  acknowledged: [
    "Empfang bestätigt am {{date}}",
    "Receipt acknowledged on {{date}}",
  ],
  noContracts: [
    "Noch keine Vertragsunterlagen hinterlegt.",
    "No contract documents have been added yet.",
  ],
  finance: ["Honorare & Rechnungen", "Earnings & invoices"],
  financeIntro: [
    "Behalte vereinbarte Honorare, Rechnungen und erfasste Zahlungen im Blick.",
    "Keep track of accepted fees, invoices and recorded payments.",
  ],
  originalCurrency: [
    "Beträge bleiben in ihrer Originalwährung. Es erfolgt keine Umrechnung.",
    "Amounts remain in their original currency. No conversion is applied.",
  ],
  earnings: ["Vereinbarte Honorare", "Accepted earnings"],
  expected: ["Erwartet", "Expected"],
  invoiceReviewStage: ["Prüfung erforderlich", "Review required"],
  invoiceEarly: ["Früh im Zahlungsziel", "Before the payment-term midpoint"],
  invoiceHalfTerm: [
    "Zahlungsziel zur Hälfte verstrichen",
    "Payment term past halfway",
  ],
  invoiceDueSoon: ["Bald fällig", "Due soon"],
  invoiceOverdue: ["Überfällig", "Overdue"],
  invoicePaidStatus: ["Bezahlt", "Paid"],
  invoiceOutstanding: ["Offener Betrag", "Outstanding"],
  financeTrends: ["Monatliche Entwicklung", "Monthly trends"],
  earningsTrendSource: [
    "Eigene oder ausdrücklich freigegebene Honorare nach lokalem Terminmonat; Originalwährungen bleiben getrennt.",
    "Own or explicitly authorized earnings by IANA-zone session month; original currencies stay separate.",
  ],
  invoiceTrendSource: [
    "Eigene Rechnungen nach Ausstellungsmonat; Eingänge und offene Beträge bleiben getrennt.",
    "Own invoices by issue month; received and outstanding amounts stay separate.",
  ],
  invoicePaidTrend: ["Eingegangen", "Received"],
  invoiceOutstandingTrend: ["Offen", "Outstanding"],
  completed: ["Abgeschlossen", "Completed"],
  invoiced: ["In Rechnung gestellt", "Invoiced"],
  paid: ["Bezahlt", "Paid"],
  submitted: ["Eingereicht", "Submitted"],
  approved: ["Freigegeben", "Approved"],
  rejected: ["Abgelehnt", "Rejected"],
  cancelled: ["Storniert", "Cancelled"],
  invoices: ["Rechnungen", "Invoices"],
  submitCourseInvoice: ["Für diesen Kurs abrechnen", "Invoice this course"],
  createInvoice: ["Rechnung einreichen", "Submit invoice"],
  invoiceHint: [
    "Wähle deine Aufträge und das zugehörige Rechnungs-PDF. Der Gesamtbetrag wird aus den bestätigten Auftragskonditionen übernommen.",
    "Select your assignments and the matching invoice PDF. The total comes from the accepted assignment terms.",
  ],
  invoiceNumber: ["Rechnungsnummer", "Invoice number"],
  issued: ["Rechnungsdatum", "Issue date"],
  due: ["Fällig am", "Due date"],
  invoicePdf: ["Rechnung als PDF", "Invoice PDF"],
  chooseClaims: ["Aufträge auswählen", "Select assignments"],
  noEligibleClaims: [
    "Aktuell sind keine weiteren Aufträge für eine Rechnung verfügbar.",
    "No additional assignments are currently available for invoicing.",
  ],
  invoiceSave: ["Rechnung einreichen", "Submit invoice"],
  selectedTotal: ["Ausgewählter Betrag", "Selected total"],
  oneCurrency: [
    "Wähle Aufträge in einer gemeinsamen Währung.",
    "Select assignments in the same currency.",
  ],
  client: ["Unternehmen", "Company"],
  assignment: ["Auftrag", "Assignment"],
  lecturer: ["Dozent:in", "Lecturer"],
  total: ["Gesamtbetrag", "Total"],
  received: ["Erfasste Zahlungen", "Recorded payments"],
  outstanding: ["Offen", "Outstanding"],
  status: ["Status", "Status"],
  noEarnings: [
    "Noch keine bestätigten Lehraufträge vorhanden.",
    "No confirmed teaching assignments yet.",
  ],
  noInvoices: ["Noch keine Rechnungen vorhanden.", "No invoices yet."],
  exportEarnings: ["Honorare als CSV", "Export earnings CSV"],
  exportInvoices: ["Rechnungen als CSV", "Export invoices CSV"],
  review: ["Rechnung prüfen", "Review invoice"],
  reviewHint: [
    "Prüfe das hinterlegte PDF und die zugeordneten Aufträge, bevor du den Status änderst.",
    "Review the stored PDF and linked assignments before changing the status.",
  ],
  reviewNote: ["Notiz zur Prüfung", "Review note"],
  invoiceReviewRequired: [
    "Diese stornierte oder teilweise freigegebene Buchung muss vor einer Rechnung geprüft werden.",
    "This cancelled or partially released assignment needs review before invoicing.",
  ],
  requestInvoiceReview: ["Prüfung anfordern", "Request review"],
  invoiceReviewPending: ["Prüfung angefordert", "Review requested"],
  invoiceReviewResolved: ["Prüfung abgeschlossen", "Review completed"],
  invoiceReviewQueue: [
    "Prüfung stornierter und teilweise freigegebener Buchungen",
    "Review cancelled and partially released assignments",
  ],
  invoiceReviewCancelled: ["Buchung storniert", "Assignment cancelled"],
  invoiceReviewPartial: [
    "Teilweise freigegebener Block",
    "Partially released block",
  ],
  invoiceReviewSchedule: [
    "Terminplan weicht vom angenommenen Block ab",
    "Scheduled sessions differ from the accepted block",
  ],
  invoiceReviewResolutionNote: [
    "Prüfnotiz (mindestens 10 Zeichen)",
    "Review note (at least 10 characters)",
  ],
  resolveInvoiceReview: ["Prüfung dokumentieren", "Record review"],
  invoiceReviewAuditNote: [
    "Dies dokumentiert nur die Prüfung; Rechnung und Zahlungsstatus werden nicht geändert.",
    "This records the review only; it does not change the invoice or payment status.",
  ],
  openInvoiceException: [
    "Ausnahmeabrechnung vorbereiten",
    "Prepare an exceptional invoice",
  ],
  manageInvoiceException: ["Freigabe verwalten", "Manage approval"],
  invoiceExceptionHelp: [
    "Wähle die ausgeführte Vertragsfassung und gib den geprüften Betrag und die vereinbarte Fälligkeit an. Die Freigabe erlaubt die Einreichung einer Schlussrechnung.",
    "Select the executed contract version and enter the reviewed amount and agreed due date. Approval allows the lecturer to submit a final invoice.",
  ],
  invoiceExceptionContract: ["Vertragsfassung", "Contract version"],
  invoiceExceptionContractVersion: [
    "Vertragsfassung {{version}}",
    "Contract version {{version}}",
  ],
  invoiceExceptionMissingContract: [
    "Keine passende ausgeführte Vertragsfassung gefunden.",
    "No matching executed contract version is available.",
  ],
  invoiceExceptionNotReady: [
    "Das Portal kann den Auftrag derzeit nicht für eine Schlussrechnung freigeben. Prüfe den Auftragsstatus, die verbleibenden Termine und bereits eingereichte Rechnungen.",
    "This assignment is currently unavailable for final invoice approval. Check its status, remaining sessions and any existing invoices.",
  ],
  invoiceExceptionMaximum: ["Höchstbetrag: {{amount}}", "Maximum: {{amount}}"],
  invoiceExceptionUseWorksheet: [
    "Geprüfte Summe aus Berechnung übernehmen",
    "Use reviewed worksheet total",
  ],
  invoiceExceptionAmount: [
    "Geprüfter Betrag ({{currency}})",
    "Reviewed amount ({{currency}})",
  ],
  invoiceExceptionDue: ["Vereinbarte Fälligkeit", "Agreed due date"],
  invoiceExceptionApprove: [
    "Schlussrechnung zur Einreichung freigeben",
    "Allow final invoice submission",
  ],
  invoiceExceptionReady: [
    "Zur Einreichung freigegeben",
    "Ready for submission",
  ],
  invoiceExceptionRevoke: [
    "Einreichungsfreigabe widerrufen",
    "Revoke submission approval",
  ],
  invoiceExceptionRevokeNote: [
    "Widerrufsgrund (mindestens 10 Zeichen)",
    "Reason for revocation (at least 10 characters)",
  ],
  invoiceExceptionConflict: [
    "Die Freigabe konnte wegen eines geänderten Auftrags oder einer vorhandenen Rechnung nicht angewendet werden. Prüfe den aktuellen Stand.",
    "The approval could not be applied because the assignment changed or an invoice exists. Check the current status.",
  ],
  financePendingInvoiceExceptions: [
    "Ausnahmerechnungen zur Einreichung freigegeben",
    "Exceptional invoices awaiting submission",
  ],
  approvedInvoiceExceptions: [
    "Freigegebene Ausnahmeabrechnungen",
    "Approved exceptional invoices",
  ],
  submitInvoiceException: [
    "Ausnahmerechnung einreichen",
    "Submit exceptional invoice",
  ],
  invoiceExceptionPdfHelp: [
    "Lade die Schlussrechnung als PDF hoch. Betrag und Fälligkeit werden aus der Freigabe übernommen.",
    "Upload the final invoice PDF. The amount and due date come from the approval.",
  ],
  correctionHeading: [
    "Korrektur überzahlter Abschläge",
    "Correction of excess interim payments",
  ],
  correctionPropose: [
    "Überzahlung zur Prüfung vorlegen",
    "Propose an overpayment correction",
  ],
  correctionProposalHelp: [
    "Prüfe Vertragsfassung, Abschlagszahlungen und die vereinbarte Rückzahlungsfrist. Die dozierende Person erhält den Vorschlag zur Bestätigung.",
    "Verify the contract version, interim receipts and agreed repayment date. The lecturer receives the proposal for confirmation.",
  ],
  correctionSend: ["Korrektur vorlegen", "Submit correction proposal"],
  correctionReviewed: [
    "Geprüfter Gesamtanspruch",
    "Reviewed total entitlement",
  ],
  correctionInterimPaid: ["Gezahlte Abschläge", "Paid instalments"],
  correctionBalance: [
    "Saldo nach Abschlägen",
    "Balance after interim payments",
  ],
  correctionRepaymentAgreed: ["Vereinbarte Rückzahlung", "Agreed repayment"],
  correctionOutstanding: ["Offene Rückzahlung", "Remaining repayment"],
  correctionEvidence: [
    "Verrechnete Zahlungsbelege",
    "Credited payment records",
  ],
  correctionExport: [
    "Korrekturbeleg als CSV",
    "Download correction receipt as CSV",
  ],
  correctionAcknowledge: ["Korrektur bestätigen", "Acknowledge correction"],
  correctionConfirmDetails: [
    "Ich habe Vertragsfassung, Betrag, Zahlungsbelege und Fälligkeit geprüft und bestätige die Korrektur.",
    "I reviewed the contract version, amount, payment records and due date and agree to this correction.",
  ],
  correctionDispute: ["Korrektur beanstanden", "Dispute correction"],
  correctionWithdraw: ["Korrektur zurückziehen", "Withdraw correction"],
  correctionVoid: [
    "Rückzahlungseintrag berichtigen",
    "Void recorded repayment",
  ],
  correctionReason: [
    "Begründung (mindestens 10 Zeichen)",
    "Reason (at least 10 characters)",
  ],
  correctionDisputeReason: ["Einwand", "Dispute"],
  correctionWithdrawReason: ["Rücknahmegrund", "Withdrawal reason"],
  correctionCancel: ["Abbrechen", "Cancel"],
  correctionReceipt: ["Rückzahlungsbeleg", "Repayment receipt"],
  correctionReceiptReference: [
    "Referenz des Zahlungseingangs",
    "Repayment reference",
  ],
  correctionReceivedOn: ["Eingangsdatum", "Date received"],
  correctionReceiptVoided: ["Eintrag berichtigt", "Entry voided"],
  correctionRepaymentHistory: ["Erfasste Rückzahlungen", "Recorded repayments"],
  correctionRecordReceipt: [
    "Rückzahlungseingang erfassen",
    "Record received repayment",
  ],
  correctionActualReceiptHelp: [
    "Erfasse nur bereits erhaltenes Geld. Verwende das tatsächliche Eingangsdatum, auch wenn es vor der Bestätigung liegt.",
    "Record money already received. Use the actual receipt date, including when it precedes acknowledgement.",
  ],
  correctionDuplicateReceipt: [
    "Diese Zahlungsreferenz wurde bereits erfasst.",
    "This repayment reference has already been recorded.",
  ],
  correctionConflict: [
    "Der Stand der Korrektur hat sich geändert. Lade die aktuellen Daten und prüfe den offenen Betrag.",
    "The correction has changed. Reload the latest details and check the outstanding amount.",
  ],
  correctionStatus_proposed: [
    "Bestätigung ausstehend",
    "Awaiting confirmation",
  ],
  correctionStatus_stale: [
    "Erneute Finanzprüfung erforderlich",
    "Finance review required",
  ],
  correctionStatus_disputed: ["Beanstandet", "Disputed"],
  correctionStatus_acknowledged: [
    "Bestätigt · Rückzahlung offen",
    "Acknowledged · repayment outstanding",
  ],
  correctionStatus_settled: [
    "Rückzahlung vollständig erfasst",
    "Repayment fully recorded",
  ],
  correctionStatus_withdrawn: ["Zurückgezogen", "Withdrawn"],
  invoiceSeriesManage: ["Rechnungsserie öffnen", "Open invoice series"],
  invoiceSeriesInterim: ["Abschlagsrechnung", "Interim invoice"],
  invoiceSeriesFinal: [
    "Schlussrechnung mit Verrechnung",
    "Final invoice with credits",
  ],
  invoiceSeriesInterimHelp: [
    "Prüfe die bereits erbrachte Leistung, die Vertragsfassung und die vereinbarte Fälligkeit des Abschlags.",
    "Review the delivered work, contract version and agreed interim due date.",
  ],
  invoiceSeriesFinalHelp: [
    "Gib den gesamten geprüften Anspruch ein. Erfasste Abschlagszahlungen werden abgezogen. Bei einem Restbetrag von null schließt die PDF den Vorgang nach der Rechnungsprüfung ab.",
    "Enter the full reviewed entitlement. Recorded interim payments are applied as credits. If the balance is zero, the PDF closes the series after invoice review.",
  ],
  invoiceSeriesDue: ["Fällig am {{date}}", "Due {{date}}"],
  invoiceSeriesPayable: [
    "Rechnungsbetrag: {{amount}}",
    "Invoice amount: {{amount}}",
  ],
  invoiceSeriesReconciled: [
    "Verrechnete Abschlagszahlungen: {{amount}}",
    "Credited interim payments: {{amount}}",
  ],
  invoiceSeriesGross: [
    "Geprüfter Gesamtanspruch: {{amount}}",
    "Reviewed total entitlement: {{amount}}",
  ],
  invoiceSeriesGrossField: [
    "Geprüfter Gesamtanspruch ({{currency}})",
    "Reviewed total entitlement ({{currency}})",
  ],
  invoiceSeriesReceived: [
    "Erfasste Abschlagszahlungen: {{amount}}",
    "Recorded interim payments: {{amount}}",
  ],
  invoiceSeriesFullyCredited: ["Vollständig verrechnet", "Fully credited"],
  invoiceSeriesWaiting: [
    "Rechnungsserien zur Einreichung",
    "Invoices in a series awaiting submission",
  ],
  invoiceSeriesNeedsReview: [
    "Erneute Prüfung erforderlich",
    "Further review required",
  ],
  invoiceSeriesRevoked: ["Freigabe widerrufen", "Approval revoked"],
  invoiceSeriesStale: [
    "Die Abrechnungsgrundlage hat sich geändert. Die Finanzverwaltung muss die Rechnungsserie erneut prüfen.",
    "The settlement basis changed. Finance must review the invoice series again.",
  ],
  invoiceSeriesApprove: ["Einreichung freigeben", "Allow invoice submission"],
  invoiceSeriesUnavailable: [
    "Zurzeit kann keine weitere Rechnung freigegeben werden. Prüfe den Auftragsstand, offene Freigaben und die erfassten Zahlungen.",
    "Another invoice is currently unavailable. Check the assignment, outstanding approvals and recorded payments.",
  ],
  invoiceSeriesSubmitInterim: [
    "Abschlagsrechnung einreichen",
    "Submit interim invoice",
  ],
  invoiceSeriesSubmitFinal: [
    "Schlussrechnung mit Verrechnung einreichen",
    "Submit final invoice with credits",
  ],
  invoiceSeriesPdfHelp: [
    "Lade die Rechnung als PDF hoch. Fälligkeit und Rechnungsbetrag stammen aus der Freigabe.",
    "Upload the invoice PDF. Its due date and amount come from the approval.",
  ],
  invoiceSeriesCorrectionLocked: [
    "Diese Zahlung wurde in einer Schlussrechnung verrechnet. Storniere zuerst die Schlussrechnung und erfasse dann die Korrektur.",
    "This payment was credited on a final invoice. Cancel the final invoice before recording the correction.",
  ],
  invoiceNotReady: [
    "Der letzte geplante Unterrichtstermin hat noch nicht geendet.",
    "The last scheduled session has not ended yet.",
  ],
  invoiceDueDefault: [
    "Ohne Angabe ist die Rechnung am {{date}} fällig (30 Tage nach Rechnungsdatum).",
    "Leave blank to use {{date}} as the due date (30 days after issue).",
  ],
  invoiceSelectionChanged: [
    "Mindestens ein ausgewählter Auftrag kann nicht mehr abgerechnet werden.",
    "At least one selected assignment can no longer be invoiced.",
  ],
  invoiceRemoveUnavailable: [
    "Nicht verfügbare Aufträge abwählen",
    "Deselect unavailable assignments",
  ],
  invoiceReviewFailed: [
    "Die Prüfung konnte nicht bestätigt werden.",
    "The review request could not be confirmed.",
  ],
  approve: ["Rechnung freigeben", "Approve invoice"],
  reject: ["Rechnung ablehnen", "Reject invoice"],
  cancelInvoice: ["Rechnung stornieren", "Cancel invoice"],
  payment: ["Zahlung eintragen", "Record payment"],
  paymentHint: [
    "Hier dokumentierst du eine bereits erfolgte Zahlung. Es wird keine Banküberweisung ausgelöst.",
    "Record a payment that has already been made. This does not initiate a bank transfer.",
  ],
  paymentAmount: ["Zahlungsbetrag", "Payment amount"],
  paymentAt: ["Zahlungszeitpunkt", "Payment date and time"],
  reference: ["Verwendungszweck / Referenz", "Payment reference"],
  paymentSave: ["Zahlung speichern", "Save payment"],
  paymentHistory: ["Zahlungsverlauf", "Payment history"],
  noPayments: ["Noch keine Zahlung erfasst.", "No payment recorded yet."],
  paymentBy: ["Erfasst von {{name}}", "Recorded by {{name}}"],
  dateInvalid: [
    "Bitte wähle gültige, eindeutige Zeitpunkte und ein späteres Ablaufdatum.",
    "Choose valid, unambiguous dates and a later expiry date.",
  ],
  invoiceDateInvalid: [
    "Das Fälligkeitsdatum darf nicht vor dem Rechnungsdatum liegen.",
    "The due date cannot be before the issue date.",
  ],
  paymentInvalid: [
    "Der Betrag muss größer als null sein und darf den offenen Rechnungsbetrag nicht überschreiten.",
    "The amount must be positive and must not exceed the invoice balance.",
  ],
};
for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "commercial",
    Object.fromEntries(
      Object.entries(pairs).map(([key, value]) => [key, value[index]]),
    ),
    true,
    true,
  );
