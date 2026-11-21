import i18n from "../../lib/i18n";

i18n.addResourceBundle("de", "academyTimetable", {
  title: "Stundenplan",
  description:
    "Die Datumsauswahl und Termine richten sich nach der jeweiligen Kurszeitzone.",
  from: "Vom",
  until: "Bis einschließlich",
  show: "Zeitraum anzeigen",
  previous: "Vorheriger Zeitraum",
  next: "Nächster Zeitraum",
  invalid: "Wähle einen Zeitraum von 1 bis {{count}} Tagen.",
  empty: "In diesem Zeitraum gibt es keine Kurstermine.",
  more: "Weitere Termine laden",
  start: "Beginn",
  end: "Ende",
  online: "Online",
  onsite: "Vor Ort",
  fallbackZone: "Kurszeitzone {{zone}}. Uhrzeiten in UTC.",
  count_one: "{{count}} angezeigter Termin",
  count_other: "{{count}} angezeigte Termine",
});

i18n.addResourceBundle("en", "academyTimetable", {
  title: "Timetable",
  description: "Dates and times use each course’s time zone.",
  from: "From",
  until: "Through",
  show: "Show dates",
  previous: "Previous dates",
  next: "Next dates",
  invalid: "Choose a date range of 1 to {{count}} days.",
  empty: "There are no course sessions in this date range.",
  more: "Load more sessions",
  start: "Start",
  end: "End",
  online: "Online",
  onsite: "On-site",
  fallbackZone: "Course time zone {{zone}}. Times shown in UTC.",
  count_one: "{{count}} session displayed",
  count_other: "{{count}} sessions displayed",
});
