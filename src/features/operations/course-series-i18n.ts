import i18n from "../../lib/i18n";

const messages = {
  title: ["Kursserie planen", "Plan a course series"],
  intro: [
    "Plane mehrere unabhängige Entwürfe aus einer Vorlage. Für parallele Durchläufe wählst du denselben Starttag und unterschiedliche Klassen oder Räume.",
    "Plan several separate drafts from one template. For parallel runs, choose the same start date and different classes or rooms.",
  ],
  template: ["Kursvorlage", "Course template"],
  organisation: ["Unternehmen", "Organisation"],
  choose: ["Auswählen", "Choose"],
  zone: ["Zeitzone der Termine", "Session time zone"],
  days: ["Unterrichtstage je Durchlauf", "Teaching days per run"],
  start: ["Täglicher Beginn", "Daily start"],
  end: ["Tägliches Ende", "Daily end"],
  weekdays: ["Unterrichtswoche", "Teaching week"],
  exclusions: ["Unterrichtsfreie Daten", "Excluded dates"],
  exclusionsHint: [
    "Bis zu 60 Daten im Format JJJJ-MM-TT, zum Beispiel Feiertage. Sie werden übersprungen.",
    "Up to 60 dates in YYYY-MM-DD format, for example holidays. These dates are skipped.",
  ],
  run: ["Durchlauf {{number}}", "Run {{number}}"],
  runScheduleOverrides: [
    "Terminmuster für diesen Durchlauf",
    "Schedule pattern for this run",
  ],
  runScheduleOverridesHelp: [
    "Leere Felder übernehmen das gemeinsame Terminmuster. Zeitzone, Unterrichtswoche und Ausnahmen gelten für alle Durchläufe.",
    "Empty fields use the shared pattern. Time zone, teaching week and excluded dates apply to all runs.",
  ],
  runTeachingDays: [
    "Abweichende Anzahl Unterrichtstage",
    "Custom number of teaching days",
  ],
  runStart: ["Abweichender Tagesbeginn", "Custom daily start"],
  runEnd: ["Abweichendes Tagesende", "Custom daily end"],
  firstDay: ["Erster möglicher Unterrichtstag", "First possible teaching day"],
  repeatStartDates: ["Starttage wiederholen", "Repeat start dates"],
  repeatStartDatesHint: [
    "Die Wiederholung beginnt beim spätesten eingetragenen Starttag. Sie füllt leere Starttage und ergänzt weitere Durchläufe. Die Terminprüfung berücksichtigt anschließend Unterrichtstage, Ausnahmen, Klassen und Räume.",
    "Repeats begin at the latest entered start date. They fill empty start dates and add more runs. The schedule review then applies teaching days and exclusions and checks classes and rooms.",
  ],
  delivery: ["Durchführungsart", "Delivery mode"],
  online: ["Online", "Online"],
  onsite: ["Präsenz", "On site"],
  venue: ["Raum oder Ort", "Room or venue"],
  class: ["Klasse", "Class"],
  noClass: ["Ohne Klasse", "No class"],
  classError: [
    "Die Klassen konnten nicht geladen werden.",
    "Classes could not be loaded.",
  ],
  add: ["Durchlauf ergänzen", "Add run"],
  remove: ["Durchlauf {{number}} entfernen", "Remove run {{number}}"],
  review: ["Termine und Konflikte prüfen", "Review sessions and conflicts"],
  reviewed: ["Geprüfte Termine", "Reviewed sessions"],
  workload: ["Lehrbedarf", "Teaching workload"],
  workloadBasis: [
    "Berechnet mit einer Lehrkraft je Durchlauf. Die Besetzung erfolgt nach dem Anlegen der Entwürfe.",
    "Based on one instructor per run. Assign instructors after creating the drafts.",
  ],
  totalSessions: ["Termine insgesamt", "Total sessions"],
  totalHours: ["Geplante Terminzeit insgesamt", "Total scheduled hours"],
  simultaneousInstructors: [
    "Lehrkräfte gleichzeitig (Spitzenbedarf)",
    "Instructors needed at the same time (peak)",
  ],
  openInstructorAssignments: [
    "Offene Lehrkraftzuordnungen",
    "Open instructor assignments",
  ],
  runWorkload_one: [
    "{{count}} Termin · {{hours}}",
    "{{count}} session · {{hours}}",
  ],
  runWorkload_other: [
    "{{count}} Termine · {{hours}}",
    "{{count}} sessions · {{hours}}",
  ],
  invalid: [
    "Prüfe Vorlage, Unternehmen, Starttage, Tageszeiten, Zeitzone und unterrichtsfreie Tage. Alle Termine müssen in der Zukunft liegen und zeitlich eindeutig sein.",
    "Check the template, organisation, start dates, times, time zone and excluded dates. All sessions must be in the future with unambiguous times.",
  ],
  save: ["Alle Durchläufe als Entwurf anlegen", "Create all runs as drafts"],
  error: [
    "Die Serie konnte nicht verarbeitet werden. Prüfe den aktuellen Stand und versuche es erneut.",
    "The series could not be processed. Check the current state and try again.",
  ],
  conflict_session: [
    "Dieser Termin überschneidet sich mit einem Termin im selben Durchlauf.",
    "This session overlaps another session in the same run.",
  ],
  conflict_class: [
    "Diese Klasse ist zur selben Zeit bereits eingeplant.",
    "This class is already scheduled at this time.",
  ],
  conflict_room: [
    "Dieser Raum ist zur selben Zeit bereits eingeplant.",
    "This room is already scheduled at this time.",
  ],
  saved: [
    "Die Durchläufe wurden als Entwürfe angelegt.",
    "The runs were created as drafts.",
  ],
  prepareOffer: [
    "Auftrag für Durchlauf {{number}} vorbereiten",
    "Prepare offer for run {{number}}",
  ],
  open: ["Durchlauf {{number}} öffnen", "Open run {{number}}"],
} as const;

for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const) {
  i18n.addResourceBundle(
    language,
    "courseSeries",
    Object.fromEntries(
      Object.entries(messages).map(([key, values]) => [key, values[index]]),
    ),
  );
}
