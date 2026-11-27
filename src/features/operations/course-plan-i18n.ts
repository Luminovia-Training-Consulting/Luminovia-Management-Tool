/** Shared labels for the schedule controls in the internal and Academy editors. */
import i18n from "../../lib/i18n";

const labels: Record<string, [string, string]> = {
  start: ["Beginn", "Start"],
  end: ["Ende", "End"],
  remove: ["Entfernen", "Remove"],
  addSession: ["Termin hinzufügen", "Add session"],
  firstDate: ["Erster Unterrichtstag", "First teaching date"],
  dailyStart: ["Täglicher Beginn", "Daily start"],
  dailyEnd: ["Tägliches Ende", "Daily end"],
  bulkSchedule: ["Mehrere Termine bearbeiten", "Edit multiple sessions"],
  bulkScheduleSelect: ["Termine auswählen", "Select sessions"],
  bulkScheduleAll: ["Alle auswählen", "Select all"],
  bulkScheduleClear: ["Auswahl aufheben", "Clear selection"],
  bulkScheduleFilter: [
    "Nach Wochentag oder Datum auswählen",
    "Select by weekday or date",
  ],
  bulkScheduleWeekday: ["Wochentag", "Weekday"],
  bulkScheduleAnyDay: ["Alle Wochentage", "Any weekday"],
  bulkScheduleFrom: ["Termine ab", "Sessions from"],
  bulkScheduleThrough: ["Termine bis einschließlich", "Sessions through"],
  bulkScheduleSelectMatching: [
    "Passende Termine auswählen ({{count}})",
    "Select matching sessions ({{count}})",
  ],
  bulkScheduleOffset: ["Um Kalendertage verschieben", "Shift by calendar days"],
  bulkScheduleOffsetHint: [
    "Negative Werte verschieben nach vorne.",
    "Negative values move sessions earlier.",
  ],
  bulkScheduleStart: ["Neuer Beginn (optional)", "New start time (optional)"],
  bulkScheduleEnd: ["Neues Ende (optional)", "New end time (optional)"],
  bulkSchedulePreview: ["Terminänderungen prüfen", "Review session changes"],
  bulkScheduleInvalid: [
    "Prüfe die Auswahl und Zeitangaben. Die Termine müssen eindeutig und überschneidungsfrei sein.",
    "Check the selected sessions and times. Their times must be unambiguous and non-overlapping.",
  ],
  bulkScheduleCount: [
    "Änderungen für {{count}} Termine",
    "Changes to {{count}} sessions",
  ],
  bulkScheduleApply: ["Terminänderungen übernehmen", "Apply session changes"],
  schedulePlanner: ["Termine planen", "Plan sessions"],
  scheduleMode: ["Terminauswahl", "Date selection"],
  scheduleByCount: ["Anzahl Unterrichtstage", "Number of teaching days"],
  scheduleByRange: ["Datumsbereich", "Date range"],
  scheduleByDates: ["Einzelne Unterrichtstage", "Specific teaching dates"],
  scheduleLastDate: [
    "Letzter möglicher Unterrichtstag",
    "Last possible teaching date",
  ],
  scheduleDatesHint: [
    "Datum als JJJJ-MM-TT eingeben, ein Datum pro Zeile.",
    "Enter dates as YYYY-MM-DD, one per line.",
  ],
  scheduleAdvanced: [
    "Wochentage, Ausnahmen und individuelle Zeiten",
    "Weekdays, exclusions and individual hours",
  ],
  scheduleRepeatWeeks: [
    "Wöchentlicher Wiederholungsabstand",
    "Repeat interval in weeks",
  ],
  scheduleExcludedDates: [
    "Ausgeschlossene Tage, z. B. Feiertage",
    "Excluded dates, such as public holidays",
  ],
  scheduleWeekdays: ["Unterrichtstage", "Teaching weekdays"],
  scheduleCustom: ["Individuelle Zeiten", "Individual hours"],
  scheduleDefaultHours: ["Standardzeiten", "Default hours"],
  scheduleResetHours: ["Standardzeiten übernehmen", "Use default hours"],
  schedulePreview: ["Terminvorschau erstellen", "Preview sessions"],
  schedulePreviewCount: [
    "Vorgeschlagene Termine ({{count}})",
    "Proposed sessions ({{count}})",
  ],
  schedulePlannerInvalid: [
    "Prüfe Datum und Uhrzeit. Die Vorschau braucht 1 bis 60 Termine mit eindeutigen, überschneidungsfreien Uhrzeiten in der Kurszeitzone.",
    "Check the dates and times. The preview needs 1 to 60 sessions with unambiguous, non-overlapping times in the course time zone.",
  ],
  scheduleReplaceHint: [
    "Beim Übernehmen werden die {{count}} eingegebenen Termine im Formular ersetzt. Gespeichert wird erst über die Kursaktion.",
    "Applying this preview replaces the {{count}} entered sessions in the form. Use the course action to save them.",
  ],
  scheduleReplace: ["Termine im Formular ersetzen", "Replace sessions in form"],
  scheduleApply: ["Termine übernehmen", "Apply sessions"],
};
for (const [locale, index] of [
  ["de", 0],
  ["en", 1],
] as const) {
  i18n.addResourceBundle(
    locale,
    "coursePlan",
    Object.fromEntries(
      Object.entries(labels).map(([key, value]) => [key, value[index]]),
    ),
    true,
    true,
  );
}
