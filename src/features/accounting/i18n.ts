/** Bilingual accounting controls and honest format/data limitations. Authored
 * invoice text and the stable machine interchange field names are not translated. */
import i18n from "../../lib/i18n";
const de = {
  title: "Buchhaltungsexporte",
  description:
    "Originalwährungen, dokumentierte Rechnungen und nachvollziehbare Exportstände.",
  source: "Rechnungsquelle",
  own: "Meine Dozierendenrechnungen",
  lecturer_all: "Alle Dozierendenrechnungen",
  customer: "Kundenrechnungen",
  empty: "Keine freigegebenen Rechnungen vorhanden.",
  select: "Rechnung {{number}} auswählen",
  number: "Rechnungsnummer",
  issued: "Rechnungsdatum",
  due: "Fällig am",
  currency: "Währung",
  total: "Dokumentierter Rechnungsbetrag",
  accepted: "Vereinbarter Kundenpreis",
  paid: "Erfasste Zahlungen",
  outstanding: "Offener Betrag",
  exportJson: "JSON-Export erstellen",
  exportCsv: "CSV-Export erstellen",
  selectHint:
    "Wähle bis zu 100 geladene Rechnungen. Exporte werden unveränderlich protokolliert und bei jedem Abruf erneut auf deine Berechtigung geprüft.",
  more: "Weitere Rechnungen laden",
  saved: "Vorgang vom Server bestätigt.",
  error:
    "Der Vorgang wurde nicht bestätigt. Prüfe deine Angaben und lade den aktuellen Stand.",
  offline:
    "Für Rechnungsänderungen und neue Exporte ist eine Online-Verbindung erforderlich.",
  refresh: "Aktuellen Stand laden",
  taxUnknown:
    "Steuerliche Netto-/Bruttobeträge und Umsatzsteuer sind nicht erfasst. Der dokumentierte Betrag wird unverändert exportiert; fehlende Steuerdaten bleiben leer.",
  einvoice: "Elektronische Rechnungsformate",
  einvoiceUnavailable:
    "XRechnung und ZUGFeRD können noch nicht erzeugt werden. Es fehlen verifizierte Verkäufer-/Käuferdaten, Steueraufschlüsselungen, Rechnungspositionen, elektronische Adressen und die eingerichtete Standardvalidierung.",
  canonical:
    "JSON und CSV verwenden das dokumentierte Portal-Austauschschema. Ein Import in DATEV oder eine andere Fremdsoftware ist noch nicht verifiziert.",
  register: "Externe Kundenrechnung erfassen",
  registerHint:
    "Erfasse eine bereits ausgestellte Rechnung mit einer eigenen, geprüften PDF und ihren tatsächlichen Werten. Die zugehörigen akzeptierten Kundenvereinbarungen bleiben unverändert.",
  claims: "Akzeptierte Kundenvereinbarungen",
  noClaims: "Keine noch nicht zugeordneten Kundenvereinbarungen vorhanden.",
  pdf: "PDF der ausgestellten Kundenrechnung hochladen",
  difference: "Begründung einer Abweichung",
  differenceHint:
    "Erforderlich, wenn der tatsächliche Rechnungsbetrag vom vereinbarten Kundenpreis abweicht. Eine steuerliche Behandlung wird nicht abgeleitet.",
  confirmDocument:
    "Ich habe Nummer, Daten, Betrag und Währung mit dieser ausgestellten PDF abgeglichen.",
  saveInvoice: "Rechnung dokumentieren",
  payment: "Zahlung dokumentieren",
  paymentAt: "Tatsächlicher Zahlungszeitpunkt (UTC)",
  reference: "Zahlungsreferenz",
  amount: "Betrag (z. B. 100.01)",
  savePayment: "Zahlung erfassen",
  paymentHint:
    "Dokumentiert einen bereits bekannten Zahlungseingang. Eine Banküberweisung wird dadurch nicht ausgelöst.",
  reverse: "Zahlungseintrag berichtigen",
  reverseReason: "Begründung der Zahlungsberichtigung",
  reverseButton: "Gegenbuchung dokumentieren",
  close: "Schließen",
  recorded: "Dokumentiert",
  status: "Status",
  submitted: "Eingereicht",
  approved: "Freigegeben",
  rejected: "Abgelehnt",
  cancelled: "Storniert",
  registered: "Erfasst",
  partially_paid: "Teilweise bezahlt",
  paidStatus: "Bezahlt",
  document: "Geprüfte Rechnungs-PDF herunterladen",
  exportReady: "Export {{id}} bestätigt · {{count}} Rechnungen",
  hash: "Prüfsumme",
  noTaxClaim:
    "Der vereinbarte volle Kundenpreis ist kein Nachweis eines steuerlichen Bruttobetrags.",
  original:
    "Werte bleiben in der ursprünglichen Währung; es findet keine Umrechnung statt.",
  paymentHistory: "Zahlungsverlauf",
  reversed: "Gegenbuchung",
  exportHistory:
    "Ein Export bleibt eine Aufnahme zum Erstellungszeitpunkt. Später erfasste Zahlungen erzeugen einen neuen Stand.",
  credits:
    "Gutschriften und Kundenrechnungsstornierungen benötigen einen eigenen Belegworkflow und werden hier nicht aus Beträgen abgeleitet.",
  invalid:
    "Prüfe Auswahl, Datumsangaben, exakte Dezimalbeträge, Währung und PDF.",
  selectedCount: "{{count}} ausgewählt",
};
const en: Record<keyof typeof de, string> = {
  title: "Accounting exports",
  description:
    "Original currencies, recorded invoices and auditable export snapshots.",
  source: "Invoice source",
  own: "My lecturer invoices",
  lecturer_all: "All lecturer invoices",
  customer: "Customer invoices",
  empty: "No authorized invoices available.",
  select: "Select invoice {{number}}",
  number: "Invoice number",
  issued: "Invoice date",
  due: "Due on",
  currency: "Currency",
  total: "Recorded invoice total",
  accepted: "Agreed customer charge",
  paid: "Recorded payments",
  outstanding: "Outstanding amount",
  exportJson: "Create JSON export",
  exportCsv: "Create CSV export",
  selectHint:
    "Select up to 100 loaded invoices. Exports are recorded immutably and your current access is checked again on every retrieval.",
  more: "Load more invoices",
  saved: "Operation confirmed by the server.",
  error:
    "The operation was not confirmed. Check your entries and reload the current records.",
  offline: "Invoice changes and new exports require an online connection.",
  refresh: "Reload current records",
  taxUnknown:
    "Tax net/gross amounts and VAT have not been recorded. The recorded total is exported unchanged; missing tax fields remain empty.",
  einvoice: "Electronic invoice formats",
  einvoiceUnavailable:
    "XRechnung and ZUGFeRD generation is not yet available. Verified seller/buyer details, tax breakdowns, invoice lines, electronic addresses and configured standard validation are missing.",
  canonical:
    "JSON and CSV use the documented Portal interchange schema. Import into DATEV or another third-party system has not been verified.",
  register: "Record an external customer invoice",
  registerHint:
    "Record an already issued invoice with a dedicated scanned PDF and its actual values. Associated accepted customer agreements remain unchanged.",
  claims: "Accepted customer agreements",
  noClaims: "No uninvoiced accepted customer agreements are available.",
  pdf: "Upload the issued customer invoice PDF",
  difference: "Explanation of a difference",
  differenceHint:
    "Required when the actual invoice total differs from the agreed customer charge. No tax treatment is inferred.",
  confirmDocument:
    "I checked the number, dates, amount and currency against this issued PDF.",
  saveInvoice: "Record invoice",
  payment: "Record payment",
  paymentAt: "Actual payment time (UTC)",
  reference: "Payment reference",
  amount: "Amount (for example 100.01)",
  savePayment: "Record payment",
  paymentHint:
    "Records a payment already known to have arrived. This does not initiate a bank transfer.",
  reverse: "Correct a payment entry",
  reverseReason: "Payment correction explanation",
  reverseButton: "Record reversal",
  close: "Close",
  recorded: "Recorded",
  status: "Status",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  registered: "Registered",
  partially_paid: "Partially paid",
  paidStatus: "Paid",
  document: "Download scanned invoice PDF",
  exportReady: "Export {{id}} confirmed · {{count}} invoices",
  hash: "Checksum",
  noTaxClaim:
    "An agreed full customer charge does not establish a tax gross amount.",
  original: "Values retain their original currency; no conversion is applied.",
  paymentHistory: "Payment history",
  reversed: "Reversal",
  exportHistory:
    "An export remains a snapshot at its creation time. Payments recorded later produce a new snapshot.",
  credits:
    "Credit notes and customer invoice cancellations require a separate evidence workflow and are not inferred from amounts here.",
  invalid: "Check selection, dates, exact decimals, currency and PDF.",
  selectedCount: "{{count}} selected",
};
i18n.addResourceBundle("de", "accounting", de, true, true);
i18n.addResourceBundle("en", "accounting", en, true, true);
