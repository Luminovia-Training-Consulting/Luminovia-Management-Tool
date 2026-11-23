import i18n from "../../lib/i18n";

const values = {
  navigation: ["Zeitraum wechseln", "Change date range"],
  previous: ["Vorheriger Zeitraum", "Previous date range"],
  next: ["Nächster Zeitraum", "Next date range"],
  today: ["Heute", "Today"],
  view: ["Kalenderansicht", "Calendar view"],
  dayGridMonth: ["Monat", "Month"],
  timeGridWeek: ["Woche", "Week"],
  timeGridDay: ["Tag", "Day"],
  listMonth: ["Termine", "Agenda"],
  calendarScope: ["Kalenderbereich", "Calendar scope"],
  weeklyCalendar: ["Kalenderwoche", "Calendar week"],
  scrollWeek: [
    "Seitlich scrollen, um alle Wochentage zu sehen.",
    "Scroll horizontally to see all days of the week.",
  ],
  selectFromGrid: [
    "Wechsle zu Monat, Woche oder Tag, um einen Termin direkt im Kalender auszuwählen.",
    "Switch to Month, Week or Day to select an appointment directly on the calendar.",
  ],
  selectPeriod: [
    "Tippe auf einen freien Zeitpunkt oder ziehe über mehrere Zeiten oder Tage. Auf dem Touchscreen zum Ziehen kurz gedrückt halten.",
    "Tap a free time, or drag across times or days. On touchscreens, press and hold before dragging.",
  ],
  customer: ["Unternehmen", "Company"],
  allCustomers: ["Alle Unternehmen", "All companies"],
  calendarColors: ["Kalenderfarben", "Calendar colors"],
  calendarColorsHelp: [
    "Diese privaten Farben gelten nur für dein Kalenderkonto. Von Unternehmen erstellte Einträge behalten einen gut lesbaren hellen Hintergrund.",
    "These private colors apply only to your calendar account. Entries created by companies retain a readable light background.",
  ],
  personalColor: ["Eigene private Termine", "Private appointments"],
  assignmentColor: [
    "Bestätigte Aufträge ohne Unternehmen",
    "Confirmed assignments without a company",
  ],
  customerColor: [
    "Von Unternehmen erstellte Kurse und Aufträge",
    "Courses and assignments created by companies",
  ],
  calendarColorsSave: ["Kalenderfarben speichern", "Save calendar colors"],
  calendarColorsSaving: ["Speichern …", "Saving …"],
  calendarColorsSaved: [
    "Deine Kalenderfarben wurden gespeichert.",
    "Your calendar colors were saved.",
  ],
  calendarColorsFailed: [
    "Die Kalenderfarben konnten nicht gespeichert werden.",
    "Calendar colors could not be saved.",
  ],
  calendarColorsConflict: [
    "Kalenderfarben wurden parallel geändert. Bitte neu laden.",
    "Calendar colors changed concurrently. Reload and try again.",
  ],
  calendarColorBlue: ["Hellblau", "Light blue"],
  calendarColorMint: ["Mint", "Mint"],
  calendarColorYellow: ["Hellgelb", "Light yellow"],
  calendarColorPeach: ["Pfirsich", "Peach"],
  calendarColorLilac: ["Lila", "Lilac"],
  calendarColorPink: ["Rosa", "Pink"],
  calendarColorSlate: ["Blaugrau", "Slate blue"],
  topics: ["Themen & Tags", "Topics & tags"],
  addTopic: ["Thema hinzufügen", "Add a topic"],
  selectedTopics: ["Gewählte Themen", "Selected topics"],
  unavailableTopic: ["Nicht mehr verfügbares Thema", "Unavailable topic"],
  removeTopic: ["Thema {{topic}} entfernen", "Remove topic {{topic}}"],
  clear: ["Filter zurücksetzen", "Clear filters"],
  search: ["Kalendertermine suchen", "Search calendar events"],
  type: ["Terminart", "Event type"],
  all: ["Alle Terminarten", "All event types"],
  private: ["Private Termine", "Personal events"],
  assignment: ["Aufträge", "Assignments"],
  global: ["Globale Termine", "Global events"],
  course: ["Kurstermine", "Course sessions"],
  scope: [
    "Unternehmen und Themen filtern die geladenen Kurstermine. Mehrere Themen gelten alternativ. Die Suche filtert Titel; globale Termine umfassen nur geladene Seiten des sichtbaren Zeitraums.",
    "Company and topic filters apply to loaded course sessions. Multiple topics match any selected topic. Search filters titles; global events cover only loaded pages in the visible range.",
  ],
} as const;
for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "calendarFilter",
    Object.fromEntries(
      Object.entries(values).map(([key, pair]) => [key, pair[index]]),
    ),
    true,
    true,
  );
