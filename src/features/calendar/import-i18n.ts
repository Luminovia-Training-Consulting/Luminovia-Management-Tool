import i18n from "../../lib/i18n";

const pairs = {
  title: ["ICS-Datei importieren", "Import ICS file"],
  help: [
    "Importiere Termine als private Kalendereinträge. Termine ohne Zeitzone verwenden {{zone}}. Serien werden im ausgewählten Zeitraum als einzelne Termine übernommen, ohne laufende Synchronisierung. Bereits importierte Termine werden übersprungen. Prüfe die Vorschau vor dem Speichern.",
    "Import appointments as private calendar entries. Dates without a time zone use {{zone}}. Recurrences become individual appointments within the selected window, without ongoing synchronisation. Previously imported appointments are skipped. Review the preview before saving.",
  ],
  from: ["Serientermine ab", "Recurring appointments from"],
  until: ["Serientermine bis", "Recurring appointments until"],
  file: ["Kalenderdatei (.ics, bis 2 MB)", "Calendar file (.ics, up to 2 MB)"],
  untitled: ["Importierter Termin", "Imported appointment"],
  review: ["Vorschau aktualisieren", "Update preview"],
  preview: ["Importvorschau", "Import preview"],
  count: [
    "{{count}} Termine zur Übernahme",
    "{{count}} appointments to import",
  ],
  confirm: ["Termine importieren", "Import appointments"],
  saved: [
    "{{created}} Termine importiert, {{skipped}} bereits vorhanden.",
    "Imported {{created}} appointments; {{skipped}} already present.",
  ],
  invalid_file: [
    "Die Datei konnte nicht gelesen werden. Verwende eine gültige ICS-Datei mit Terminen, höchstens 500 Terminen und bis zu 2 MB.",
    "The file could not be read. Choose a valid ICS file containing up to 500 appointments and no more than 2 MB.",
  ],
  unsupported_zone: [
    "Die Datei enthält eine unbekannte Zeitzone. Exportiere sie mit einer IANA-Zeitzone oder UTC erneut.",
    "The file contains an unknown time zone. Export it using an IANA time zone or UTC.",
  ],
  invalid_window: [
    "Wähle einen gültigen Serienzeitraum von höchstens zwei Jahren.",
    "Choose a valid recurrence window of up to two years.",
  ],
  too_many: [
    "Die Serie enthält zu viele Termine. Importiere einen kleineren Kalender oder einen kürzeren Zeitraum.",
    "The recurrence contains too many appointments. Import a smaller calendar or a shorter window.",
  ],
  empty_window: [
    "Im gewählten Zeitraum gibt es keine Serientermine.",
    "There are no recurring appointments in the selected window.",
  ],
  failed: [
    "Der Import wurde nicht bestätigt. Prüfe deine Verbindung, Berechtigung und mögliche Überschneidungen mit bestätigten Aufträgen. Du kannst es erneut versuchen; bereits importierte Termine werden übersprungen.",
    "The import was not confirmed. Check your connection, access and any conflicts with confirmed assignments. You can retry; previously imported appointments are skipped.",
  ],
} as const;
for (const [index, language] of ["de", "en"].entries())
  i18n.addResourceBundle(
    language,
    "calendarImport",
    Object.fromEntries(
      Object.entries(pairs).map(([key, value]) => [key, value[index]]),
    ),
    true,
    true,
  );
