import i18n from "../../lib/i18n";

const labels = {
  title: ["LMS-Analysen", "LMS analytics"],
  description: [
    "Teilnahme, Anwesenheit und Abschlüsse nach Kurs und Zeitraum",
    "Participation, attendance and completion by course and period",
  ],
  general: [
    "Aufträge, Lehrzeit und Finanzen",
    "Assignments, teaching time and finance",
  ],
  unavailable: [
    "Für deine Rolle sind derzeit keine LMS-Analysen verfügbar.",
    "LMS analytics are currently unavailable for your role.",
  ],
  offline: [
    "Stelle eine Verbindung her, um die aktuellen Kurszahlen zu laden.",
    "Connect to load current course figures.",
  ],
  scope: ["Auswertung für", "Report scope"],
  personal: ["Meine Kurse", "My courses"],
  company: ["Unternehmen", "Company"],
  staff: ["Kursverwaltung", "Course management"],
  organisation: ["Unternehmen auswählen", "Select company"],
  allOrganisations: ["Alle Unternehmen", "All companies"],
  period: ["Zeitraum", "Date range"],
  around: ["Rund um den aktuellen Monat", "Around the current month"],
  historyYear: ["Letzte zwölf Monate bis heute", "Last twelve months to date"],
  nextQuarter: ["Nächste 90 Tage", "Next 90 days"],
  custom: ["Benutzerdefiniert", "Custom"],
  status: ["Kursstatus", "Course status"],
  all: ["Alle Status", "All statuses"],
  draft: ["Entwurf", "Draft"],
  upcoming: ["Bevorstehend", "Upcoming"],
  running: ["Läuft", "In progress"],
  finished: ["Beendet", "Finished"],
  archived: ["Archiviert", "Archived"],
  search: ["Kurs oder Klasse suchen", "Search course or class"],
  applySearch: ["Suchen", "Search"],
  zone: ["Zeitzone der Auswertung: {{zone}}", "Report time zone: {{zone}}"],
  cohortBasis: [
    "Der Zeitraum bezieht sich auf den ersten Kurstermin. Bei Kursen ohne Termin zählt das Erstelldatum. Die Teilnehmendenzahlen zeigen den aktuellen Stand je Kurs.",
    "The date range uses the first course session. Courses without sessions use their creation date. Participant counts show the current state of each course.",
  ],
  courses: ["Kurse", "Courses"],
  upcomingCourses: ["Bevorstehende Kurse", "Upcoming courses"],
  participants: ["Eindeutige Teilnehmende", "Unique participants"],
  enrolments: ["Teilnahmen je Kurs", "Enrolments across courses"],
  completions: ["Abgeschlossene Teilnahmen", "Completed enrolments"],
  completionRate: [
    "Anteil abgeschlossener Teilnahmen",
    "Share of enrolments completed",
  ],
  certificates: ["Gültige Abschlussnachweise", "Valid completion records"],
  sessions: ["Kurstermine", "Course sessions"],
  minutes: ["Geplante Kurszeit", "Scheduled course time"],
  coursesOverTime: [
    "Beendete und bevorstehende Kurse je Monat",
    "Finished and upcoming courses by month",
  ],
  participantsOverTime: [
    "Teilnahmen und Abschlüsse nach Kursstart",
    "Enrolments and completions by course start",
  ],
  attendance: ["Erfasste Anwesenheit", "Recorded attendance"],
  present: ["Anwesend", "Present"],
  absent: ["Abwesend", "Absent"],
  excused: ["Entschuldigt", "Excused"],
  attendanceEmpty: [
    "In der Auswahl liegen noch keine Anwesenheits- oder Abwesenheitseinträge vor.",
    "There are no present or absent records for this selection yet.",
  ],
  attendanceBasis: [
    "Die Quote nutzt bestätigte Einträge für beendete Termine. Entschuldigte und unmarkierte Einträge fließen nicht in die Quote ein.",
    "The rate uses verified records for finished sessions. Excused and unmarked entries are excluded from the rate.",
  ],
  attendanceRate: ["Anwesenheitsquote", "Attendance rate"],
  month: ["Monat", "Month"],
  data: ["Diagrammdaten als Tabelle", "Chart data table"],
  courseBreakdown: ["Kennzahlen je Kurs", "Metrics by course"],
  course: ["Kurs", "Course"],
  courseStart: ["Kursstart", "Course start"],
  empty: [
    "Für diese Auswahl wurden keine Kurse gefunden.",
    "No courses match this selection.",
  ],
  previous: ["Vorherige Seite", "Previous page"],
  next: ["Nächste Seite", "Next page"],
  page: ["Seite {{page}} von {{pages}}", "Page {{page}} of {{pages}}"],
} as const;

for (const [locale, index] of [
  ["de", 0],
  ["en", 1],
] as const) {
  i18n.addResourceBundle(
    locale,
    "learningAnalytics",
    Object.fromEntries(
      Object.entries(labels).map(([key, value]) => [key, value[index]]),
    ),
  );
}
