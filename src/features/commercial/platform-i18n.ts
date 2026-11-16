/**
 * DE/EN-Oberflächentexte für platform. Die Registrierung erweitert i18next beim Modulimport; verfasste Fachinhalte werden nicht automatisch übersetzt.
 */
import i18n from "../../lib/i18n";
const pairs: Record<string, [string, string]> = {
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

  clientPortal: ["Kundenportal", "Client portal"],
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
  grossRate: ["Voller Auftragspreis je Einheit", "Full client fee per unit"],
  grossTotal: ["Voller Auftragspreis gesamt", "Full total client fee"],
  platformPercent: ["Plattformanteil (%)", "Platform share (%)"],
  lecturerShare: ["Dozierendenhonorar", "Lecturer compensation"],
  platformShare: ["Plattformanteil", "Platform share"],
  splitHint: [
    "Standard: 50 % Plattform und 50 % Dozierendenhonorar. Die Freigabe speichert die Aufteilung serverseitig; angenommene Konditionen bleiben unverändert.",
    "Default: 50% platform and 50% lecturer compensation. Confirmation stores the split on the server; accepted terms stay unchanged.",
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
    "Review every session and the full client fee. Lecturers see only their compensation.",
  ],
  assignedTeacher: ["Zugewiesene Lehrkraft", "Assigned lecturer"],
  unassigned: ["Noch keine Lehrkraft zugeteilt", "No lecturer assigned yet"],
  requestVolume: ["Angefragtes Auftragsvolumen", "Requested assignment volume"],
  confirmedSpend: ["Bestätigte Auftragssumme", "Confirmed assignment spend"],
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
    "Known accepted full client fees",
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
  invalidSessions: [
    "Prüfe die Termine und ihre Zeitzone. Ende und Beginn müssen eindeutig und in der richtigen Reihenfolge liegen.",
    "Check the sessions and their time zone. Start and end must be unambiguous and correctly ordered.",
  ],
  requestFailed: [
    "Die Anfrage wurde nicht bestätigt. Deine Eingaben bleiben erhalten.",
    "The request was not confirmed. Your entries are retained.",
  ],
  addSession: ["Termin hinzufügen", "Add session"],
  newCustomer: ["Neuen Kunden anlegen", "Create a new client"],
  existingCustomer: [
    "Vorhandener Kunde (optional)",
    "Existing client (optional)",
  ],
  invoiceSearch: ["Rechnungen durchsuchen", "Search invoices"],
  invoiceStatus: ["Rechnungsstatus", "Invoice status"],
  allStatuses: ["Alle Status", "All statuses"],
  allCurrencies: ["Alle Währungen", "All currencies"],
  requestStatus: ["Anfragestatus", "Request status"],
  platformVisibility: [
    "Volle Auftragspreise und Plattformanteile sind nur für die autorisierten Rollen sichtbar.",
    "Full client fees and platform shares are shown only to authorised roles.",
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
