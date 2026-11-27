/** German and English labels for the training indicators and review queue. */
import i18n from "../../lib/i18n";

const labels = {
  escalate: ["Eskalieren", "Escalate"],
  escalateIssue: [
    "{{title}} eskalieren. {{code}}",
    "Escalate {{title}}. {{code}}",
  ],
  escalateHelp: [
    "Lege für {{title}} eine zugewiesene Arbeitsaufgabe an.",
    "Assign a follow-up task for {{title}}.",
  ],
  escalationAssignee: ["Zuständig", "Assignee"],
  noEscalationAssignees: [
    "Aktuell kann die Aufgabe keiner berechtigten Person zugewiesen werden.",
    "The task cannot currently be assigned to an eligible person.",
  ],
  selectAssignee: ["Person auswählen", "Select a person"],
  escalationDue: ["Frist ({{zone}})", "Deadline ({{zone}})"],
  escalationReason: ["Nächster Schritt", "Next step"],
  escalationDueError: [
    "Die Frist muss in der Zukunft liegen und spätestens beim Kursstart enden.",
    "The deadline must be in the future and no later than the course start.",
  ],
  escalationError: [
    "Die Eskalation konnte nicht gespeichert werden. Prüfe, ob der Hinweis noch aktuell ist.",
    "The escalation could not be saved. Check that the issue is still current.",
  ],
  escalationTask: ["Aufgabe ansehen", "View task"],
  escalationOverdue: ["Überfällig", "Overdue"],
  cancelEscalation: ["Abbrechen", "Cancel"],
  open: ["Offen", "Open"],
  doing: ["In Arbeit", "In progress"],
  done: ["Erledigt", "Done"],
  organisation: ["Unternehmen", "Company"],
  allOrganisations: ["Alle Unternehmen", "All companies"],
  topic: ["Kursthema", "Course topic"],
  allTopics: ["Alle Kursthemen", "All course topics"],
  outsidePeriod: ["Keine Treffer im Zeitraum", "No matches in this period"],
  sharedCapacity: [
    "Freie Zeit aus geteilten Verfügbarkeiten",
    "Free time from shared availability",
  ],
  capacityHelp: [
    "Alle freigegebenen Zeitfenster im Zeitraum. Bestätigte Einsätze und geteilte Abwesenheiten sind abgezogen.",
    "All shared time windows in the period. Confirmed assignments and shared absences are deducted.",
  ],
  weeklyCapacity: ["Woche ab {{day}}", "Week beginning {{day}}"],
  capacityValue: [
    "{{hours}} Std. · {{people}} Lehrkräfte",
    "{{hours}} hr · {{people}} lecturers",
  ],
  absences: [
    "Geteilte bevorstehende Abwesenheiten",
    "Upcoming shared absences",
  ],
  noAvailability: [
    "Für diesen Zeitraum wurden keine Angaben geteilt.",
    "No availability was shared for this period.",
  ],
  coverageHelp: [
    "Im gewählten Zeitraum zählen Unterrichtsstunden pro benötigter Lehrkraft. Mehrere Positionen für einen Termin zählen einzeln.",
    "Teaching hours in the selected period are counted per required teaching position. Multiple positions for the same session count separately.",
  ],
  upcoming: ["Anstehende Kurse", "Upcoming courses"],
  active: ["Laufende Kurse", "Active courses"],
  unstaffed: ["Kurse ohne Besetzung", "Unstaffed courses"],
  partly_staffed: ["Teilweise besetzte Kurse", "Partly staffed courses"],
  attention: [
    "Kurse mit Handlungsbedarf in den nächsten 3 Tagen",
    "Courses requiring attention in the next 3 days",
  ],
  assignedHours: ["Besetzte Unterrichtsstunden", "Assigned teaching hours"],
  unassignedHours: ["Offene Unterrichtsstunden", "Unassigned teaching hours"],
  upcomingIssues: [
    "Kursstarts in den nächsten 3 Tagen",
    "Course starts in the next 3 days",
  ],
  staffing: ["Besetzung unvollständig", "Staffing incomplete"],
  delivery: [
    "Ort oder Einwahldaten fehlen",
    "Location or joining details missing",
  ],
  agreement: ["Vereinbarung prüfen", "Review agreement"],
  qualification: ["Qualifikation prüfen", "Review qualification"],
  preparation: ["Kursvorbereitung unvollständig", "Preparation incomplete"],
  showAcknowledged: [
    "Bestätigte Hinweise anzeigen",
    "Show acknowledged issues",
  ],
  acknowledge: ["Gesehen", "Acknowledge"],
  undo: ["Erneut anzeigen", "Show again"],
  acknowledgeIssue: [
    "Hinweis zu {{title}} bestätigen. {{code}}",
    "Acknowledge issue for {{title}}. {{code}}",
  ],
  undoIssue: [
    "Hinweis zu {{title}} erneut anzeigen. {{code}}",
    "Show issue for {{title}} again. {{code}}",
  ],
  saveFailed: [
    "Der Hinweis konnte nicht aktualisiert werden.",
    "The issue could not be updated.",
  ],
  noIssues: [
    "Keine offenen Hinweise in dieser Ansicht.",
    "No open issues in this view.",
  ],
  receivables: [
    "Kundenrechnungen und Zahlungseingänge",
    "Customer invoices and receipts",
  ],
  receivablesHelp: [
    "Nach Rechnungsdatum gefiltert. Salden enthalten die bis heute erfassten Gutschriften, Zahlungen und Erstattungen.",
    "Filtered by invoice date. Balances include recorded credits, payments and refunds to date.",
  ],
  invoiced: ["Fakturiert nach Gutschriften", "Invoiced after credits"],
  received: ["Zahlungseingänge nach Erstattungen", "Receipts after refunds"],
  outstanding: ["Offene Forderungen", "Outstanding receivables"],
  overdue: ["Überfällige Kundenrechnungen", "Overdue customer invoices"],
  noOverdue: [
    "Keine überfälligen Rechnungen im Zeitraum.",
    "No overdue invoices in this period.",
  ],
} as const;

for (const [locale, index] of [
  ["de", 0],
  ["en", 1],
] as const) {
  i18n.addResourceBundle(
    locale,
    "trainingControl",
    Object.fromEntries(
      Object.entries(labels).map(([key, value]) => [key, value[index]]),
    ),
    true,
    true,
  );
}
