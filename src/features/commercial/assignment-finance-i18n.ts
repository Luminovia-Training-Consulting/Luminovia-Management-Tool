/** German and English labels for scoped reconciliation and PDF download. */
import i18n from "../../lib/i18n";
const titles = {
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
