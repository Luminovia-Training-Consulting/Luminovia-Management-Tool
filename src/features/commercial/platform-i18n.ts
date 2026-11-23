/**
 * DE/EN UI resources for the platform namespace. Module import registers these strings with
 * i18next; authored business content is not translated.
 */
import i18n from "../../lib/i18n";

const pairs: Record<string, [string, string]> = {
  companyRejectedHeading: ["Abgelehnte Dozierende", "Rejected lecturers"],
  companyRejectedHelp: [
    "Diese Personen können diesen Auftrag nicht erneut annehmen, solange du die Ablehnung nicht aufhebst.",
    "These people cannot claim this assignment again while the rejection remains in place.",
  ],
  companyRejectionRelease: ["Ablehnung aufheben", "Lift rejection"],
  companyRejectionReleaseConfirm: [
    "Ablehnung verbindlich aufheben",
    "Confirm lifting rejection",
  ],
  companyRejectionReleaseHelp: [
    "Die Person darf den Auftrag wieder annehmen. Damit wird sie nicht automatisch zugewiesen.",
    "The person may claim the assignment again. This does not assign them automatically.",
  ],
  companyRejectionListError: [
    "Die Liste abgelehnter Dozierender konnte nicht geladen werden.",
    "The list of rejected lecturers could not be loaded.",
  ],
  companyRejectionReleaseError: [
    "Die Ablehnung konnte nicht aufgehoben werden. Bitte versuche es erneut.",
    "The rejection could not be lifted. Please try again.",
  ],
  companyOpenJob: ["Auftrag öffnen", "Open assignment"],
  companyOtherJobs: ["Weitere Aufträge", "Other assignments"],
  companyDecisionHeading: ["Dozierende bestätigen", "Confirm lecturers"],
  companyDecisionLoading: [
    "Entscheidungen werden geladen …",
    "Loading decisions …",
  ],
  companyDecisionFailed: [
    "Die Entscheidung konnte nicht geladen oder gespeichert werden. Bitte erneut versuchen; für bereits berechnete Aufträge wende dich an die Verwaltung.",
    "The decision could not be loaded or saved. Please retry; contact management if the assignment was already invoiced.",
  ],
  companyDecisionPending: ["Entscheidung offen", "Decision pending"],
  companyDecisionAccepted: ["Bestätigt", "Accepted"],
  companyDecisionReviewRequired: [
    "Ablehnung vorgemerkt – Abrechnung muss geprüft werden; der Einsatz bleibt bestehen.",
    "Rejection recorded – finance review pending; the assignment remains active.",
  ],
  companyFinanceReviews: [
    "Vorgemerkte Ablehnungen mit Rechnung",
    "Rejection requests with invoices",
  ],
  companyFinanceHint: [
    "Die Rechnung und der Einsatz bleiben bestehen. Prüfe die Abrechnung und kläre die Ablehnung über die bestehenden Rechnungs- und Auftragsabläufe.",
    "The invoice and assignment remain active. Review the billing and resolve the rejection through the existing invoice and assignment workflows.",
  ],
  companyFinanceResolve: ["Prüfung abschließen", "Complete review"],
  companyFinanceResolveHint: [
    "Storniere oder lehne zuerst alle zugehörigen Rechnungen ab und kläre aktive Zahlungen. Danach wird der Einsatz verbindlich freigegeben. Historische Rechnungen bleiben erhalten.",
    "First cancel or reject every related invoice and resolve any active payments. The assignment is then released. Historical invoices remain available.",
  ],
  companyFinanceNote: [
    "Dokumentation der Prüfung (mindestens 10 Zeichen)",
    "Review notes (at least 10 characters)",
  ],
  companyFinanceResolveConfirm: [
    "Prüfung abschließen und Einsatz freigeben",
    "Complete review and release assignment",
  ],
  companyFinanceResolveError: [
    "Die Prüfung konnte nicht abgeschlossen werden. Prüfe Rechnungs- und Zahlungsstatus sowie den Einsatzbeginn und versuche es erneut.",
    "The review could not be completed. Check invoice and payment status and the assignment start, then retry.",
  ],
  companyFinanceNone: [
    "Keine vorgemerkten Ablehnungen mit Rechnung.",
    "No pending rejection requests with invoices.",
  ],
  companyDecisionAutomatic: ["Automatisch bestätigt", "Automatically accepted"],
  companyDecisionDeadline: [
    "Ohne Entscheidung automatisch bestätigt ab {{deadline}} ({{zone}}).",
    "Automatically accepted without a decision after {{deadline}} ({{zone}}).",
  ],
  companyDecisionAccept: ["Bestätigen", "Accept"],
  companyDecisionReject: ["Ablehnen", "Reject"],
  companyDecisionRejectHint: [
    "Bis zum Beginn wird der Einsatz storniert; bei aktiven Angeboten wird der freie Platz wieder veröffentlicht. Ist bereits eine Rechnung vorhanden, wird die Ablehnung stattdessen vorgemerkt und die Abrechnung geprüft; der Einsatz bleibt bestehen.",
    "Before the start, the assignment is cancelled; positions on active offers are reopened. If an invoice exists, the rejection is recorded for finance review and the assignment remains active.",
  ],
  location: ["Ort / Link", "Location / link"],
  unknownGross: [
    "{{count}} angenommene Bestandsaufträge haben keine volle Preis-/Plattformhistorie. Ihre Dozierendenhonorare sind enthalten; unbekannte volle Preise werden nicht als null Euro ausgegeben.",
    "{{count}} accepted legacy assignments have no full-fee/platform history. Their lecturer compensation is included; unknown full fees are not presented as zero.",
  ],
  invoiceLabels: ["Rechnungslabels", "Invoice labels"],
  editInvoiceLabels: ["Rechnungslabels bearbeiten", "Edit invoice labels"],
  labelsHint: [
    "Bis zu 10 Labels mit je höchstens 50 Zeichen, durch Kommas getrennt.",
    "Up to 10 labels of 50 characters each, separated by commas.",
  ],
  allLabels: ["Alle Labels", "All labels"],
  labelsInvalid: [
    "Bitte prüfe Anzahl und Länge der Labels.",
    "Check the number and length of the labels.",
  ],

  clientPortal: ["Unternehmensportal", "Company portal"],
  clientIntro: [
    "Kurse und Lehraufträge anfragen, volle Auftragspreise prüfen und dein Team im Blick behalten.",
    "Request courses and teaching assignments, review full assignment fees and see your teaching team.",
  ],
  organisations: ["Organisation", "Organisation"],
  allOrganisations: ["Alle Organisationen", "All organisations"],
  chooseOrganisation: ["Organisation auswählen", "Choose an organisation"],
  newRequest: ["Kurs anfragen", "Request a course"],
  requestHint: [
    "Diese Anfrage reserviert noch keine Lehrkraft. Luminovia prüft und veröffentlicht das Angebot separat.",
    "A request does not reserve a lecturer. Luminovia reviews and publishes the offer separately.",
  ],
  requestSave: ["Anfrage verbindlich speichern", "Save request"],
  requests: ["Kursanfragen & Aufträge", "Course requests & assignments"],
  noRequests: ["Noch keine Kursanfragen vorhanden.", "No course requests yet."],
  noMembership: [
    "Deinem Konto ist noch keine aktive Organisation zugeordnet.",
    "Your account has no active organisation membership yet.",
  ],
  grossRate: ["Voller Auftragspreis je Einheit", "Full contract fee per unit"],
  grossTotal: ["Voller Auftragspreis gesamt", "Full total contract fee"],
  platformPercent: ["Plattformanteil (%)", "Platform share (%)"],
  lecturerShare: ["Dozierendenhonorar", "Lecturer compensation"],
  regularLecturer: ["Dozent:in", "Lecturer"],
  seniorLecturer: ["Senior-Dozent:in", "Senior lecturer"],
  privateCompensation: ["Honorar geschützt", "Compensation restricted"],
  compensationPolicy: ["Vergütungsregeln", "Compensation policy"],
  compensationPolicyHint: [
    "Diese vertraulichen Regeln sind ausschließlich für die Administration sichtbar. Bereits vereinbarte Honorare bleiben erhalten.",
    "These confidential rules are visible only to administration. Already accepted compensation is preserved.",
  ],
  policyMissing: [
    "Lege vor der Veröffentlichung die Vergütungsregeln fest.",
    "Set the compensation policy before publishing an offer.",
  ],
  regularPercent: [
    "Dozent:in – Honorar vom Auftragspreis (%)",
    "Lecturer – compensation from contract fee (%)",
  ],
  seniorPercent: [
    "Senior-Dozent:in – Honorar vom Auftragspreis (%)",
    "Senior lecturer – compensation from contract fee (%)",
  ],
  savePolicy: ["Vergütungsregeln speichern", "Save compensation policy"],
  reloadPolicy: ["Aktuelle Regeln laden", "Load current policy"],
  policySaved: [
    "Vergütungsregeln wurden bestätigt.",
    "Compensation policy confirmed.",
  ],
  policyError: [
    "Die Regeln wurden nicht bestätigt. Prüfe deine Eingaben und lade bei einer parallelen Änderung die aktuellen Werte neu.",
    "The policy was not confirmed. Check your entries and reload the current values after a concurrent change.",
  ],
  platformShare: ["Plattformanteil", "Platform share"],
  splitHint: [
    "Das verbindliche Honorar wird bei der Annahme serverseitig gespeichert und bleibt danach unverändert.",
    "The server records the binding fee at acceptance. Accepted terms stay unchanged.",
  ],
  feeBasis: [
    "Preisaufteilung der Vergütung; keine Umsatzsteuerberechnung.",
    "Compensation fee split; no tax calculation.",
  ],
  requestSubmitted: ["Eingereicht", "Submitted"],
  requestPublished: ["Veröffentlicht", "Published"],
  requestAssigned: ["Lehrkraft zugeteilt", "Lecturer assigned"],
  requestCancelled: ["Storniert", "Cancelled"],
  cancelRequest: ["Anfrage stornieren", "Cancel request"],
  cancelTitle: ["Anfrage stornieren?", "Cancel request?"],
  cancelHint: [
    "Nur eine noch nicht veröffentlichte Anfrage kann storniert werden.",
    "Only a request that has not been published can be cancelled.",
  ],
  publishRequest: [
    "Als Lehrauftrag veröffentlichen",
    "Publish teaching assignment",
  ],
  publishHint: [
    "Prüfe alle Termine und den vollen Auftragspreis. Dozierende sehen ausschließlich ihr eigenes Honorar.",
    "Review every session and the full contract fee. Lecturers see only their compensation.",
  ],
  assignedTeacher: ["Zugewiesene Lehrkraft", "Assigned lecturer"],
  unassigned: ["Noch keine Lehrkraft zugeteilt", "No lecturer assigned yet"],
  requestVolume: ["Angefragtes Auftragsvolumen", "Requested assignment volume"],
  confirmedSpend: ["Bestätigte Auftragssumme", "Confirmed assignment spend"],
  monthlyAcceptedSpending: [
    "Angenommene Auftragssummen pro Monat",
    "Accepted assignment fees by month",
  ],
  monthlyAcceptedSpendingHint: [
    "Die letzten zwölf Monate aus unveränderlichen, angenommenen Bruttopreisen in der jeweiligen Originalwährung und Unternehmenszeitzone. Historische Stornierungen bleiben in den Annahmen enthalten; dies ist keine Zahlungsübersicht.",
    "The last twelve months of immutable accepted gross fees, in each original currency and company time zone. Historical cancellations remain in accepted totals; this is not a payment report.",
  ],
  noAcceptedSpending: [
    "Noch keine angenommenen Aufträge mit bekanntem Bruttopreis.",
    "No accepted assignments with a known gross fee yet.",
  ],
  companySpendingExport: [
    "Auftragssummen als CSV laden",
    "Download fees as CSV",
  ],
  companySpendingExportBusy: ["CSV wird erstellt …", "Preparing CSV …"],
  companySpendingExportFailed: [
    "Die aktuellen Auftragssummen konnten nicht exportiert werden.",
    "The current accepted fees could not be exported.",
  ],
  companySpendingExportOrganisation: ["Unternehmen", "Company"],
  companySpendingExportMonth: ["Monat", "Month"],
  companySpendingExportCurrency: ["Währung", "Currency"],
  acceptedAssignmentsCount: [
    "{{count}} angenommene Aufträge",
    "{{count}} accepted assignments",
  ],
  teachers: ["Zugewiesene Lehrkräfte", "Assigned lecturers"],
  revenue: [
    "Auftragsvolumen & Plattformerlöse",
    "Assignment volume & platform revenue",
  ],
  revenueHint: [
    "Angebotsvolumen und angenommene Konditionen getrennt, jeweils in der Originalwährung.",
    "Offer volume and accepted terms shown separately, in the original currency.",
  ],
  offeredGross: ["Bekanntes volles Angebotsvolumen", "Known full offer fees"],
  acceptedGross: [
    "Bekannte angenommene Auftragssumme",
    "Known accepted full contract fees",
  ],
  acceptedNet: [
    "Vereinbarte Dozierendenhonorare",
    "Accepted lecturer compensation",
  ],
  acceptedPlatform: [
    "Bekannter vereinbarter Plattformanteil",
    "Known accepted platform share",
  ],
  revenueEmpty: [
    "Noch keine Aufträge mit hinterlegter Preisaufteilung.",
    "No assignments with a recorded fee split yet.",
  ],
  exportRevenue: ["Aufteilung als CSV", "Export fee split CSV"],
  configurePrice: ["Preisaufteilung bearbeiten", "Edit fee split"],
  pricingTitle: ["Auftragspreis & Aufteilung", "Assignment price & split"],
  acceptedImmutable: [
    "Die angenommene Preisaufteilung ist unveränderlich.",
    "The accepted fee split is immutable.",
  ],
  legacyPricing: [
    "Bestandsauftrag ohne hinterlegte Plattformaufteilung. Sein vereinbartes Honorar bleibt erhalten.",
    "Legacy assignment without a recorded platform split. Its accepted compensation is retained.",
  ],
  savePrice: ["Preisaufteilung speichern", "Save fee split"],
  priceFailed: [
    "Die Preisaufteilung wurde nicht bestätigt. Prüfe die Eingaben und den aktuellen Auftragsstatus.",
    "The fee split was not confirmed. Check your input and the current assignment status.",
  ],
  netTotal: ["Dozierendenhonorar gesamt", "Total lecturer compensation"],
  ownCompensation: ["Dein vereinbartes Honorar", "Your accepted compensation"],
  searchRequests: ["Anfragen suchen", "Search requests"],
  pricePreview: ["Vorschau der Vergütung", "Compensation preview"],
  courseCommission: [
    "Plattformanteil für diesen Auftrag (%)",
    "Platform share for this offer (%)",
  ],
  courseCommissionHint: [
    "Leer lassen, um Rollen- und individuelle Honorare zu verwenden. Ein eingetragener Anteil gilt für jede Position dieses Angebots und legt das sichtbare Dozierendenhonorar fest.",
    "Leave blank to use role and individual rates. An entered share applies to each position and sets the fee shown to lecturers.",
  ],
  courseCommissionNetHint: [
    "Leer lassen, um das Honorar ohne Plattformanteil einzugeben. Ein eingetragener Anteil wechselt zum vollen Auftragspreis.",
    "Leave blank to enter the fee without a platform share. An entered share switches to the full customer price.",
  ],
  courseCommissionRequired: [
    "Gib den Plattformanteil für jede Position dieses Angebots an.",
    "Enter the platform share for each position of this offer.",
  ],
  courseCommissionPreview: [
    "Dozierendenhonorar und Plattformanteil pro Position",
    "Lecturer fee and platform share per position",
  ],
  invalidSessions: [
    "Prüfe die Termine und ihre Zeitzone. Ende und Beginn müssen eindeutig und in der richtigen Reihenfolge liegen.",
    "Check the sessions and their time zone. Start and end must be unambiguous and correctly ordered.",
  ],
  requestFailed: [
    "Die Anfrage wurde nicht bestätigt. Deine Eingaben bleiben erhalten.",
    "The request was not confirmed. Your entries are retained.",
  ],
  addSession: ["Termin hinzufügen", "Add session"],
  newCustomer: ["Neues Unternehmen anlegen", "Create a company"],
  existingCustomer: [
    "Vorhandenes Unternehmen (optional)",
    "Existing company (optional)",
  ],
  invoiceSearch: ["Rechnungen durchsuchen", "Search invoices"],
  invoiceStatus: ["Rechnungsstatus", "Invoice status"],
  allStatuses: ["Alle Status", "All statuses"],
  allCurrencies: ["Alle Währungen", "All currencies"],
  requestStatus: ["Anfragestatus", "Request status"],
  platformVisibility: [
    "Volle Auftragspreise und Plattformanteile sind nur für die autorisierten Rollen sichtbar.",
    "Full contract fees and platform shares are shown only to authorised roles.",
  ],
};
for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "platform",
    Object.fromEntries(Object.entries(pairs).map(([k, v]) => [k, v[index]])),
    true,
    true,
  );
