import i18n from "../../lib/i18n";
const values = {
  search: ["Kalendertermine suchen", "Search calendar events"],
  type: ["Terminart", "Event type"],
  all: ["Alle Terminarten", "All event types"],
  private: ["Private Termine", "Personal events"],
  assignment: ["Aufträge", "Assignments"],
  global: ["Globale Termine", "Global events"],
  course: ["Kurstermine", "Course sessions"],
  scope: [
    "Die Suche filtert geladene Titel. Globale Termine umfassen nur geladene Seiten des sichtbaren Zeitraums.",
    "Search filters loaded titles. Global events cover only loaded pages in the visible range.",
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
