import i18n from "../../lib/i18n";

const entries = {
  global: ["Globale Termine", "Global events"],
  manage: ["Globale Termine verwalten", "Manage global events"],
  help: [
    "Nur ausdrücklich veröffentlichte Termine erscheinen im gemeinsamen Kalender. Speichern erstellt einen Entwurf und nimmt einen bisher veröffentlichten Termin zurück.",
    "Only explicitly published events appear in the shared calendar. Saving creates a draft and withdraws an existing publication.",
  ],
  add: ["Globalen Termin erstellen", "Create global event"],
  title: ["Titel", "Title"],
  description: ["Beschreibung", "Description"],
  link: ["HTTPS-Link (optional)", "HTTPS link (optional)"],
  openLink: ["Weiterführenden Link öffnen", "Open related link"],
  downloadEvent: [
    "Kalendereintrag herunterladen (.ics)",
    "Download calendar event (.ics)",
  ],
  downloadFailed: [
    "Der Kalendereintrag konnte nicht heruntergeladen werden.",
    "The calendar event could not be downloaded.",
  ],
  save: ["Als Entwurf speichern", "Save as draft"],
  edit: ["Entwurf bearbeiten", "Edit draft"],
  publish: ["Veröffentlichen", "Publish"],
  unpublish: ["Veröffentlichung zurücknehmen", "Unpublish"],
  archive: ["Archivieren", "Archive"],
  recover: ["Als Entwurf wiederherstellen", "Recover as draft"],
  draft: ["Entwurf", "Draft"],
  published: ["Veröffentlicht", "Published"],
  archived: ["Archiviert", "Archived"],
  search: ["Globale Termine suchen", "Search global events"],
  more: ["Weitere Termine laden", "Load more events"],
  empty: [
    "Keine Termine im angezeigten Zeitraum.",
    "No events in the displayed date range.",
  ],
  loaded_one: ["{{count}} Termin geladen", "{{count}} event loaded"],
  loaded_other: ["{{count}} Termine geladen", "{{count}} events loaded"],
  error: [
    "Nicht gespeichert. Prüfe den aktuellen Stand und lade bei einem Versionskonflikt neu.",
    "Not saved. Check the current state and reload after a version conflict.",
  ],
  invalid: [
    "Prüfe Zeiten, Zeitzone und HTTPS-Link. Nicht existierende oder mehrdeutige Ortszeiten benötigen eine eindeutige Eingabe.",
    "Check times, time zone and HTTPS link. Nonexistent or ambiguous local times need an unambiguous input.",
  ],
  denied: [
    "Die aktuelle Verwaltungsberechtigung fehlt. Private Entwürfe werden ausgeblendet.",
    "Current management permission is missing. Private drafts are hidden.",
  ],
  saved: ["Änderung vom Server bestätigt.", "Change confirmed by the server."],
  cancel: ["Abbrechen", "Cancel"],
  reload: ["Aktualisieren", "Refresh"],
  details: ["Globaler Termin", "Global event"],
  range: [
    "Die Liste verwendet den sichtbaren Kalenderzeitraum.",
    "The list uses the visible calendar date range.",
  ],
  saveHint: [
    "Speichern veröffentlicht nichts. Prüfe den gespeicherten Entwurf und veröffentliche ihn anschließend ausdrücklich.",
    "Saving does not publish. Review the saved draft and explicitly publish it afterwards.",
  ],
};
for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "calendarPublications",
    Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, v[index]])),
  );
