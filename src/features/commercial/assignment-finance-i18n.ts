/** German and English labels for scoped reconciliation and PDF download. */
import i18n from "../../lib/i18n";
const titles = {
  exportTitle: [
    "Auftragsabrechnungen exportieren",
    "Export assignment settlements",
  ],
  exportDialogTitle: ["Abrechnung exportieren", "Export settlements"],
  exportDescription: [
    "Wähle bis zu 93 Tage. Der Export umfasst Aufträge mit Terminen im Zeitraum und zeigt ihre aktuellen Abrechnungsstände in Originalwährung. Bei Aufträgen ohne Termine zählt das Annahmedatum.",
    "Select up to 93 days. The export includes assignments with sessions in the period and shows their current settlement in the original currency. Assignments without sessions use the acceptance date.",
  ],
  exportFrom: ["Von", "From"],
  exportThrough: ["Bis einschließlich", "Through"],
  exportPeriod: [
    "Wähle einen gültigen Zeitraum von höchstens 93 Tagen.",
    "Choose a valid period of up to 93 days.",
  ],
  exportLimit: [
    "Mehr als 1.000 Aufträge im Zeitraum. Verkürze den Zeitraum.",
    "More than 1,000 assignments match. Shorten the period.",
  ],
  exportFailure: [
    "Die Abrechnung konnte nicht exportiert werden.",
    "The settlement export could not be downloaded.",
  ],
  exportEmpty: [
    "Für diesen Zeitraum sind keine Aufträge vorhanden.",
    "No assignments match this period.",
  ],
  exportReady: [
    "Der Abrechnungsexport wurde zum Download bereitgestellt.",
    "The settlement export is ready to download.",
  ],
  exportPending: ["Export wird erstellt …", "Preparing export…"],
  exportCsv: ["CSV herunterladen", "Download CSV"],
  exportJson: ["JSON herunterladen", "Download JSON"],
  reconciliation: ["Auftrag abrechnen und abgleichen", "Reconcile assignment"],
  confirmation: ["Auftragsbestätigung als PDF", "Assignment confirmation PDF"],
  downloadError: [
    "Die Auftragsbestätigung ist nicht verfügbar.",
    "The assignment confirmation is unavailable.",
  ],
  agreedLecturer: ["Vereinbartes Honorar", "Agreed lecturer compensation"],
  agreedCustomer: ["Vereinbarter Kundenbetrag", "Agreed customer revenue"],
  adjustments: ["Genehmigte Honoraränderungen", "Approved fee adjustments"],
  margin: ["Vereinbarte Marge vor Auslagen", "Agreed margin before expenses"],
  cancellation: [
    "Genehmigtes Ausfallhonorar",
    "Approved cancellation compensation",
  ],
  delivery: ["Eingereichte Zeiterfassung", "Submitted timesheet time"],
  confirmedDelivery: ["Bestätigte Durchführung", "Confirmed teaching delivery"],
  approvedTime: ["Geprüfte Unterrichtszeit", "Approved teaching time"],
  lecturerInvoices: ["Dozierendenrechnungen", "Lecturer invoices"],
  customerInvoice: ["Kundenrechnung", "Customer invoice"],
  grouped: [
    "Diese Rechnung umfasst mehrere Aufträge. Zahlungen werden auf Rechnungsebene abgeglichen.",
    "This invoice covers multiple assignments. Payments are reconciled at the invoice level.",
  ],
  invoiced: ["In Rechnung gestellt", "Invoiced"],
  netInvoice: [
    "Rechnungsbetrag nach Gutschriften",
    "Invoice amount after credits",
  ],
  received: ["Zahlungseingang", "Payments received"],
  retained: [
    "Zahlungseingang nach Erstattungen",
    "Payments retained after refunds",
  ],
  paid: ["Gezahlt", "Paid"],
  outstanding: ["Offen", "Outstanding"],
  approved: ["Genehmigt", "Approved"],
  expenses: [
    "Auslagen in Originalwährung",
    "Expenses in the original currency",
  ],
  "state.submitted": ["Eingereicht", "Submitted"],
  "state.approved": ["Genehmigt", "Approved"],
  "state.paid": ["Bezahlt", "Paid"],
} as const;

for (const [locale, index] of [
  ["de", 0],
  ["en", 1],
] as const) {
  i18n.addResourceBundle(
    locale,
    "assignmentFinance",
    Object.fromEntries(
      Object.entries(titles).map(([key, pair]) => [key, pair[index]]),
    ),
    true,
    true,
  );
}
