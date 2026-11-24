import i18n from "../../lib/i18n";

const labels = {
  description: [
    "Aufträge, Unterrichtszeiten und Finanzen im ausgewählten Zeitraum.",
    "Assignments, teaching time and finances for the selected period.",
  ],
  sampleNotice: [
    "Fiktive Beispieldaten. Für die Auswertung gilt der {{date}} als heutiges Datum.",
    "Fictional sample data. The report uses {{date}} as today.",
  ],
  sampleEmpty: [
    "Für diesen Zeitraum gibt es keine Beispieldaten.",
    "There is no sample data for this period.",
  ],
  sampleScenarioBasis: [
    "Beispiel für die nächsten 90 Tage. Die Annahmewahrscheinlichkeit gewichtet die Einnahmen und Kosten der offenen Aufträge.",
    "Example for the next 90 days. The acceptance probability weights revenue and costs for open work.",
  ],
  personal: ["Meine Aufträge", "My assignments"],
  company: ["Unternehmensansicht", "Company view"],
  staff: ["Management und Administration", "Management and administration"],
  scope: ["Ansicht", "View"],
  organisation: ["Unternehmen", "Company"],
  allOrganisations: [
    "Alle Unternehmen und Aufträge ohne Zuordnung",
    "All companies and unassigned work",
  ],
  period: ["Zeitraum", "Reporting period"],
  around: ["Vergangenheit und Vorschau", "History and outlook"],
  historyYear: ["Letzte 12 Monate bis heute", "Last 12 months to date"],
  nextQuarter: ["Nächste 90 Tage", "Next 90 days"],
  yearToDate: ["Dieses Jahr bis heute", "Year to date"],
  previousQuarter: [
    "Letztes abgeschlossenes Quartal",
    "Last completed quarter",
  ],
  resetFilters: ["Filter zurücksetzen", "Reset filters"],
  customDates: ["Eigenen Zeitraum wählen", "Choose custom dates"],
  companySearch: ["Unternehmen suchen", "Search companies"],
  noCompanyMatches: ["Keine passenden Unternehmen", "No matching companies"],
  timelineFilter: ["Zeige im Auftragsdiagramm", "Show in the assignment chart"],
  allSeries: ["Alle Zeitstatus", "All time statuses"],
  forecastWindow: ["Vorschauzeitraum", "Forecast window"],
  forecastDays: ["Nächste {{count}} Tage", "Next {{count}} days"],
  emptyScenario: [
    "Für diese Währung liegen keine Vorschauwerte vor.",
    "There are no forecast values in this currency.",
  ],
  cumulative: ["Kumuliert", "Cumulative"],
  monthly: ["Monatswerte", "Monthly values"],
  financeView: ["Darstellung", "Display"],
  cumulativeData: [
    "Kumulierte Werte als Tabelle",
    "Cumulative values as a table",
  ],
  custom: ["Benutzerdefinierter Zeitraum", "Custom dates"],
  from: ["Von", "From"],
  through: ["Bis einschließlich", "Through"],
  apply: ["Zeitraum anwenden", "Apply dates"],
  invalidPeriod: [
    "Wähle einen gültigen Zeitraum von höchstens 731 Tagen.",
    "Choose a valid range of up to 731 days.",
  ],
  unavailable: [
    "Für dieses Konto sind keine Analysen verfügbar.",
    "Analytics are unavailable for this account.",
  ],
  timeZone: [
    "Zeitzone der Auswertung: {{zone}}",
    "Reporting time zone: {{zone}}",
  ],
  currency: ["Währung", "Currency"],
  past: ["Vergangen", "Past"],
  future: ["Bevorstehend", "Upcoming"],
  monthlyMetric: ["Kennzahl im Monatsvergleich", "Monthly metric"],
  assignments: ["Bestätigte Aufträge", "Confirmed assignments"],
  monthlyHours: ["Unterrichtsstunden pro Monat", "Teaching hours by month"],
  allocationNote: [
    "Jeder Auftrag zählt im Monat seines ersten aktiven Termins. Mehrtägige Aufträge zählen einmal. Freigegebene Termine sind ausgeschlossen.",
    "Each assignment counts in the month of its first active session. Multi-day assignments count once. Released sessions are excluded.",
  ],
  open: ["Offene Plätze", "Open positions"],
  openNote: [
    "Noch besetzbare Plätze in veröffentlichten Aufträgen mit künftigem Beginn.",
    "Unfilled positions in published assignments with a future start.",
  ],
  hours: ["Unterrichtszeit laut Terminplan", "Scheduled teaching time"],
  hoursNote: [
    "Vergangene und künftige Stunden stammen aus dem Terminplan. Monatsgrenzen teilen die Dauer auf.",
    "Past and upcoming hours come from the timetable. Time is split across month boundaries.",
  ],
  scheduledHours: ["{{value}} Std.", "{{value}} hr"],
  emptyHours: [
    "Keine Unterrichtszeit in diesem Zeitraum.",
    "No scheduled teaching time in this period.",
  ],
  month: ["Monat", "Month"],
  data: ["Monatswerte als Tabelle", "Monthly values as a table"],
  financialTrend: ["Finanzverlauf", "Financial trend"],
  financeMetric: ["Kennzahl", "Metric"],
  comparison: [
    "Auftragshonorare und Dozentenvergütung vergleichen",
    "Compare contract fees and lecturer compensation",
  ],
  fees: ["Dozentenvergütung", "Lecturer compensation"],
  gross: ["Auftragshonorare", "Contract fees"],
  lecturerCash: ["Erfasste Dozentenzahlungen", "Recorded lecturer payments"],
  customerCash: [
    "Erfasste Zahlungen von Unternehmen",
    "Recorded payments from companies",
  ],
  cash: ["Erfasst", "Recorded"],
  pastConfirmed: ["Bestätigt, vergangen", "Confirmed, past"],
  futureConfirmed: ["Bestätigt, bevorstehend", "Confirmed, upcoming"],
  commitmentNote: [
    "Bestätigte Beträge werden dem ersten aktiven Termin zugeordnet. Die Vorschau umfasst bereits bestätigte Aufträge.",
    "Confirmed amounts are allocated to the first active session. The outlook includes work already confirmed.",
  ],
  cashNote: [
    "Die Monatswerte berücksichtigen erfasste Zahlungen, Rückzahlungen und Stornos zum jeweiligen Buchungsdatum.",
    "Monthly totals include recorded payments, repayments and reversals by their effective dates.",
  ],
  unknownGross_one: [
    "Bei einem bestätigten Auftrag in dieser Währung fehlt der Auftragsbetrag. Die Anzeige summiert die bekannten Beträge.",
    "One confirmed assignment in this currency has no contract amount on record. The figures sum the known amounts.",
  ],
  unknownGross_other: [
    "Bei {{count}} bestätigten Aufträgen in dieser Währung fehlt der Auftragsbetrag. Die Anzeige summiert die bekannten Beträge.",
    "{{count}} confirmed assignments in this currency have no contract amount on record. The figures sum the known amounts.",
  ],
  cashScope: [
    "Dozentenzahlungen stehen in der Gesamtansicht zur Verfügung, da eine Rechnung mehrere Unternehmen betreffen kann.",
    "Lecturer payments are available in the all-company view because one invoice can cover several companies.",
  ],
  scenario: ["Vorschau für offene Aufträge", "Open work scenario"],
  scenarioBasis: [
    "Für alle Unternehmen im gewählten Vorschauzeitraum. Die Annahmewahrscheinlichkeit gewichtet offene Plätze. Vorliegende Unternehmensanfragen fließen bei freigegebener Bruttosicht in die Auftragshonorare ein.",
    "Across all companies in the selected forecast window. The acceptance probability weights open positions. With gross finance access, submitted requests also contribute to estimated contract fees.",
  ],
  probability: ["Annahmewahrscheinlichkeit", "Acceptance probability"],
  scenarioFees: ["Geschätzte Dozentenkosten", "Estimated lecturer costs"],
  scenarioGross: [
    "Geschätzte bekannte Auftragshonorare",
    "Estimated known contract fees",
  ],
  unknownPipeline_one: [
    "Für einen offenen Platz ist die Vergütung noch unbestimmt.",
    "Compensation is undetermined for one open position.",
  ],
  unknownPipeline_other: [
    "Für {{count}} offene Plätze fehlt eine bestimmbare Vergütung.",
    "Compensation is undetermined for {{count}} open positions.",
  ],
  notAvailable: ["Keine belastbare Schätzung", "Estimate unavailable"],
} as const;

for (const [index, language] of ["de", "en"].entries()) {
  i18n.addResourceBundle(
    language,
    "analytics",
    Object.fromEntries(
      Object.entries(labels).map(([key, translations]) => [
        key,
        translations[index],
      ]),
    ),
  );
}
