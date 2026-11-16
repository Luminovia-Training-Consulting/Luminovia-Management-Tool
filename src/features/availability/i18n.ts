/**
 * DE/EN-Oberflächentexte für availability. Die Registrierung erweitert i18next beim Modulimport; verfasste Fachinhalte werden nicht automatisch übersetzt.
 */
import i18n from "../../lib/i18n";
// Statische UI-Ressourcen; Variablen und Pluralformen folgen dem gemeinsamen
// i18next-Vertrag des jeweiligen Fachnamensraums.
const de = {
  title: "Verfügbarkeit & Sperrzeiten",
  help: "Verfügbare Zeitfenster helfen bei der Planung. Sperrzeiten verhindern neue überlappende Auftragsbuchungen; bestehende bestätigte Aufträge bleiben bestehen.",
  own: "Meine Zeitfenster",
  shared: "Freigegebene Zeitfenster",
  sharedHelp:
    "Nur ausdrücklich freigegebene Zeiträume und Status werden angezeigt. Private Kalendertermine und Notizen bleiben privat.",
  create: "Zeitfenster hinzufügen",
  edit: "Zeitfenster bearbeiten",
  available: "Verfügbar",
  unavailable: "Nicht verfügbar",
  kind: "Status",
  start: "Beginn",
  end: "Ende",
  zone: "Zeitzone",
  notes: "Notiz (nur für dich)",
  share: "Zeitraum und Status ausdrücklich mit dem Management teilen",
  private: "Nur für dich",
  sharedBadge: "Mit Management geteilt",
  save: "Zeitfenster speichern",
  saving: "Wird gespeichert …",
  saved: "Änderung gespeichert.",
  remove: "Entfernen",
  removeTitle: "Zeitfenster entfernen?",
  removeHelp:
    "Der Planungshinweis oder die Sperrzeit wird entfernt. Bestätigte Aufträge werden dadurch nicht geändert.",
  cancel: "Abbrechen",
  from: "Anzeigen ab",
  to: "Anzeigen bis",
  rangeHelp: "Beide Tage eingeschlossen, höchstens 93 Tage pro Ansicht.",
  invalidRange: "Bitte einen gültigen Zeitraum von höchstens 93 Tagen wählen.",
  empty: "Keine Zeitfenster in diesem Zeitraum.",
  conflict:
    "Die Sperrzeit überschneidet einen bestätigten Auftrag und wurde nicht gespeichert.",
  stale:
    "Dieses Zeitfenster wurde geändert. Schließe den Entwurf, lade den aktuellen Stand und prüfe deine Änderungen.",
  error:
    "Die Änderung wurde nicht gespeichert. Bitte Zeitraum und Berechtigung prüfen.",
  invalid:
    "Bitte gültige lokale Uhrzeiten und eine IANA-Zeitzone eingeben. Doppeldeutige oder übersprungene Uhrzeiten werden nicht stillschweigend verschoben.",
  readOnly:
    "Dieses Konto kann vorhandene eigene Zeitfenster lesen und entfernen. Neue Zeitfenster erfordern eine Dozierenden- oder Verwaltungsrolle.",
  back: "Zum Kalender",
  sharedLimit:
    "Bis zu 1.000 freigegebene und 500 eigene Zeitfenster pro Ansicht.",
  reload: "Aktuellen Stand laden",
};
const en: Record<keyof typeof de, string> = {
  title: "Availability & blocked time",
  help: "Available windows help with planning. Unavailable windows prevent new overlapping job allocations; existing confirmed assignments remain unchanged.",
  own: "My windows",
  shared: "Shared windows",
  sharedHelp:
    "Only explicitly shared intervals and status are shown. Private calendar events and notes remain private.",
  create: "Add time window",
  edit: "Edit time window",
  available: "Available",
  unavailable: "Unavailable",
  kind: "Status",
  start: "Start",
  end: "End",
  zone: "Time zone",
  notes: "Note (only you)",
  share: "Explicitly share interval and status with management",
  private: "Only you",
  sharedBadge: "Shared with management",
  save: "Save time window",
  saving: "Saving …",
  saved: "Changes saved.",
  remove: "Remove",
  removeTitle: "Remove this window?",
  removeHelp:
    "The planning hint or unavailable window will be removed. This does not change confirmed assignments.",
  cancel: "Cancel",
  from: "Display from",
  to: "Display until",
  rangeHelp: "Both dates included; up to 93 days per view.",
  invalidRange: "Choose a valid interval of at most 93 days.",
  empty: "No windows in this interval.",
  conflict:
    "This unavailable window overlaps a confirmed assignment and was not saved.",
  stale:
    "This window changed. Close your draft, reload the current version and review your changes.",
  error: "Changes were not saved. Check the interval and your permissions.",
  invalid:
    "Enter valid local times and an IANA time zone. Ambiguous or skipped times are not silently moved.",
  readOnly:
    "This account can read and remove existing own windows. New windows require a lecturer or management role.",
  back: "Back to calendar",
  sharedLimit: "Up to 1,000 shared and 500 own windows per view.",
  reload: "Reload current version",
};
i18n.addResourceBundle("de", "availability", de);
i18n.addResourceBundle("en", "availability", en);
